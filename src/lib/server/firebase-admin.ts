import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export type EflAuthContext = {
  uid: string;
  email: string | null;
  garageId: string;
};

function getFirebaseAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson) as {
      projectId?: string;
      project_id?: string;
      clientEmail?: string;
      client_email?: string;
      privateKey?: string;
      private_key?: string;
    };
    const projectId = serviceAccount.projectId ?? serviceAccount.project_id;
    const clientEmail = serviceAccount.clientEmail ?? serviceAccount.client_email;
    const privateKey = serviceAccount.privateKey ?? serviceAccount.private_key;
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Firebase Admin service-account JSON mist projectId/clientEmail/privateKey");
    }

    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    throw new Error("Firebase Admin credentials are not configured");
  }

  return initializeApp({ credential: applicationDefault() });
}

export async function requireEflAuth(request: Request): Promise<EflAuthContext | Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ code: "UNAUTHENTICATED", detail: "Aanmelden is verplicht." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    return new Response(JSON.stringify({ code: "UNAUTHENTICATED", detail: "Ongeldig authenticatietoken." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let adminAuth;
  try {
    adminAuth = getAuth(getFirebaseAdminApp());
  } catch {
    return new Response(JSON.stringify({ code: "AUTH_CONFIGURATION_ERROR", detail: "Serverauthenticatie is niet geconfigureerd." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    let garageClaim = decoded.garage_id;
    if (typeof garageClaim !== "string" || garageClaim.length === 0) {
      if (process.env.NODE_ENV !== "production") {
        garageClaim = "garage-dev-default";
      } else {
        return new Response(
          JSON.stringify({ code: "GARAGE_MEMBERSHIP_REQUIRED", detail: "Een actieve garage membership is vereist." }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      garageId: garageClaim,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Firebase Admin credentials")) {
      return new Response(JSON.stringify({ code: "AUTH_CONFIGURATION_ERROR", detail: "Firebase Admin credentials zijn niet geconfigureerd." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ code: "UNAUTHENTICATED", detail: "Ongeldig of verlopen authenticatietoken." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
}

import type { ExecutionManifest } from "./history_types";

export type CanonicalValue = null | boolean | number | string
  | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue };

/** Versioned EFL canonical JSON: sorted UTF-16 keys, finite numbers, plain data only.
 * Array order is significant. Not advertised as an RFC 8785 implementation. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Non-finite audit number");
      return JSON.stringify(item);
    }
    if (typeof item !== "object") throw new TypeError("Unsupported audit value");
    if (ancestors.has(item)) throw new TypeError("Cyclic audit value");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        return "[" + Array.from(item, v => encode(v)).join(",") + "]";
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new TypeError("Audit objects must be plain data");
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError("Symbol audit key");
      const object = item as { readonly [key: string]: CanonicalValue };
      return "{" + Object.keys(object).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor || !("value" in descriptor)) throw new TypeError("Audit accessor");
        return JSON.stringify(key) + ":" + encode(descriptor.value);
      }).join(",") + "}";
    } finally { ancestors.delete(item); }
  };
  return encode(value);
}

export async function hashCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export interface ManifestContext {
  readonly previousExecutionHash: string | null;
  readonly engineBuildHash: string;
  readonly knowledgeBundleHash: string;
  readonly decoderHash: string;
  readonly windowPolicyHash: string;
  readonly configurationHash: string;
  readonly policyVersion: string;
}

export interface ExecutionRecord {
  readonly manifest: ExecutionManifest;
  /** Integrity hash, NOT an authenticated signature. Sign at the gateway boundary. */
  readonly executionHash: string;
}

export async function createExecutionManifest(
  context: ManifestContext,
  evidence: unknown,
  result: unknown,
): Promise<ExecutionRecord> {
  const hashes = [context.engineBuildHash, context.knowledgeBundleHash, context.decoderHash,
    context.windowPolicyHash, context.configurationHash];
  if (context.previousExecutionHash !== null) hashes.push(context.previousExecutionHash);
  if (hashes.some(hash => !/^[0-9a-f]{64}$/.test(hash)) || !context.policyVersion)
    throw new TypeError("Manifest requires SHA-256 version hashes and a policy version");
  const manifest: ExecutionManifest = {
    ...context,
    evidenceRootHash: await hashCanonical({ domain: "efl.evidence.v1", evidence }),
    resultHash: await hashCanonical({ domain: "efl.result.v1", result }),
  };
  const executionHash = await hashCanonical({ domain: "efl.execution.v1", manifest: { ...manifest } });
  return { manifest, executionHash };
}

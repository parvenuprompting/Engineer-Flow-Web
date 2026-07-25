import { createHash } from "node:crypto";
import manifest from "./data/version_manifest.json";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<{ [key: string]: JsonValue }>((acc, key) => {
        acc[key] = sortValue(record[key]);
        return acc;
      }, {});
  }

  return String(value);
}

export const ENGINE_VERSION = manifest.engine_version;
export const CONFIG_VERSION = manifest.config_version;
export const VERSION_MANIFEST = manifest;

const versionManifestErrors: string[] = [];

if (!manifest || typeof manifest !== "object") {
  versionManifestErrors.push("version_manifest.json ontbreekt of is geen object.");
} else {
  if (typeof manifest.engine_version !== "string" || manifest.engine_version.trim().length === 0) {
    versionManifestErrors.push("engine_version ontbreekt in version_manifest.json.");
  }

  if (typeof manifest.config_version !== "string" || manifest.config_version.trim().length === 0) {
    versionManifestErrors.push("config_version ontbreekt in version_manifest.json.");
  }

  if (!manifest.datasets || typeof manifest.datasets !== "object") {
    versionManifestErrors.push("datasets ontbreekt in version_manifest.json.");
  }
}

export const versionManifestReport = {
  errors: versionManifestErrors,
  ok: versionManifestErrors.length === 0,
};

export function assertVersionManifestIntegrity(): void {
  if (versionManifestReport.ok) {
    return;
  }

  throw new Error(`EFL_VERSION_MANIFEST_INVALID\n${versionManifestErrors.join("\n")}`);
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function createStableHash(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

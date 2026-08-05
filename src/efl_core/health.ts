import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eflData, eflDataIntegrityOk } from "./data";
import { ENGINE_VERSION, VERSION_MANIFEST, versionManifestReport } from "./version";

const DATASET_FILES = [
  "src/efl_core/data/master_symptom_set.v1.0.json",
  "src/efl_core/data/des_ts_map.v1.0.json",
  "src/efl_core/data/ef_diagnostic_schema.json",
  "src/efl_core/data/version_manifest.json",
  "src/ai/data/components.json",
  "src/ai/data/failure_modes.json",
  "src/ai/data/symptom_clusters.json",
  "src/ai/data/constraints.json",
  "src/ai/data/electrical_constraints.json",
  "src/ai/data/hydraulic_constraints.json",
  "src/ai/data/logic_rules.json",
  "src/ai/data/variant_constraints.json",
  "src/ai/data/component_relations.json",
  "src/ai/data/component_metadata.json",
  "src/ai/data/component_tree.json",
  "src/ai/data/base_flows.json",
  "src/ai/data/diagnostic_steps.json",
  "src/ai/data/step_requirements.json",
  "src/ai/data/step_effects.json",
  "data/cluster_keywords_mapping.json",
];

type DatasetFileHealth = {
  path: string;
  exists: boolean;
  parse_ok: boolean;
  error?: string;
};

type EflHealthSnapshot = {
  engine_version: string;
  dataset_versions: Record<string, string>;
  integrity_ok: boolean;
  audit_store_ok: boolean;
  legacy_diagnose_disabled: boolean;
  durable_sink: {
    configured: boolean;
  };
  version_manifest: {
    ok: boolean;
    errors: string[];
  };
  datasets: {
    ok: boolean;
    errors: string[];
    warnings: string[];
    files: DatasetFileHealth[];
  };
};

function inspectDatasetFiles(): DatasetFileHealth[] {
  return DATASET_FILES.map((relativePath) => {
    const absolutePath = join(process.cwd(), relativePath);
    if (!existsSync(absolutePath)) {
      return {
        path: relativePath,
        exists: false,
        parse_ok: false,
        error: "Bestand ontbreekt.",
      };
    }

    try {
      JSON.parse(readFileSync(absolutePath, "utf8"));
      return {
        path: relativePath,
        exists: true,
        parse_ok: true,
      };
    } catch (error) {
      return {
        path: relativePath,
        exists: true,
        parse_ok: false,
        error: error instanceof Error ? error.message : "JSON parse error",
      };
    }
  });
}

export function getEflHealthSnapshot(auditStoreOk = true): EflHealthSnapshot {
  const files = inspectDatasetFiles();
  const filesOk = files.every((file) => file.exists && file.parse_ok);
  const datasetsOk = filesOk && eflDataIntegrityOk;

  return {
    engine_version: ENGINE_VERSION,
    dataset_versions: VERSION_MANIFEST.datasets ?? {},
    integrity_ok: datasetsOk && versionManifestReport.ok,
    audit_store_ok: auditStoreOk,
    legacy_diagnose_disabled: true,
    durable_sink: {
      configured: Boolean(process.env.LUCID_AUDIT_SYNC_URL?.trim()),
    },
    version_manifest: {
      ok: versionManifestReport.ok,
      errors: versionManifestReport.errors,
    },
    datasets: {
      ok: datasetsOk,
      errors: eflData.dataIntegrityReport.errors,
      warnings: eflData.dataIntegrityReport.warnings,
      files,
    },
  };
}

export function assertEflCoreReady(auditStoreOk = true): void {
  const snapshot = getEflHealthSnapshot(auditStoreOk);
  if (snapshot.integrity_ok) {
    return;
  }

  const datasetErrors = snapshot.datasets.errors.join("\n");
  const manifestErrors = snapshot.version_manifest.errors.join("\n");
  const message = [datasetErrors, manifestErrors].filter(Boolean).join("\n");
  throw new Error(`EFL_CORE_UNHEALTHY\n${message || "Canonieke datasets of version manifest zijn niet valide."}`);
}

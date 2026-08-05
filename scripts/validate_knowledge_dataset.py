from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "efl_core" / "data"


def validate() -> list[str]:
    dataset = json.loads((DATA / "knowledge_objects.v1.0.json").read_text())
    objects = dataset.get("knowledge_objects")
    if not isinstance(objects, list):
        return ["knowledge_objects must be a list"]

    components = json.loads((ROOT / "src" / "ai" / "data" / "components.json").read_text())
    component_ids = {item["id"] for item in components["components"]}
    failure_modes = json.loads((ROOT / "src" / "ai" / "data" / "failure_modes.json").read_text())
    failure_ids = {item["id"] for item in failure_modes["failure_modes"]}
    errors: list[str] = []
    seen: set[str] = set()
    required = {
        "id", "type", "subsystem_id", "description_nl", "synonyms", "workshop_jargon",
        "negative_formulations", "context_signals", "positive_evidence", "negative_evidence",
        "measurements", "diagnostic_tests", "repair_actions", "safety", "provenance",
        "review_status", "dataset_version",
    }
    for item in objects:
        object_id = item.get("id")
        if not isinstance(object_id, str):
            errors.append("knowledge object has no string id")
            continue
        if object_id in seen:
            errors.append(f"duplicate knowledge object id: {object_id}")
        seen.add(object_id)
        missing = sorted(required - item.keys())
        errors.extend(f"{object_id}: missing {field}" for field in missing)
        for component_id in item.get("component_ids", []):
            if component_id not in component_ids:
                errors.append(f"{object_id}: unknown component {component_id}")
        if item.get("type") in {"diagnostic_test", "repair_action"}:
            safety = item.get("safety", {})
            if not safety.get("stop_conditions"):
                errors.append(f"{object_id}: safety stop_conditions required")
        for reference in item.get("pass_effect", []) + item.get("fail_effect", []):
            referenced_id = reference.split(" ", 1)[0]
            if referenced_id not in failure_ids and referenced_id not in seen and not any(obj.get("id") == referenced_id for obj in objects):
                errors.append(f"{object_id}: unknown effect reference {referenced_id}")
    return errors


if __name__ == "__main__":
    problems = validate()
    if problems:
        print("\n".join(problems))
        raise SystemExit(1)
    print("Knowledge dataset valid")

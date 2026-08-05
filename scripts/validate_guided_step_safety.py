from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "ai" / "data"


def validate() -> list[str]:
    steps = json.loads((DATA / "diagnostic_steps.json").read_text())["diagnostic_steps"]
    safety = json.loads((DATA / "step_safety.json").read_text())["step_safety"]
    step_ids = {step["id"] for step in steps}
    safety_by_id = {item.get("step_id"): item for item in safety}
    errors: list[str] = []
    if len(safety_by_id) != len(safety):
        errors.append("duplicate safety step_id")
    for step_id in sorted(step_ids):
        item = safety_by_id.get(step_id)
        if not item:
            errors.append(f"missing safety metadata: {step_id}")
            continue
        for field in ("level", "required_ppe", "authority_required", "stop_conditions", "preconditions", "observation_required"):
            if field not in item:
                errors.append(f"{step_id}: missing {field}")
        if not item.get("stop_conditions"):
            errors.append(f"{step_id}: stop_conditions must not be empty")
        if not item.get("observation_required"):
            errors.append(f"{step_id}: post-test observation must be required")
    for step_id in safety_by_id:
        if step_id not in step_ids:
            errors.append(f"orphan safety metadata: {step_id}")
    return errors


if __name__ == "__main__":
    errors = validate()
    if errors:
        print("\n".join(errors))
        raise SystemExit(1)
    print("Guided-step safety metadata valid")

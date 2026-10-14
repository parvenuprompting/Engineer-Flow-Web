// Bewijst dat engine.ts het canonieke import-oppervlak is voor de
// deterministische procedurekern (SCR/NOx-proceduregate + degradatieslice).
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateHistoryDegradation, parseScrProfile, runScrWorkflow, validateIntake } from "../src/efl_core/engine";
import { runScrWorkflow as runScrWorkflowDirect } from "../src/efl_core/scr_workflow";
import { scrIntake, syntheticProfile } from "./scr_fixtures";

test("engine.ts ontsluit de procedurekern en geeft identiek gedrag als de module zelf", () => {
  assert.equal(runScrWorkflow, runScrWorkflowDirect);
  assert.equal(typeof validateIntake, "function");
  assert.equal(typeof parseScrProfile, "function");
  assert.equal(typeof evaluateHistoryDegradation, "function");
  const viaEngine = runScrWorkflow(JSON.stringify(scrIntake), syntheticProfile);
  const direct = runScrWorkflowDirect(JSON.stringify(scrIntake), syntheticProfile);
  assert.deepEqual(viaEngine, direct);
  assert.equal(viaEngine.ok, true);
  if (viaEngine.ok) {
    assert.equal(viaEngine.decision.replacement.allowed, false);
  }
});

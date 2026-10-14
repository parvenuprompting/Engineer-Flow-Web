interface MandatoryAction {
  readonly id: string;
  readonly mandatory: true;
  readonly instruction: string;
  readonly reasonCodes: readonly string[];
}

export type RequiredAction = MandatoryAction & (
  | { readonly kind: "clarify"; readonly questionId: string; readonly allowedAnswerIds: readonly string[] }
  | { readonly kind: "measure"; readonly procedureId: string; readonly requiredSignalIds: readonly string[];
      readonly profileId: string; readonly componentInstanceId: string; readonly visitId: string }
  | { readonly kind: "verify_history"; readonly componentInstanceId: string | null;
      readonly missingEvent: "installation" | "replacement" | "baseline" }
);

/** A blocked result always has exactly one first action. UI cannot select a later step. */
export interface ActionableGap {
  readonly status: "knowledge_gap" | "clarification_required";
  readonly missing: readonly string[];
  readonly nextAction: RequiredAction;
}

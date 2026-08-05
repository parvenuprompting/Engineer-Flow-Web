export type FeatureName = "canAnalysis";

/**
 * Features that are not production-ready must be disabled on the server by default.
 * A public override is only used for presentation; server actions enforce the same flag.
 */
export function isFeatureEnabled(feature: FeatureName): boolean {
  switch (feature) {
    case "canAnalysis":
      return process.env.FEATURE_CAN_ANALYSIS === "true";
    default:
      return false;
  }
}

export const publicFeatures = {
  canAnalysis: process.env.NEXT_PUBLIC_FEATURE_CAN_ANALYSIS === "true",
};

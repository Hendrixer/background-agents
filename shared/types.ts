export const SCENARIOS = ["feature-rollout", "faulty-release", "upstream-outage"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const EVENT_TYPES = ["health", "log", "deployment", "dependency"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ACTIONS = ["inspect_logs", "inspect_changes", "disable_feature", "rollback_release", "request_help", "complete"] as const;
export type ActionName = (typeof ACTIONS)[number];

export type LabSnapshot = {
  id: string;
  scenario: Scenario;
  running: boolean;
  rate: number;
  eventTypes: EventType[];
  failNextAction: boolean;
  featureEnabled: boolean;
  release: string;
  upstreamHealthy: boolean;
  healthy: boolean;
  errorRate: number;
  lastObservationAt: string | null;
};

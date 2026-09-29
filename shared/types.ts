export const ACTIONS = ["inspect_logs", "inspect_changes", "disable_feature", "rollback_release", "request_help", "complete", "defer"] as const;
export type ActionName = (typeof ACTIONS)[number];

export type WorldState = Record<string, unknown>;
export type GoalCondition = { path: string; equals: string | number | boolean } | null;

export type EnvironmentSnapshot = {
  id: string;
  state: WorldState;
  version: number;
  goal: string;
  goalCondition: GoalCondition;
  failNextAction: boolean;
};

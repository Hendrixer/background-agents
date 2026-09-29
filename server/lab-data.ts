import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { actions, approvals, events, environments, runs, timeline } from "./schema";
import { startRun } from "./agent-data";
import type { ActionName, EnvironmentSnapshot, GoalCondition, WorldState } from "../shared/types";

const DEFAULT_STATE: WorldState = {
  service: "checkout",
  health: { status: "healthy", errorRate: 1 },
  release: "v1-stable",
  featureEnabled: false,
  upstreamHealthy: true,
};
const DEFAULT_GOAL = "Restore checkout service health. Inspect evidence, ask for approval before disruptive changes, and report the outcome.";
const DEFAULT_CONDITION: GoalCondition = { path: "health.status", equals: "healthy" };

export async function activeEnvironment() {
  const [environment] = await db.select().from(environments).orderBy(desc(environments.createdAt)).limit(1);
  return environment ?? null;
}

export async function findEnvironment(environmentId: string) {
  const [environment] = await db.select().from(environments).where(eq(environments.id, environmentId)).limit(1);
  if (!environment) throw new Error("Environment not found");
  return environment;
}

export async function ensureEnvironment() {
  const current = await activeEnvironment();
  if (current) {
    // Existing workshop databases may predate the JSON state column.
    if (Object.keys(current.state).length > 0) return current;
    const [updated] = await db.update(environments).set({ state: DEFAULT_STATE, goal: DEFAULT_GOAL, goalCondition: DEFAULT_CONDITION }).where(eq(environments.id, current.id)).returning();
    return updated;
  }
  const [created] = await db.insert(environments).values({
    id: randomUUID(),
    scenario: "legacy-unused", eventTypes: [], featureEnabled: false,
    release: "unused", upstreamHealthy: true,
    state: DEFAULT_STATE, goal: DEFAULT_GOAL, goalCondition: DEFAULT_CONDITION,
  }).returning();
  return created;
}

export async function snapshot(environmentId: string): Promise<EnvironmentSnapshot> {
  const environment = await findEnvironment(environmentId);
  return {
    id: environment.id,
    state: environment.state,
    version: environment.version,
    goal: environment.goal,
    goalCondition: environment.goalCondition,
    failNextAction: environment.failNextAction,
  };
}

export async function dashboard() {
  const environment = await ensureEnvironment();
  const [recentEvents, recentRuns, recentApprovals] = await Promise.all([
    db.select().from(events).where(eq(events.environmentId, environment.id)).orderBy(desc(events.createdAt)).limit(400),
    db.select().from(runs).where(eq(runs.environmentId, environment.id)).orderBy(desc(runs.startedAt)).limit(100),
    db.select().from(approvals).where(eq(approvals.environmentId, environment.id)).orderBy(desc(approvals.createdAt)).limit(100),
  ]);
  return { environment: await snapshot(environment.id), events: recentEvents, runs: recentRuns, approvals: recentApprovals };
}

// Editing the simulated world never invokes the agent. The next event is the trigger.
export async function setWorldState(environmentId: string, state: WorldState) {
  const [updated] = await db.update(environments).set({ state, version: sql`${environments.version} + 1` }).where(eq(environments.id, environmentId)).returning();
  if (!updated) throw new Error("Environment not found");
  return snapshot(environmentId);
}

export async function setAgentGoal(environmentId: string, goal: string, goalCondition: GoalCondition) {
  const [updated] = await db.update(environments).set({ goal, goalCondition }).where(eq(environments.id, environmentId)).returning();
  if (!updated) throw new Error("Environment not found");
  return snapshot(environmentId);
}

// Every event gets its own run. Its payload is a signal; the run reads latest state.
export async function emitServiceEvent(environmentId: string, type: string, data: Record<string, unknown>) {
  const environment = await findEnvironment(environmentId);
  const eventId = randomUUID();
  const [saved] = await db.insert(events).values({ id: eventId, environmentId: environmentId, type, data }).returning();
  await db.insert(timeline).values({ id: randomUUID(), environmentId: environmentId, kind: "event", message: `${type} event`, detail: { eventId, data, stateVersion: environment.version } });
  const run = await startRun(environmentId, eventId, environment.goal, environment.goalCondition);
  return { event: saved, run };
}

export async function applyAction(environmentId: string, actionId: string, name: ActionName, input: Record<string, unknown> = {}) {
  const [prior] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  if (prior) {
    if (prior.environmentId !== environmentId || prior.name !== name || JSON.stringify(prior.input) !== JSON.stringify(input)) throw new Error("Action ID conflict");
    return prior.result;
  }

  return db.transaction(async (tx) => {
    const [environment] = await tx.select().from(environments).where(eq(environments.id, environmentId)).limit(1).for("update");
    if (!environment) throw new Error("Environment not found");
    if ((name === "disable_feature" || name === "rollback_release") && environment.version !== input.expectedVersion) {
      return { stale: true, currentVersion: environment.version };
    }
    const state = { ...environment.state };
    let result: Record<string, unknown>;
    switch (name) {
      case "inspect_logs": {
        const recent = await tx.select().from(events).where(eq(events.environmentId, environmentId)).orderBy(desc(events.createdAt)).limit(5);
        result = { events: recent.map((event) => ({ type: event.type, data: event.data })) };
        break;
      }
      case "inspect_changes":
        result = { state, version: environment.version };
        break;
      case "disable_feature":
        state.featureEnabled = false;
        result = { featureEnabled: false };
        break;
      case "rollback_release":
        state.release = "v1-stable";
        result = { release: state.release };
        break;
      default:
        throw new Error(`Action ${name} is a harness terminal action, not a service operation`);
    }

    const [inserted] = await tx.insert(actions).values({ id: actionId, environmentId: environmentId, name, input, result }).onConflictDoNothing().returning();
    if (!inserted) {
      const [existing] = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
      if (!existing || existing.environmentId !== environmentId || existing.name !== name || JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error("Action ID conflict");
      return existing.result;
    }
    if (name === "disable_feature" || name === "rollback_release") {
      await tx.update(environments).set({ state, version: sql`${environments.version} + 1` }).where(eq(environments.id, environmentId));
    }
    const runId = actionId.split(":")[0];
    await tx.insert(timeline).values({ id: randomUUID(), environmentId: environmentId, runId, kind: "agent:act", message: `${name.replaceAll("_", " ")} applied`, detail: { actionId, ...result } });
    return result;
  });
}

export async function setFailureInjection(environmentId: string, enabled: boolean) {
  await db.update(environments).set({ failNextAction: enabled }).where(eq(environments.id, environmentId));
}

export async function consumeFailureInjection(environmentId: string) {
  const environment = await findEnvironment(environmentId);
  if (!environment.failNextAction) return false;
  await db.update(environments).set({ failNextAction: false }).where(eq(environments.id, environmentId));
  return true;
}

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { actions, approvals, eventPlans, events, labs, observations, runs, timeline } from "./schema";
import { inngest } from "./inngest";
import { EVENT_TYPES, type ActionName, type EventType, type LabSnapshot, type Scenario } from "../shared/types";

type Lab = typeof labs.$inferSelect;

export function serviceHealth(lab: Lab) {
  let healthy = true;

  if (lab.scenario === "feature-rollout" && lab.featureEnabled) healthy = false;
  if (lab.scenario === "faulty-release" && lab.release === "v2-bad") healthy = false;
  if (lab.scenario === "upstream-outage" && !lab.upstreamHealthy) healthy = false;

  return { healthy, errorRate: healthy ? 1 : 42 };
}

export async function activeLab() {
  const [lab] = await db.select().from(labs).orderBy(desc(labs.createdAt)).limit(1);
  return lab || null;
}

export async function findLab(labId: string) {
  const [lab] = await db.select().from(labs).where(eq(labs.id, labId)).limit(1);
  if (!lab) throw new Error("Lab instance not found");
  return lab;
}

export async function resetLab(scenario: Scenario, seed = 1) {
  const previous = await activeLab();
  if (previous?.running) {
    await db.update(labs).set({ running: false }).where(eq(labs.id, previous.id));
    await db.update(eventPlans).set({ status: "stopped" }).where(and(eq(eventPlans.labId, previous.id), eq(eventPlans.status, "running")));
  }
  const [lab] = await db.insert(labs).values({
    id: randomUUID(),
    scenario,
    seed,
    eventTypes: ["health", "log"],
    featureEnabled: true,
    release: scenario === "faulty-release" ? "v2-bad" : "v1-stable",
    upstreamHealthy: scenario !== "upstream-outage",
  }).returning();

  await addTimeline(lab.id, "lab", `Loaded ${scenario.replaceAll("-", " ")} scenario`);
  return lab;
}

export async function ensureLab() {
  return (await activeLab()) || resetLab("feature-rollout");
}

export async function addTimeline(labId: string, kind: string, message: string, detail?: Record<string, unknown>, runId?: string) {
  await db.insert(timeline).values({ id: randomUUID(), labId, runId, kind, message, detail });
}

export async function snapshot(labId: string): Promise<LabSnapshot> {
  const lab = await findLab(labId);
  const [last] = await db.select().from(observations).where(eq(observations.labId, labId)).orderBy(desc(observations.createdAt)).limit(1);
  return {
    id: lab.id,
    scenario: lab.scenario as Scenario,
    running: lab.running,
    rate: lab.rate,
    eventTypes: lab.eventTypes as EventType[],
    failNextAction: lab.failNextAction,
    featureEnabled: lab.featureEnabled,
    release: lab.release,
    upstreamHealthy: lab.upstreamHealthy,
    ...serviceHealth(lab),
    lastObservationAt: last?.createdAt.toISOString() || null,
  };
}

export async function dashboard(labId?: string) {
  const lab = labId ? await findLab(labId) : await ensureLab();
  const [recentEvents, recentObservations, recentActions, recentRuns, recentApprovals, recentPlans] = await Promise.all([
    db.select().from(events).where(eq(events.labId, lab.id)).orderBy(desc(events.createdAt)).limit(400),
    db.select().from(observations).where(eq(observations.labId, lab.id)).orderBy(desc(observations.createdAt)).limit(12),
    db.select().from(actions).where(eq(actions.labId, lab.id)).orderBy(desc(actions.createdAt)).limit(20),
    db.select().from(runs).where(eq(runs.labId, lab.id)).orderBy(desc(runs.startedAt)).limit(100),
    db.select().from(approvals).where(eq(approvals.labId, lab.id)).orderBy(desc(approvals.createdAt)).limit(12),
    db.select().from(eventPlans).where(eq(eventPlans.labId, lab.id)).orderBy(desc(eventPlans.createdAt)).limit(1),
  ]);

  return {
    lab: await snapshot(lab.id),
    events: recentEvents,
    observations: recentObservations,
    actions: recentActions,
    runs: recentRuns,
    approvals: recentApprovals,
    plan: recentPlans[0] ?? null,
  };
}

export async function activeEventPlan(labId: string) {
  const [plan] = await db.select().from(eventPlans).where(and(eq(eventPlans.labId, labId), eq(eventPlans.status, "running"))).orderBy(desc(eventPlans.createdAt)).limit(1);
  return plan ?? null;
}

export async function startEventPlan(labId: string, input: { total: number; intervalMs: number; weights: Record<EventType, number> }) {
  const current = await activeLab();
  if (current?.id !== labId) throw new Error("Only the active scenario can send events");
  return db.transaction(async (tx) => {
    await tx.update(eventPlans).set({ status: "stopped" }).where(and(eq(eventPlans.labId, labId), eq(eventPlans.status, "running")));
    const [plan] = await tx.insert(eventPlans).values({ id: randomUUID(), labId, total: input.total, intervalMs: input.intervalMs, weights: input.weights, status: "running" }).returning();
    await tx.update(labs).set({ running: true }).where(eq(labs.id, labId));
    return plan;
  });
}

export async function stopEventPlan(labId: string) {
  const current = await activeLab();
  if (current?.id !== labId) throw new Error("Only the active scenario can stop events");
  await db.transaction(async (tx) => {
    await tx.update(eventPlans).set({ status: "stopped" }).where(and(eq(eventPlans.labId, labId), eq(eventPlans.status, "running")));
    await tx.update(labs).set({ running: false }).where(eq(labs.id, labId));
  });
}

export function nextPlanEventType(plan: typeof eventPlans.$inferSelect): EventType {
  const types = EVENT_TYPES.filter((type) => (plan.weights[type] ?? 0) > 0);
  const quotas = Object.fromEntries(types.map((type) => [type, Math.floor(plan.total * plan.weights[type] / 100)])) as Record<EventType, number>;
  let remaining = plan.total - types.reduce((sum, type) => sum + quotas[type], 0);
  for (const type of [...types].sort((a, b) => (plan.total * plan.weights[b] % 100) - (plan.total * plan.weights[a] % 100))) {
    if (remaining-- <= 0) break;
    quotas[type] += 1;
  }
  const used = Object.fromEntries(types.map((type) => [type, 0])) as Record<EventType, number>;
  let chosen = types[0];
  for (let index = 0; index <= plan.sent; index++) {
    chosen = types.filter((type) => used[type] < quotas[type]).sort((a, b) => {
      const aDebt = quotas[a] * (index + 1) / plan.total - used[a];
      const bDebt = quotas[b] * (index + 1) / plan.total - used[b];
      return bDebt - aDebt;
    })[0];
    used[chosen] += 1;
  }
  return chosen;
}

function eventData(lab: Lab, type: EventType) {
  const health = serviceHealth(lab);
  switch (type) {
    case "health":
      return { service: "checkout", ...health };
    case "log":
      return { level: health.healthy ? "info" : "error", message: health.healthy ? "Checkout requests completed" : "Checkout requests failing", release: lab.release };
    case "deployment":
      return { release: lab.release, featureEnabled: lab.featureEnabled };
    case "dependency":
      return { upstreamHealthy: lab.upstreamHealthy, message: lab.upstreamHealthy ? "Payment gateway responding" : "Payment gateway unavailable" };
  }
}

export async function emitLabEvent(labId: string, forcedType?: EventType, planId?: string) {
  const lab = await findLab(labId);
  const types = lab.eventTypes as EventType[];
  const type = forcedType || types[(lab.seed + lab.counter) % types.length];
  const data = eventData(lab, type);
  const eventId = randomUUID();

  await db.transaction(async (tx) => {
    if (planId) {
      const [plan] = await tx.select().from(eventPlans).where(and(eq(eventPlans.id, planId), eq(eventPlans.status, "running"))).limit(1);
      if (!plan || plan.labId !== labId || plan.sent >= plan.total) throw new Error("Event plan is no longer running");
      const finished = plan.sent + 1 >= plan.total;
      await tx.update(eventPlans).set({ sent: plan.sent + 1, status: finished ? "completed" : "running" }).where(eq(eventPlans.id, planId));
      if (finished) await tx.update(labs).set({ running: false }).where(eq(labs.id, labId));
    }
    await tx.update(labs).set({ counter: sql`${labs.counter} + 1` }).where(eq(labs.id, labId));
    await tx.insert(events).values({ id: eventId, labId, type, data });
    if (type === "health") {
      const health = serviceHealth(lab);
      await tx.insert(observations).values({ id: randomUUID(), labId, ...health });
    }
    await tx.insert(timeline).values({ id: randomUUID(), labId, kind: "event", message: `${type} event`, detail: data });
  });

  try {
    await inngest.send({ name: "lab/observation", data: { labId, eventId, type, planId } });
  } catch (error) {
    console.warn("Inngest event delivery failed; local event was saved", error);
  }
  return { id: eventId, labId, type, data };
}

export async function applyAction(labId: string, actionId: string, name: ActionName, input: Record<string, unknown> = {}) {
  const [prior] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  if (prior) {
    if (prior.labId !== labId) throw new Error("Action ID belongs to a different lab instance");
    return prior.result;
  }

  return db.transaction(async (tx) => {
    const [lab] = await tx.select().from(labs).where(eq(labs.id, labId)).limit(1);
    if (!lab) throw new Error("Lab instance not found");
    let result: Record<string, unknown>;

    switch (name) {
      case "disable_feature":
        result = { featureEnabled: false, message: "Feature disabled" };
        break;
      case "rollback_release":
        result = { release: "v1-stable", message: "Release rolled back" };
        break;
      case "inspect_logs": {
        const recent = await tx.select().from(events).where(and(eq(events.labId, labId), eq(events.type, "log"))).orderBy(desc(events.createdAt)).limit(5);
        result = { logs: recent.map((event) => event.data), message: "Recent service logs" };
        break;
      }
      case "inspect_changes":
        result = { release: lab.release, featureEnabled: lab.featureEnabled, upstreamHealthy: lab.upstreamHealthy, message: "Current deployment state" };
        break;
      case "request_help":
        result = { message: "Help requested", question: input.question || "What should the agent do?" };
        break;
      case "complete":
        result = { message: "Completion requested" };
        break;
    }

    const [inserted] = await tx.insert(actions).values({ id: actionId, labId, name, input, result }).onConflictDoNothing().returning();
    if (!inserted) {
      const [existing] = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
      if (!existing || existing.labId !== labId) throw new Error("Action ID conflict");
      return existing.result;
    }

    if (name === "disable_feature") await tx.update(labs).set({ featureEnabled: false }).where(eq(labs.id, labId));
    if (name === "rollback_release") await tx.update(labs).set({ release: "v1-stable" }).where(eq(labs.id, labId));
    const candidateRunId = actionId.split(":")[0];
    const [actionRun] = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateRunId)
      ? await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.id, candidateRunId), eq(runs.labId, labId))).limit(1)
      : [];
    await tx.insert(timeline).values({ id: randomUUID(), labId, runId: actionRun?.id ?? null, kind: "agent:act", message: `${name.replaceAll("_", " ")} applied`, detail: { actionId, ...result } });
    return result;
  });
}

export async function recoverUpstream(labId: string) {
  await db.update(labs).set({ upstreamHealthy: true }).where(eq(labs.id, labId));
  await addTimeline(labId, "lab", "External dependency recovered");
  return emitLabEvent(labId, "dependency");
}

export async function setFailureInjection(labId: string, enabled: boolean) {
  await db.update(labs).set({ failNextAction: enabled }).where(eq(labs.id, labId));
  await addTimeline(labId, "lab", enabled ? "Next tool acknowledgement will be lost" : "Tool acknowledgement fault cleared");
}

export async function consumeFailureInjection(labId: string) {
  const lab = await findLab(labId);
  if (!lab.failNextAction) return false;
  await db.update(labs).set({ failNextAction: false }).where(eq(labs.id, labId));
  return true;
}

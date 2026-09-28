import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { actions, approvals, events, observations, runs, timeline } from "./schema";
import { activeLab, findLab, serviceHealth } from "./lab-data";
import { inngest } from "./inngest";
import { logAgentActivity } from "./agent-log";
import type { ActionName } from "../shared/types";

export async function startRun(labId: string, goal: string) {
  const current = await activeLab();
  if (current?.id !== labId) throw new Error("Start a run on the active lab instance");
  const [existing] = await db.select().from(runs).where(and(eq(runs.labId, labId), inArray(runs.status, ["running", "waiting", "needs_approval", "needs_help"]))).limit(1);
  if (existing) return existing;

  const [run] = await db.insert(runs).values({ id: randomUUID(), labId, goal, status: "running" }).returning();
  await logAgentActivity(labId, run.id, "start", "Goal accepted", { goal });
  try {
    await inngest.send({ id: `start-${run.id}`, name: "lab/run.started", data: { labId, runId: run.id } });
  } catch (error) {
    await setRun(run.id, "failed", "Could not enqueue the run");
    throw error;
  }
  return run;
}

export async function getRun(runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error("Agent run not found");
  return run;
}

export async function setRun(runId: string, status: string, waitReason: string | null = null, report?: string) {
  const run = await getRun(runId);
  if (["completed", "cancelled", "failed", "escalated"].includes(run.status)) return run;
  const [updated] = await db.update(runs).set({ status, waitReason, report: report ?? run.report, updatedAt: new Date() }).where(eq(runs.id, runId)).returning();
  const phase = ["completed", "cancelled", "failed", "escalated"].includes(status)
    ? "terminal" : status === "waiting" ? "pause" : status.startsWith("needs_") ? "human" : "resume";
  if (status !== run.status || status === "waiting") {
    await logAgentActivity(run.labId, runId, phase, `Run ${status.replaceAll("_", " ")}`, { waitReason });
  }
  return updated;
}

export async function setIteration(runId: string, iteration: number) {
  await db.update(runs).set({ iteration, status: "running", waitReason: null, updatedAt: new Date() }).where(and(eq(runs.id, runId), inArray(runs.status, ["running", "waiting", "needs_approval", "needs_help"])));
}

export async function cancelRun(runId: string) {
  const run = await setRun(runId, "cancelled", "Cancelled by operator");
  await inngest.send({ name: "lab/run.cancelled", data: { runId, labId: run.labId } });
  return run;
}

export async function agentState(labId: string, runId: string) {
  const lab = await findLab(labId);
  const [recentObservations, recentEvents, recentActions, recentApprovals] = await Promise.all([
    db.select().from(observations).where(eq(observations.labId, labId)).orderBy(desc(observations.createdAt)).limit(12),
    db.select().from(events).where(eq(events.labId, labId)).orderBy(desc(events.createdAt)).limit(8),
    db.select().from(actions).where(eq(actions.labId, labId)).orderBy(desc(actions.createdAt)).limit(8),
    db.select().from(approvals).where(eq(approvals.labId, labId)).orderBy(desc(approvals.createdAt)).limit(4),
  ]);

  const state = {
    labId,
    service: { release: lab.release, featureEnabled: lab.featureEnabled, upstreamHealthy: lab.upstreamHealthy, ...serviceHealth(lab) },
    observations: recentObservations.map((item) => ({ healthy: item.healthy, errorRate: item.errorRate, at: item.createdAt.toISOString() })),
    events: recentEvents.map((item) => ({ type: item.type, data: item.data, at: item.createdAt.toISOString() })),
    actions: recentActions.map((item) => ({ name: item.name, result: item.result, at: item.createdAt.toISOString() })),
    humanDecisions: recentApprovals.filter((item) => item.status !== "pending").map((item) => ({ action: item.action, status: item.status, answer: item.reason })),
  };

  const run = await getRun(runId);
  if (run.labId !== labId) throw new Error("Run belongs to a different lab instance");
  if (run.status === "waiting") {
    await logAgentActivity(labId, runId, "resume", "Woke to recheck the service", { afterDecision: run.iteration });
  }
  await logAgentActivity(labId, runId, "observe", "Observed current service state", {
    healthy: state.service.healthy,
    errorRate: state.service.errorRate,
    release: state.service.release,
    featureEnabled: state.service.featureEnabled,
    upstreamHealthy: state.service.upstreamHealthy,
    latestObservationAt: state.observations[0]?.at ?? null,
  });
  return state;
}

export type AgentState = Awaited<ReturnType<typeof agentState>>;

export async function recordDecision(labId: string, runId: string, iteration: number, action: string, reason: string) {
  await logAgentActivity(labId, runId, "loop", `Decision cycle ${iteration}`, { iteration });
  await logAgentActivity(labId, runId, "predict", `Selected ${action.replaceAll("_", " ")}`, { iteration, action, reason });
}

export async function proposeAction(labId: string, runId: string, actionId: string, action: ActionName, input: Record<string, unknown>) {
  const [proposal] = await db.insert(approvals).values({
    id: randomUUID(), labId, runId, actionId, action, input, status: "pending",
    expiresAt: new Date(Date.now() + 10 * 60_000),
  }).returning();
  await setRun(runId, action === "request_help" ? "needs_help" : "needs_approval", action === "request_help" ? "Waiting for an answer" : `Waiting for ${action.replaceAll("_", " ")} approval`);
  await logAgentActivity(labId, runId, "human", action === "request_help" ? "Asked a human for help" : `Requested approval for ${action.replaceAll("_", " ")}`, { proposalId: proposal.id, ...input });
  return proposal;
}

export async function getProposal(proposalId: string) {
  const [proposal] = await db.select().from(approvals).where(eq(approvals.id, proposalId)).limit(1);
  if (!proposal) throw new Error("Approval request not found");
  if (proposal.status === "pending" && proposal.expiresAt.getTime() < Date.now()) {
    const [expired] = await db.update(approvals).set({ status: "expired", decidedAt: new Date() }).where(eq(approvals.id, proposalId)).returning();
    return expired;
  }
  return proposal;
}

export async function decideProposal(proposalId: string, status: "approved" | "rejected", reason?: string) {
  const proposal = await getProposal(proposalId);
  if (proposal.status !== "pending") return proposal;
  if (proposal.action === "request_help" && status === "approved" && !reason?.trim()) {
    throw new Error("An answer is required before the agent can continue");
  }
  const [updated] = await db.update(approvals).set({ status, reason, decidedAt: new Date() }).where(and(eq(approvals.id, proposalId), eq(approvals.status, "pending"))).returning();
  if (!updated) return getProposal(proposalId);
  await logAgentActivity(proposal.labId, proposal.runId, "human", proposal.action === "request_help" ? status === "approved" ? "Human answered help request" : "Human could not help" : `${proposal.action.replaceAll("_", " ")} ${status}`, { proposalId, reason });
  try {
    await inngest.send({ name: "lab/approval.decided", data: { proposalId, labId: proposal.labId, runId: proposal.runId } });
  } catch (error) {
    console.warn("Approval saved; wake event failed and the run will reconcile on timeout", error);
  }
  return updated;
}

export async function staleProposal(proposalId: string) {
  const proposal = await getProposal(proposalId);
  await db.update(approvals).set({ status: "stale", reason: "Service changed before this action ran", decidedAt: new Date() }).where(eq(approvals.id, proposalId));
  await logAgentActivity(proposal.labId, proposal.runId, "human", "Approved action became stale", { proposalId });
}

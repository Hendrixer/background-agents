import { agentState, getProposal, getRun, goalSatisfied, proposeAction, recordDecision, setIteration, setRun, staleProposal } from "./agent-data";
import { chooseAction, writeReport } from "./agent-brain";
import { inngest } from "./inngest";
import { logAgentActivity } from "./agent-log";
import { actionPolicy } from "./tool-policy";
import type { ActionName } from "../shared/types";

async function executeAction(environmentId: string, runId: string, actionId: string, name: ActionName, expectedVersion?: number) {
  await logAgentActivity(environmentId, runId, "act", `Calling ${name.replaceAll("_", " ")}`, { actionId });
  try {
    const response = await fetch("http://127.0.0.1:3001/api/ops/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environmentId, actionId, name, input: expectedVersion === undefined ? {} : { expectedVersion } }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Tool failed: ${response.status}`);
    await logAgentActivity(environmentId, runId, "act", `${name.replaceAll("_", " ")} returned successfully`, { actionId, result });
    return result;
  } catch (error) {
    await logAgentActivity(environmentId, runId, "act", `${name.replaceAll("_", " ")} attempt failed`, {
      actionId, error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const incidentAgent = inngest.createFunction(
  {
    id: "incident-agent",
    name: "Event-triggered background agent",
    triggers: { event: "service/event.received" },
    retries: 2,
    cancelOn: [{ event: "agent/run.cancelled", match: "data.runId" }],
    // Separate events create separate runs. Only one step per environment executes
    // at a time; a waiting human approval does not block later runs.
    concurrency: { limit: 1, key: "event.data.environmentId" },
    onFailure: async ({ error, event }) => {
      const original = event.data.event as { data?: { runId?: string } };
      if (original.data?.runId) await setRun(original.data.runId, "failed", error.message);
    },
  },
  async ({ event, step }) => {
    const { environmentId, runId } = event.data;
    const run = await getRun(runId);
    if (["completed", "failed", "cancelled", "escalated", "deferred"].includes(run.status)) return;

    for (let cycle = 1; cycle <= 8; cycle++) {
      if ((await getRun(runId)).status === "cancelled") return;
      const state = await step.run(`observe-state-${cycle}`, () => agentState(environmentId, runId));

      if (goalSatisfied(state, run.goalCondition)) {
        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
        await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
        return { report };
      }

      const decision = await step.run(`choose-action-${cycle}`, () => chooseAction(run.goal, state));
      await step.run(`set-iteration-${cycle}`, () => setIteration(runId, cycle));
      await step.run(`record-decision-${cycle}`, () => recordDecision(environmentId, runId, cycle, decision.action, decision.reason));

      if (decision.action === "defer") {
        await step.run(`defer-run-${cycle}`, () => setRun(runId, "deferred", decision.reason));
        return;
      }
      if (decision.action === "complete") {
        if (run.goalCondition) {
          await step.run(`reject-completion-${cycle}`, () => logAgentActivity(environmentId, runId, "human", "Completion blocked by configured goal condition", { condition: run.goalCondition }));
          await step.run(`defer-unverified-${cycle}`, () => setRun(runId, "deferred", "Configured goal condition is not satisfied"));
          return;
        }
        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
        await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
        return { report };
      }

      if (decision.action === "request_help") {
        await step.run(`help-not-implemented-${cycle}`, () => setRun(runId, "escalated", "Help requests are added in lesson 6"));
        return;
      }
      const actionId = `${runId}:${cycle}:${decision.action}`;
      const policy = actionPolicy[decision.action];
      if (policy === "approval") {
        const input = { expectedVersion: state.world.version };
        const proposalId = await step.run(`propose-action-${cycle}`, async () => {
          const proposal = await proposeAction(environmentId, runId, actionId, decision.action, input);
          return proposal.id;
        });

        let proposal = await step.run(`read-approval-${cycle}`, () => getProposal(proposalId));
        let check = 0;
        while (proposal.status === "pending") {
          check++;
          await step.waitForEvent(`wait-for-human-${cycle}-${check}`, {
            event: "agent/approval.decided",
            if: `async.data.proposalId == "${proposalId}"`,
            timeout: "10s",
          });
          proposal = await step.run(`reconcile-human-${cycle}-${check}`, () => getProposal(proposalId));
        }
        if (proposal.status !== "approved") {
          await step.run(`stop-after-human-${cycle}`, () => setRun(runId, "escalated", `Human decision: ${proposal.status}`));
          return;
        }
        const fresh = await step.run(`recheck-approved-state-${cycle}`, () => agentState(environmentId, runId));
        if (fresh.world.version !== input.expectedVersion) {
          await step.run(`invalidate-approval-${cycle}`, () => staleProposal(proposalId));
          await step.run(`defer-stale-${cycle}`, () => setRun(runId, "deferred", "State changed; a new event can start a new run"));
          return;
        }
      }

      const result = await step.run(`execute-action-${cycle}`, () =>
        executeAction(environmentId, runId, actionId, decision.action, policy === "read" ? undefined : state.world.version));
      if (result.stale === true) {
        await step.run(`defer-stale-action-${cycle}`, () => setRun(runId, "deferred", "State changed before the action; a new event will start a new run"));
        return;
      }
      await step.run(`settle-status-${cycle}`, () => setRun(runId, "waiting", "Waiting briefly before observing tool effects"));
      await step.sleep(`settle-${cycle}`, "2s");
    }

    await step.run("stop-at-limit", () => setRun(runId, "escalated", "Decision limit reached"));
  },
);

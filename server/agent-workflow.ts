import { activeLab, addTimeline } from "./lab-data";
import { agentState, getProposal, getRun, hasRecovered, proposeAction, recordDecision, setIteration, setRun, staleProposal } from "./agent-data";
import { chooseAction, writeReport } from "./agent-brain";
import { inngest } from "./inngest";

async function executeAction(labId: string, actionId: string, name: string) {
  const response = await fetch("http://127.0.0.1:3001/api/ops/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labId, actionId, name }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Tool failed: ${response.status}`);
  return result;
}

export const incidentAgent = inngest.createFunction(
  {
    id: "incident-agent",
    name: "Incident response agent",
    triggers: { event: "lab/run.started" },
    retries: 2,
    cancelOn: [{ event: "lab/run.cancelled", match: "data.runId" }],
    onFailure: async ({ error, event }) => {
      const original = event.data.event as { data?: { runId?: string } };
      if (original.data?.runId) await setRun(original.data.runId, "failed", error.message);
    },
  },
  async ({ event, step }) => {
    const { labId, runId } = event.data;
    const run = await getRun(runId);
    if (["completed", "failed", "cancelled", "escalated"].includes(run.status)) return;

    let decisions = 0;
    let cycle = 0;
    while (decisions < 12) {
      cycle += 1;
      const currentLab = await activeLab();
      const currentRun = await getRun(runId);
      if (currentRun.status === "cancelled") return;
      if (currentLab?.id !== labId) {
        await step.run(`scenario-reset-${cycle}`, () => setRun(runId, "cancelled", "Scenario was reset"));
        return;
      }

      const state = await step.run(`observe-state-${cycle}`, () => agentState(labId));

      if (hasRecovered(state)) {
        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
        await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
        return { report };
      }

      if (state.service.healthy || state.observations.length === 0) {
        await step.run(`wait-status-${cycle}`, () => setRun(runId, "waiting", "Waiting for fresh health observations"));
        await step.waitForEvent(`wait-for-health-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
        continue;
      }

      const unresolvedHelp = state.humanDecisions.some((item) => item.action === "request_help" && item.status === "approved");
      if (!state.service.upstreamHealthy && unresolvedHelp) {
        await step.run(`wait-upstream-status-${cycle}`, () => setRun(runId, "waiting", "Waiting for the external dependency to recover"));
        await step.waitForEvent(`wait-for-upstream-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
        continue;
      }

      const decision = await step.run(`choose-action-${cycle}`, () => chooseAction(run.goal, state));
      decisions += 1;
      const iteration = decisions;
      await step.run(`set-iteration-${cycle}`, () => setIteration(runId, iteration));
      await step.run(`record-decision-${cycle}`, () => recordDecision(labId, runId, iteration, decision.action, decision.reason));

      if (decision.action === "complete") {
        await step.run(`reject-early-completion-${cycle}`, () => addTimeline(labId, "policy", "Completion rejected: recovery is not verified", {}, runId));
        await step.waitForEvent(`wait-after-early-completion-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
        continue;
      }

      const actionId = `${runId}:${iteration}:${decision.action}`;
      if (decision.action === "rollback_release" || decision.action === "request_help") {
        const input = decision.action === "rollback_release" ? { expectedRelease: state.service.release } : { question: decision.detail };
        const proposalId = await step.run(`propose-action-${cycle}`, async () => {
          const proposal = await proposeAction(labId, runId, actionId, decision.action, input);
          return proposal.id;
        });

        let approval = await step.run(`read-approval-${cycle}`, () => getProposal(proposalId));
        let approvalCheck = 0;
        while (approval.status === "pending") {
          approvalCheck += 1;
          await step.waitForEvent(`wait-for-approval-${cycle}-${approvalCheck}`, { event: "lab/approval.decided", if: `async.data.proposalId == "${proposalId}"`, timeout: "10s" });
          approval = await step.run(`reconcile-approval-${cycle}-${approvalCheck}`, () => getProposal(proposalId));
        }

        if (approval.status === "rejected" || approval.status === "expired") {
          await step.run(`stop-after-human-decision-${cycle}`, () => setRun(runId, "escalated", `Human decision: ${approval.status}`));
          return;
        }
        if (approval.status !== "approved") continue;
        if (decision.action === "request_help") continue;

        const fresh = await step.run(`recheck-rollback-${cycle}`, () => agentState(labId));
        if (fresh.service.release !== input.expectedRelease) {
          await step.run(`invalidate-approval-${cycle}`, () => staleProposal(proposalId));
          continue;
        }
      }

      await step.run(`execute-action-${cycle}`, () => executeAction(labId, actionId, decision.action));
      await step.run(`wait-status-after-action-${cycle}`, () => setRun(runId, "waiting", "Waiting for the service to report its new state"));
      await step.waitForEvent(`wait-after-action-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
    }

    await step.run("stop-at-limit", () => setRun(runId, "escalated", "Decision limit reached"));
  },
);

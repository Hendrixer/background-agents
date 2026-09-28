import { activeLab, addTimeline } from "./lab-data";
import { agentState, getRun, recordDecision, setIteration, setRun } from "./agent-data";
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
      if (currentLab?.id !== labId) {
        await step.run(`scenario-reset-${cycle}`, () => setRun(runId, "cancelled", "Scenario was reset"));
        return;
      }

      const state = await step.run(`observe-state-${cycle}`, () => agentState(labId));

      if (state.service.healthy && state.observations.length > 0) {
        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
        await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
        return { report };
      }

      if (state.service.healthy || state.observations.length === 0) {
        await step.run(`wait-status-${cycle}`, () => setRun(runId, "waiting", "Waiting for fresh health observations"));
        await step.sleep(`poll-for-health-${cycle}`, "2s");
        continue;
      }

      const decision = await step.run(`choose-action-${cycle}`, () => chooseAction(run.goal, state));
      decisions += 1;
      const iteration = decisions;
      await step.run(`set-iteration-${cycle}`, () => setIteration(runId, iteration));
      await step.run(`record-decision-${cycle}`, () => recordDecision(labId, runId, iteration, decision.action, decision.reason));

      if (decision.action === "complete") {
        await step.run(`reject-early-completion-${cycle}`, () => addTimeline(labId, "policy", "Completion rejected: recovery is not verified", {}, runId));
        await step.sleep(`poll-after-early-completion-${cycle}`, "2s");
        continue;
      }

      const actionId = `${runId}:${iteration}:${decision.action}`;
      await step.run(`execute-action-${cycle}`, () => executeAction(labId, actionId, decision.action));
      await step.run(`wait-status-after-action-${cycle}`, () => setRun(runId, "waiting", "Waiting for the service to report its new state"));
      await step.sleep(`poll-after-action-${cycle}`, "2s");
    }

    await step.run("stop-at-limit", () => setRun(runId, "escalated", "Decision limit reached"));
  },
);

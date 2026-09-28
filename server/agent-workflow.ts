import { activeLab, addTimeline } from "./lab-data";
import { agentState, getRun, recordDecision, setIteration, setRun } from "./agent-data";
import { chooseAction, writeReport } from "./agent-brain";
import { inngest } from "./inngest";
import { logAgentActivity } from "./agent-log";

async function executeAction(labId: string, actionId: string, name: string) {
  const runId = actionId.split(":")[0];
  await logAgentActivity(labId, runId, "act", `Calling ${name.replaceAll("_", " ")}`, { actionId });
  try {
    const response = await fetch("http://127.0.0.1:3001/api/ops/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labId, actionId, name }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Tool failed: ${response.status}`);
    await logAgentActivity(labId, runId, "act", `${name.replaceAll("_", " ")} returned successfully`, { actionId });
    return result;
  } catch (error) {
    await logAgentActivity(labId, runId, "act", `${name.replaceAll("_", " ")} attempt failed`, {
      actionId, error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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

    return step.run("whole-agent-loop", async () => {
      for (let iteration = 1; iteration <= 12; iteration++) {
        const currentLab = await activeLab();
        if (currentLab?.id !== labId) {
          await setRun(runId, "cancelled", "Scenario was reset");
          return;
        }

        const state = await agentState(labId, runId);
        if (state.service.healthy && state.observations.length > 0) {
          const report = await writeReport(run.goal, state);
          await setRun(runId, "completed", null, report);
          return { report };
        }

        if (state.observations.length === 0) {
          await setRun(runId, "waiting", "Waiting for the first health observation");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        const decision = await chooseAction(run.goal, state);
        await setIteration(runId, iteration);
        await recordDecision(labId, runId, iteration, decision.action, decision.reason);
        if (decision.action === "complete") {
          await addTimeline(labId, "policy", "Completion rejected: service is not healthy", {}, runId);
          continue;
        }

        await executeAction(labId, `${runId}:${iteration}:${decision.action}`, decision.action);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await setRun(runId, "escalated", "Decision limit reached");
    });
  },
);

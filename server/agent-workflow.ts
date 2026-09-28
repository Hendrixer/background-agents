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
  async ({ event }) => {
    await setRun(event.data.runId, "waiting", "Build the agent loop in lesson 1");
  },
);

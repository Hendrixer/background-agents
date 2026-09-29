import { agentState, getRun, goalSatisfied, recordDecision, setIteration, setRun , startRun } from "./agent-data";
import { chooseAction, writeReport } from "./agent-brain";
import { inngest } from "./inngest";
import { logAgentActivity } from "./agent-log";
import type { ActionName } from "../shared/types";

async function executeAction(environmentId: string, runId: string, actionId: string, name: ActionName) {
  await logAgentActivity(environmentId, runId, "act", `Calling ${name.replaceAll("_", " ")}`, { actionId });
  try {
    const response = await fetch("http://127.0.0.1:3001/api/ops/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environmentId, actionId, name }),
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
    concurrency: { limit: 1, key: "event.data.environmentId" },
    onFailure: async ({ error, event }) => {
      const original = event.data.event as { data?: { eventId?: string } };
      if (original.data?.eventId) {
        try { await setRun(original.data.eventId, "failed", error.message); }
        catch { console.error("Agent failed before its run could be recorded", error); }
      }
    },
  },
  async ({ event, step }) => {
    const { environmentId, eventId, type, payload } = event.data;
    const run = await startRun(environmentId, eventId, type, payload);
    const runId = run.id;
    return step.run("whole-agent-loop", async () => {
      for (let cycle = 1; cycle <= 8; cycle++) {
        const state = await agentState(environmentId, runId);
        if (goalSatisfied(state, run.goalCondition)) {
          const report = await writeReport(run.goal, state);
          await setRun(runId, "completed", null, report);
          return { report };
        }
        const decision = await chooseAction(run.goal, state);
        await setIteration(runId, cycle);
        await recordDecision(environmentId, runId, cycle, decision.action, decision.reason);
        if (decision.action === "defer") {
          await setRun(runId, "deferred", decision.reason);
          return;
        }
        if (decision.action === "complete") {
          if (run.goalCondition) {
            await setRun(runId, "deferred", "Configured goal condition is not satisfied");
            return;
          }
          const report = await writeReport(run.goal, state);
          await setRun(runId, "completed", null, report);
          return { report };
        }
        if (decision.action === "request_help") {
          await setRun(runId, "escalated", "Help requests are added in lesson 6");
          return;
        }
        await executeAction(environmentId, runId, `${runId}:${cycle}:${decision.action}`, decision.action);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await setRun(runId, "escalated", "Decision limit reached");
    });
  },
);

import "dotenv/config";
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { ACTIONS, type ActionName } from "../shared/types";
import type { AgentState } from "./agent-data";

const decisionSchema = z.object({
  action: z.enum(ACTIONS),
  reason: z.string(),
  detail: z.string(),
});

export type Decision = { action: ActionName; reason: string; detail: string };

function model() {
  const id = process.env.OPENAI_MODEL;
  if (!process.env.OPENAI_API_KEY || !id) {
    throw new Error("Set OPENAI_API_KEY and OPENAI_MODEL in .env before starting an agent run");
  }
  return openai(id);
}

function scriptedDecision(state: AgentState): Decision {
  const used = (action: ActionName) => state.actions.some((item) => item.name === action);
  if (!used("inspect_logs")) return { action: "inspect_logs", reason: "Check current failure evidence", detail: "" };
  if (!used("inspect_changes")) return { action: "inspect_changes", reason: "Check recent deployment state", detail: "" };
  if (!state.service.upstreamHealthy) return { action: "request_help", reason: "The upstream dependency is unavailable", detail: "Can someone verify and restore the payment gateway?" };
  if (state.service.release === "v2-bad") return { action: "rollback_release", reason: "The faulty release is active", detail: "" };
  if (state.service.featureEnabled) return { action: "disable_feature", reason: "The enabled feature is associated with errors", detail: "" };
  return { action: "complete", reason: "Service appears recovered", detail: "" };
}

export async function chooseAction(goal: string, state: AgentState): Promise<Decision> {
  if (process.env.AGENT_DEMO_MODE === "1") return scriptedDecision(state);

  const result = await generateText({
    model: model(),
    output: Output.object({ schema: decisionSchema }),
    system: `You are a background incident agent for a simulated checkout service.
Choose exactly one action. The harness validates it and controls execution.
Available actions: inspect_logs, inspect_changes, disable_feature, rollback_release, request_help, complete.
Inspect evidence before changing the service. A rollback always requires human approval.
Use request_help when an external dependency cannot be fixed by your local tools.
Use complete only when there is fresh sustained recovery evidence.
Keep reason to one short sentence. Put a question to the operator in detail for request_help; otherwise detail may be empty.`,
    prompt: `Goal: ${goal}\n\nCurrent observed state:\n${JSON.stringify(state, null, 2)}`,
  });
  return result.output;
}

export async function writeReport(goal: string, state: AgentState): Promise<string> {
  if (process.env.AGENT_DEMO_MODE === "1") {
    return `Goal: ${goal}\nOutcome: Checkout recovered to ${state.service.errorRate}% errors.\nActions: ${state.actions.map((item) => item.name.replaceAll("_", " ")).reverse().join(", ")}.\nVerified with three fresh healthy observations.`;
  }
  const result = await generateText({
    model: model(),
    system: "Write a brief factual incident report. Include evidence, actions, recovery verification, and any unresolved risk. Do not invent facts.",
    prompt: `Goal: ${goal}\n\nFinal state and history:\n${JSON.stringify(state, null, 2)}`,
  });
  return result.text;
}

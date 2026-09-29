import express from "express";
import { ZodError, z } from "zod";
import { ACTIONS } from "../shared/types";
import { applyAction, consumeFailureInjection, dashboard, emitServiceEvent, ensureEnvironment, setAgentGoal, setFailureInjection, setWorldState, snapshot } from "./lab-data";
import { cancelRun, decideProposal, getRun } from "./agent-data";
import { activityForRun } from "./agent-log";

const app = express();
app.use(express.json({ limit: "1mb" }));
const id = z.string().uuid();
const object = z.record(z.string(), z.unknown());

app.get("/api/health", (_request, response) => response.json({ ok: true, process: "simulator" }));
app.get("/api/dashboard", async (_request, response) => response.json(await dashboard()));
app.get("/api/state", async (request, response) => response.json(await snapshot(id.parse(request.query.environmentId))));

app.post("/api/state", async (request, response) => {
  const input = z.object({ environmentId: id, state: object }).parse(request.body);
  response.json(await setWorldState(input.environmentId, input.state));
});

app.post("/api/goal", async (request, response) => {
  const input = z.object({
    environmentId: id,
    goal: z.string().trim().min(12).max(1000),
    goalCondition: z.object({ path: z.string().regex(/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)*$/), equals: z.union([z.string(), z.number(), z.boolean()]) }).nullable(),
  }).parse(request.body);
  response.json(await setAgentGoal(input.environmentId, input.goal, input.goalCondition));
});

app.post("/api/events/emit", async (request, response) => {
  const input = z.object({ environmentId: id, type: z.string().trim().min(1).max(80), data: object }).parse(request.body);
  response.json(await emitServiceEvent(input.environmentId, input.type, input.data));
});

app.post("/api/simulator/fault", async (request, response) => {
  const input = z.object({ environmentId: id, enabled: z.boolean() }).parse(request.body);
  await setFailureInjection(input.environmentId, input.enabled);
  response.json({ enabled: input.enabled });
});

app.post("/api/ops/action", async (request, response) => {
  const input = z.object({
    environmentId: id,
    actionId: z.string().min(1),
    name: z.enum(ACTIONS),
    input: object.default({}),
  }).parse(request.body);
  const loseAcknowledgement = await consumeFailureInjection(input.environmentId);
  const result = await applyAction(input.environmentId, input.actionId, input.name, input.input);
  if (loseAcknowledgement) {
    response.status(503).json({ error: "Simulated lost acknowledgement after action committed" });
    return;
  }
  response.json(result);
});

app.post("/api/runs/cancel", async (request, response) => {
  const input = z.object({ runId: id }).parse(request.body);
  response.json(await cancelRun(input.runId));
});
app.get("/api/runs/:runId", async (request, response) => response.json(await getRun(id.parse(request.params.runId))));
app.get("/api/runs/:runId/activity", async (request, response) => {
  const runId = id.parse(request.params.runId);
  await getRun(runId);
  response.json(await activityForRun(runId));
});

app.post("/api/approvals/decide", async (request, response) => {
  const input = z.object({ approvalId: id, decision: z.enum(["approved", "rejected"]), reason: z.string().max(1000).optional() }).parse(request.body);
  response.json(await decideProposal(input.approvalId, input.decision, input.reason));
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  response.status(500).json({ error: message });
});

await ensureEnvironment();
app.listen(3001, "127.0.0.1", () => console.log("Simulator API http://127.0.0.1:3001"));

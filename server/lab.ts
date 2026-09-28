import express from "express";
import { ZodError, z } from "zod";
import { ACTIONS, EVENT_TYPES, SCENARIOS } from "../shared/types";
import { activeLab, applyAction, configureLab, consumeFailureInjection, dashboard, emitLabEvent, ensureLab, recoverUpstream, resetLab, setFailureInjection, snapshot } from "./lab-data";
import { cancelRun, decideProposal, getRun, startRun } from "./agent-data";

const app = express();
app.use(express.json());

let generator: ReturnType<typeof setInterval> | null = null;
let generating = false;

async function syncGenerator() {
  if (generator) clearInterval(generator);
  generator = null;
  const lab = await activeLab();
  if (!lab?.running) return;

  generator = setInterval(async () => {
    if (generating) return;
    generating = true;
    try {
      const current = await activeLab();
      if (current?.id === lab.id && current.running) await emitLabEvent(lab.id);
    } catch (error) {
      console.error("Event generator failed", error);
    } finally {
      generating = false;
    }
  }, 1000 / lab.rate);
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, process: "lab" });
});

app.get("/api/dashboard", async (request, response) => {
  const labId = typeof request.query.labId === "string" ? request.query.labId : undefined;
  response.json(await dashboard(labId));
});

app.get("/api/service", async (request, response) => {
  const labId = z.string().uuid().parse(request.query.labId);
  const state = await snapshot(labId);
  response.json({
    id: state.id,
    featureEnabled: state.featureEnabled,
    release: state.release,
    upstreamHealthy: state.upstreamHealthy,
    healthy: state.healthy,
    errorRate: state.errorRate,
    lastObservationAt: state.lastObservationAt,
  });
});

app.post("/api/lab/reset", async (request, response) => {
  const input = z.object({ scenario: z.enum(SCENARIOS), seed: z.number().int().min(0).max(100000).default(1) }).parse(request.body);
  const lab = await resetLab(input.scenario, input.seed);
  await syncGenerator();
  response.json({ lab: await snapshot(lab.id) });
});

app.post("/api/lab/config", async (request, response) => {
  const input = z.object({
    labId: z.string().uuid(),
    rate: z.number().int().min(1).max(5).optional(),
    eventTypes: z.array(z.enum(EVENT_TYPES)).min(1).optional(),
    running: z.boolean().optional(),
  }).parse(request.body);
  const current = await activeLab();
  if (current?.id !== input.labId) throw new Error("Only the active lab can be configured");
  await configureLab(input.labId, input);
  await syncGenerator();
  response.json({ lab: await snapshot(input.labId) });
});

app.post("/api/lab/emit", async (request, response) => {
  const input = z.object({ labId: z.string().uuid(), type: z.enum(EVENT_TYPES).optional(), count: z.number().int().min(1).max(20).default(1) }).parse(request.body);
  const current = await activeLab();
  if (current?.id !== input.labId) throw new Error("Only the active lab can emit events");
  const emitted = [];
  for (let index = 0; index < input.count; index++) {
    emitted.push(await emitLabEvent(input.labId, input.type));
  }
  response.json({ emitted });
});

app.post("/api/lab/recover", async (request, response) => {
  const { labId } = z.object({ labId: z.string().uuid() }).parse(request.body);
  const current = await activeLab();
  if (current?.id !== labId) throw new Error("Only the active lab can recover");
  response.json(await recoverUpstream(labId));
});

app.post("/api/lab/fault", async (request, response) => {
  const input = z.object({ labId: z.string().uuid(), enabled: z.boolean() }).parse(request.body);
  await setFailureInjection(input.labId, input.enabled);
  response.json({ enabled: input.enabled });
});

app.post("/api/ops/action", async (request, response) => {
  const input = z.object({
    labId: z.string().uuid(),
    actionId: z.string().min(1),
    name: z.enum(ACTIONS),
    input: z.record(z.string(), z.unknown()).default({}),
  }).parse(request.body);
  const loseAcknowledgement = await consumeFailureInjection(input.labId);
  const result = await applyAction(input.labId, input.actionId, input.name, input.input);
  if (loseAcknowledgement) {
    response.status(503).json({ error: "Simulated lost acknowledgement after action committed" });
    return;
  }
  response.json(result);
});

app.post("/api/runs/start", async (request, response) => {
  const input = z.object({ labId: z.string().uuid(), goal: z.string().trim().min(12).max(1000) }).parse(request.body);
  response.json(await startRun(input.labId, input.goal));
});

app.post("/api/runs/cancel", async (request, response) => {
  const input = z.object({ runId: z.string().uuid() }).parse(request.body);
  response.json(await cancelRun(input.runId));
});

app.get("/api/runs/:runId", async (request, response) => {
  response.json(await getRun(z.string().uuid().parse(request.params.runId)));
});

app.post("/api/approvals/decide", async (request, response) => {
  const input = z.object({ approvalId: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reason: z.string().max(1000).optional() }).parse(request.body);
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

await ensureLab();
await syncGenerator();
app.listen(3001, "127.0.0.1", () => console.log("Incident lab http://127.0.0.1:3001"));

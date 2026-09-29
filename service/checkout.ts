import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";

type Fault = "none" | "feature" | "release" | "dependency";
type ServiceState = {
  service: "checkout";
  health: { status: "healthy" | "degraded"; errorRate: number };
  release: string;
  featureEnabled: boolean;
  upstreamHealthy: boolean;
};

function flag(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}

const fault = z.enum(["none", "feature", "release", "dependency"]).parse(flag("fault", "none")) as Fault;
const alertCount = z.coerce.number().int().min(0).max(100).parse(flag("alerts", fault === "none" ? "0" : "1"));
const intervalMs = z.coerce.number().int().min(100).max(60_000).parse(flag("interval-ms", "3000"));
const recoverAfterMs = z.coerce.number().int().min(0).parse(flag("recover-after-ms", fault === "dependency" ? "30000" : "0"));
let loseNextActionResponse = process.argv.includes("--lose-next-action-response");

const instanceId = randomUUID();
let activeFault = fault;
let version = 1;
let state: ServiceState = {
  service: "checkout",
  health: { status: fault === "none" ? "healthy" : "degraded", errorRate: fault === "none" ? 1 : 42 },
  release: fault === "release" ? "v2-bad" : "v1-stable",
  featureEnabled: fault === "feature",
  upstreamHealthy: fault !== "dependency",
};

const logs: Array<{ at: string; level: string; message: string }> = [];
const changes: Array<{ at: string; message: string }> = [];
const outcomes = new Map<string, { fingerprint: string; result: Record<string, unknown> }>();
const pendingEvents = new Map<string, { id: string; serviceId: string; instanceId: string; type: string; data: Record<string, unknown> }>();
let delivering = false;

const faultLog: Record<Fault, string> = {
  none: "Checkout is operating normally",
  feature: "Checkout express feature raised an error during payment confirmation",
  release: "Checkout v2 request failures began after deployment",
  dependency: "Payment gateway requests are timing out",
};

function recordLog(level: string, message: string) { logs.push({ at: new Date().toISOString(), level, message }); }
function recordChange(message: string) { changes.push({ at: new Date().toISOString(), message }); }

async function deliverEvents() {
  if (delivering) return;
  delivering = true;
  try {
    for (const event of pendingEvents.values()) {
      try {
        const response = await fetch("http://127.0.0.1:3001/api/service/events", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event),
        });
        if (response.ok) pendingEvents.delete(event.id);
        else console.warn(`Event ${event.id} delivery returned ${response.status}; retrying`);
      } catch { /* The operator API may not be up yet. Keep the same event ID for retry. */ }
    }
  } finally {
    delivering = false;
  }
}

function emit(type: string, data: Record<string, unknown>) {
  const event = { id: randomUUID(), serviceId: "checkout", instanceId, type, data };
  pendingEvents.set(event.id, event);
  void deliverEvents();
}

function recover(reason: string) {
  if (activeFault === "none") return;
  activeFault = "none";
  state = { ...state, health: { status: "healthy", errorRate: 1 } };
  version++;
  recordLog("info", `Checkout recovered after ${reason}`);
  emit("health.recovered", { summary: `Checkout recovered after ${reason}`, version });
}

recordLog(fault === "none" ? "info" : "error", faultLog[fault]);
if (fault === "release") recordChange("Deployed checkout v2-bad");
if (fault === "feature") recordChange("Enabled checkout express feature");

const app = express();
app.use(express.json());
app.get("/health", (_request, response) => response.json({ ok: true, instanceId, fault, pendingEvents: pendingEvents.size }));
app.get("/state", (_request, response) => response.json({ instanceId, version, state }));
app.get("/logs", (_request, response) => response.json({ logs: logs.slice(-20) }));
app.get("/changes", (_request, response) => response.json({ changes: changes.slice(-20) }));

app.post("/operations", (request, response) => {
  const input = z.object({
    actionId: z.string().min(1),
    name: z.enum(["inspect_logs", "inspect_changes", "disable_feature", "rollback_release"]),
    expectedVersion: z.number().int().optional(),
  }).parse(request.body);
  const fingerprint = JSON.stringify({ name: input.name, expectedVersion: input.expectedVersion });
  const prior = outcomes.get(input.actionId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) return response.status(409).json({ error: "Action ID reused with different arguments" });
    return response.json(prior.result);
  }
  if ((input.name === "disable_feature" || input.name === "rollback_release") && input.expectedVersion !== version) {
    return response.json({ stale: true, currentVersion: version });
  }

  let result: Record<string, unknown>;
  switch (input.name) {
    case "inspect_logs": result = { logs: logs.slice(-12) }; break;
    case "inspect_changes": result = { changes: changes.slice(-12) }; break;
    case "disable_feature": {
      state = { ...state, featureEnabled: false };
      recordChange("Disabled checkout express feature");
      if (activeFault === "feature") recover("feature disablement");
      else version++;
      result = { featureEnabled: false, version };
      break;
    }
    case "rollback_release": {
      state = { ...state, release: "v1-stable" };
      recordChange("Rolled checkout back to v1-stable");
      if (activeFault === "release") recover("release rollback");
      else version++;
      result = { release: state.release, version };
      break;
    }
  }
  outcomes.set(input.actionId, { fingerprint, result });
  if (loseNextActionResponse && (input.name === "disable_feature" || input.name === "rollback_release")) {
    loseNextActionResponse = false;
    return response.status(503).json({ error: "Simulated acknowledgement lost after the operation committed" });
  }
  return response.json(result);
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
});

app.listen(3004, "127.0.0.1", () => {
  console.log(`Checkout service http://127.0.0.1:3004 | instance ${instanceId} | fault ${fault} | alerts ${alertCount}`);
  setInterval(() => void deliverEvents(), 1000);
  emit("service.started", { summary: "Checkout service instance started", version });
  if (fault !== "none") {
    for (let index = 0; index < alertCount; index++) {
      setTimeout(() => {
        if (activeFault !== "none") emit("health.alert", { summary: faultLog[fault], errorRate: state.health.errorRate, alertNumber: index + 1 });
      }, 1000 + index * intervalMs);
    }
  }
  if (fault === "dependency" && recoverAfterMs > 0) {
    setTimeout(() => {
      state = { ...state, upstreamHealthy: true };
      recover("upstream dependency recovery");
    }, recoverAfterMs);
  }
});

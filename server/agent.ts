import express from "express";
import { serve } from "inngest/express";
import { incidentAgent } from "./agent-workflow";
import { inngest } from "./inngest";

const app = express();
// Inngest replays prior step results to this local endpoint; long simulator runs exceed Express's 100 KB default.
app.use(express.json({ limit: "10mb" }));
app.get("/api/health", (_request, response) => response.json({ ok: true, process: "agent" }));
app.use("/api/inngest", serve({ client: inngest, functions: [incidentAgent] }));

app.listen(3002, "127.0.0.1", () => console.log("Agent endpoint http://127.0.0.1:3002/api/inngest"));

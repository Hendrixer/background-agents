# Build AI Agents that Never Sleep

A one-day, hands-on Node.js workshop. Students build the agent and harness while a supplied incident lab simulates a service, emits events, and displays run history.

## What runs locally

| Process | Address | Job |
| --- | --- | --- |
| Incident lab API | http://127.0.0.1:3001 | Service state, event simulator, operations, approvals |
| Agent endpoint | http://127.0.0.1:3002/api/inngest | Inngest function code |
| Incident dashboard | http://127.0.0.1:5173 | Operator controls and run timeline |
| Inngest Dev Server | http://127.0.0.1:8288 | Durable execution and step traces |
| Lesson notes | http://127.0.0.1:5174 | Markdown site, started separately |

PostgreSQL stores the lab's authoritative state and run history. Inngest stores workflow checkpoints. Keep the Inngest Dev Server running while restarting the agent process for the durability demonstration.

## Prerequisites

- Node.js LTS, npm, Git, and local PostgreSQL.
- A working OpenAI API key and a model available to your account.

## Setup

```bash
npm install
createdb background_agents
```

If the database already exists, skip `createdb`. Add these values to `.env`; keep any Inngest keys already present:

```dotenv
DATABASE_URL=postgres://localhost:5432/background_agents
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-available-model
```

The local Inngest Dev Server does not require a cloud account. Existing `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` values can remain in `.env`. The `dev` scripts set `INNGEST_DEV=1` explicitly.

Apply the schema and seed the first incident:

```bash
npm run db:push
npm run db:seed
npm run dev
```

Open the dashboard and wait for the agent endpoint to appear in the Inngest Dev Server. In another terminal, run `npm run docs` for the notes site.

For a durability demo, run `npm run dev:lab`, `npm run dev:web`, `npm run dev:inngest`, and `npm run dev:agent` in separate terminals. Restart only `dev:agent` while a run is waiting for approval.

## Incident lab

Choose a scenario and reset it. Pick event types and a rate, then start the event stream or emit events manually. Feature rollout is fixed by disabling the bad feature. Faulty release requires a human-approved rollback. Upstream outage requires help and an external recovery signal from the simulator.

Stop events to test waiting; this does not cancel the agent. Cancel the run separately. Reset creates a new scenario instance while prior run history remains in PostgreSQL.

The simulator is intentionally small. It has one active incident at a time and bounded event rates so each state transition is easy to inspect during a live lesson.

## Lesson branches

Each lesson branch contains the previous lesson's solution and the current lesson's notes. The `complete` branch contains the final app and all notes. If you fall behind, finish your current work or save it before switching branches.

| Lesson | Start branch | Solution branch |
| --- | --- | --- |
| 1 | `lesson-1` | `lesson-2` |
| 2 | `lesson-2` | `lesson-3` |
| 3 | `lesson-3` | `lesson-4` |
| 4 | `lesson-4` | `lesson-5` |
| 5 | `lesson-5` | `lesson-6` |
| 6 | `lesson-6` | `complete` |

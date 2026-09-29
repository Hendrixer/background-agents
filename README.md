# Build AI Agents that Never Sleep

A one-day Node.js workshop on event-triggered background agents. Students build the harness. The supplied checkout simulator provides an editable world state, emits events, implements demo tools, and displays an operator inbox and run history.

## The boundary

```text
Simulator: save state ──> PostgreSQL
Simulator: publish service event ──> Inngest
Agent event handler: record event + create run ──> read latest state
Agent run: decide ──> policy ──> tool or human pause
Human reply ──> resumes that same run
Later service event ──> starts another run
```

The event payload is a signal, not the state the agent trusts. Saving state alone starts no run. The agent handler creates a separate run for every emitted event and copies the standing goal and optional completion condition at that point. The harness has no knowledge of simulator presets or event source. Presets only fill the admin form. A real producer can publish the same event shape.

The optional completion condition is a field path and expected value, such as `health.status = healthy`. The harness evaluates it against the latest saved state. Without one, the model may propose the terminal `complete` action. The `defer` action ends a run when no further local action is justified; a future event starts a new run. Human approval and help responses use a durable Inngest wait and resume the existing run.

## What runs

| Process | Address | Job |
| --- | --- | --- |
| Simulator API | http://127.0.0.1:3001 | Editable state, event emission, demo operations, approvals |
| Agent endpoint | http://127.0.0.1:3002/api/inngest | Inngest function code |
| Dashboard | http://127.0.0.1:5173 | Inbox, activity, events, and simulator |
| Inngest Dev Server | http://127.0.0.1:8288 | Durable checkpoints and traces |
| Lesson notes | http://127.0.0.1:5174 | Markdown site, started separately |

Neon PostgreSQL stores state, events, runs, tool effects, approvals, and the per-run activity log. Inngest stores workflow execution history. Keep the Inngest Dev Server running while restarting the agent endpoint during durability exercises.

## Setup

You need Node.js LTS, npm, Git, an internet connection, and a working OpenAI API key and model. No local PostgreSQL installation, Neon account, or Inngest Cloud account is required.

```bash
npm install
cp .env.example .env
```

Open [neon.new](https://neon.new/) and copy its **PostgreSQL connection string**, including SSL parameters, into `.env`. The claim URL is different from the connection string.

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-available-model
```

Use the actual URL Neon gives you, and keep `.env` out of Git. An unclaimed database expires after 72 hours. For VOD practice after that window, create a new one or claim the database before expiry. Neon says neon.new is being sunset in favor of [Claimable Neon](https://neon.com/claimable-neon); use its current no-account flow if the old URL has moved.

```bash
npm run db:push
npm run preflight
npm run db:seed
npm run dev
```

In another terminal, `npm run docs` starts the notes. For restart exercises, run `dev:lab`, `dev:web`, `dev:inngest`, and `dev:agent` in separate terminals and restart only the agent process. An instructor can use `AGENT_DEMO_MODE=1 npm run dev:agent` for deterministic choices without an LLM call.

## Use the simulator

On `/admin`, save the standing goal, edit and save the state JSON, then send one event with a type and payload. These are separate actions so you can verify that state changes do not summon an agent by themselves. The shortcut buttons only populate the form; inspect their JSON before saving. To simulate recovery, save a recovered state and emit another event. The new event starts a new run; it does not resume the earlier deferred run. An interval-based producer would be another source of these events, but the state editor is what lets us test observation and stale-action behavior.

The dashboard has four routes:

| Route | Purpose |
| --- | --- |
| `/` | Inbox for approvals and help requests |
| `/activity` | Runs, saved decision/activity feed, and reports |
| `/events` | Events emitted by the simulator |
| `/admin` | State editor, event emitter, goal configuration, and failure drill |

Demo operations can inspect recent events and state, disable the feature flag, or roll back the release. An operation changes only the fields it owns; it does **not** declare the service healthy. Recovery must be represented in the observed state and announced with another event. The failure drill loses one tool acknowledgement after the effect commits, so the same action ID must return the saved result on retry.

The current schema keeps a few unused columns from earlier workshop prototypes so existing Neon rehearsal databases can be used without a destructive migration. No scenario rule reads those columns.

## Lesson branches

Each lesson starts on a branch containing the previous lesson's solution. The next branch is that lesson's finished code.

| Lesson | Start | Solution |
| --- | --- | --- |
| 1 · Goal and loop | `lesson-1` | `lesson-2` |
| 2 · Durable steps | `lesson-2` | `lesson-3` |
| 3 · Fresh state and event boundaries | `lesson-3` | `lesson-4` |
| 4 · Human approval | `lesson-4` | `lesson-5` |
| 5 · Safe retries | `lesson-5` | `lesson-6` |
| 6 · Help and handoff | `lesson-6` | `complete` |

Read [lesson 00](lessons/index.md) first. The notes are both student material and the instructor's live-coding guide. `npm run notes:check` verifies code blocks against adjacent branch diffs. A branch switch changes code, not Neon or Inngest history; use a fresh state edit and event for each demonstration.

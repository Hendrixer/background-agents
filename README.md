# Build AI Agents that Never Sleep

A one-day, hands-on Node.js workshop. Students build the agent and harness while a supplied incident lab simulates a service, emits events, and displays run history.

## What runs locally

| Process | Address | Job |
| --- | --- | --- |
| Incident lab API | http://127.0.0.1:3001 | Service state, event simulator, operations, approvals |
| Agent endpoint | http://127.0.0.1:3002/api/inngest | Inngest function code |
| Operations dashboard | http://127.0.0.1:5173 | Inbox, run activity, service events, and simulator |
| Inngest Dev Server | http://127.0.0.1:8288 | Durable execution and step traces |
| Lesson notes | http://127.0.0.1:5174 | Markdown site, started separately |

Neon-hosted PostgreSQL stores the lab's authoritative state and a per-run agent activity log. Inngest stores workflow checkpoints and execution traces. Keep the Inngest Dev Server running while restarting the agent process for the durability demonstration.

## Prerequisites

- Node.js LTS, npm, Git, and an internet connection. No local PostgreSQL installation or Neon account is required for the workshop.
- A working OpenAI API key and a model available to your account.

## Setup

```bash
npm install
cp .env.example .env
```

Open [neon.new](https://neon.new/), create a free temporary Postgres database in the browser, and copy its **PostgreSQL connection string**. Paste the entire string, including its SSL parameters, into `DATABASE_URL` in `.env`. The claim URL is for keeping the database later; it is not the connection string. Add your model credentials and keep any Inngest keys already present:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-available-model
```

The URL above is a shape example; use the actual one Neon gives you. Keep `.env` private and out of Git. An unclaimed neon.new database expires after **72 hours**. That covers the one-day workshop; for later practice, create a new database and rerun `npm run db:push` and `npm run db:seed`, or claim the existing one before it expires. Neon says neon.new is being sunset in favor of [Claimable Neon](https://neon.com/claimable-neon), so VOD students should use Neon's current no-account flow if the old page has moved.

The local Inngest Dev Server does not require a cloud account. Existing `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` values can remain in `.env`. The `dev` scripts set `INNGEST_DEV=1` explicitly.

For an instructor rehearsal with repeatable model choices, run only the agent process with `AGENT_DEMO_MODE=1 npm run dev:agent`. Students use their own API key for the normal model path.

Apply the schema to Neon and seed the first incident:

```bash
npm run db:push
npm run preflight
npm run db:seed
npm run dev
```

Open the dashboard and wait for the agent endpoint to appear in the Inngest Dev Server. Run only one copy of each local process so the lab and agent use the same Neon database and ports. In another terminal, run `npm run docs` for the notes site.

For a durability demo, run `npm run dev:lab`, `npm run dev:web`, `npm run dev:inngest`, and `npm run dev:agent` in separate terminals. Restart only `dev:agent` while a run is waiting for approval.

## Incident lab

The dashboard separates operator work from workshop controls:

| Route | Purpose |
| --- | --- |
| `/` or `/inbox` | Agent inbox with requests, decisions, and replies |
| `/activity` | Scrollable run list, saved activity feed, and reports |
| `/events` | Service events recorded by the lab and sent toward Inngest |
| `/admin` | Create a scenario, start one run, and send a finite event batch |

On `/admin`, create a scenario, start one agent run with a goal, then compose a finite event batch. Set the number of events, interval, and either one event type or a weighted mix of types. The lab server sends the batch even if the browser closes. Service events are saved and sent toward Inngest as wakeup hints; they do not create a new run for every event. The agent reads current state after it wakes. A one-event batch tests a wakeup; several spaced health events verify sustained recovery.

Feature rollout is fixed by disabling the bad feature. Faulty release requires a human-approved rollback. Upstream outage requires help and an external recovery signal from the simulator. Compare each run's activity on `/activity` with the service event log on `/events` and the execution trace in Inngest.

Use Feature rollout for lessons 1–3 and 5, Faulty release for lesson 4, and Upstream outage for lesson 6. Earlier checkpoints intentionally leave some safety rules unfinished so you can see the behavior those lessons will change.

Let a batch finish or stop it to test waiting; this does not cancel the agent. Cancel the run separately on `/activity`. Reset creates a new scenario instance while prior run history remains in PostgreSQL; the dashboard lists runs for the current scenario.

The simulator is intentionally small. It has one active incident at a time and bounded batch sizes and intervals so each state transition is easy to inspect during a live lesson.
The local agent endpoint accepts larger Inngest replay requests than Express's default 100 KB body limit. Each wakeup still adds to a run's step history, so reset between drills; a production agent that waits indefinitely should compact or roll over its work rather than accumulate an unbounded single run.

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

Start at `lesson-1`. On a lesson branch, the app contains the prior lesson's solution and the notes show the code to add. When you finish lesson 1, your files should match `lesson-2`; lesson 2 starts there. The notes site is available on every branch.

Read [the course introduction](lessons/index.md) first. It explains the architecture, prerequisites, local setup, and branch handoff. This is lesson 00 and has no code edit.

For instructors, `npm run notes:check` verifies that all displayed diff blocks match the neighboring branches. Run `npm run notes:generate` after changing a teaching checkpoint, then rebuild the notes site. A code checkout does not change PostgreSQL data or Inngest history, so reset the simulator between branch demos.

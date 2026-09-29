# Build AI Agents that Never Sleep

A one-day TypeScript workshop about agents that keep working after the prompt ends. Students build the harness. A supplied, separate checkout service provides a changing world to observe and a small operations API to act on. An operator app shows the inbox, incidents, and event history.

## System boundary

```text
checkout process (port 3004) ── alert ──> operator API (port 3001)
checkout process <── fresh HTTP observation / operation ── incident agent (port 3002)
operator inbox ── human decision ──> paused Inngest run
```

The checkout process owns its state in memory. Each start creates a new service instance with a fresh state. It sends a stable event ID until the operator API acknowledges it. The operator API persists events in Neon and opens **one run for an active incident**. Later alerts for that service instance join and wake the run. An event is a notification; the agent reads current checkout state over HTTP before deciding. A human decision also resumes the same run. An action changes checkout state, which the next observation must verify. On a service restart, an unfinished run is superseded because its old observations and approvals belong to a different instance.

The default goal and `health.status = healthy` completion condition are set in `server/environment.ts`. Set `AGENT_GOAL` on the operator process to override the goal before a new incident opens. The model chooses an action from a narrow catalog. The harness owns approval, version preconditions, retries, waits, decision limits, and terminal status. The checkout service owns the effects and remembers action IDs so a retry does not repeat a committed effect.

## Setup

Bring Node.js LTS, npm, Git, an editor, an internet connection, and an LLM API key with usage. You do not need local PostgreSQL, deployment, or an Inngest Cloud account.

```bash
npm install
cp .env.example .env
```

Get a temporary PostgreSQL connection string from [neon.new](https://neon.new/) and put the **connection string**, including SSL options, in `.env`, with your model credentials:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-available-model
```

Do not commit `.env`. An unclaimed Neon database is temporary; claim it or make a new one for later practice.

```bash
npm run db:push
npm run preflight
npm run db:seed
npm run dev
```

In another terminal, `npm run docs` serves the lesson notes at http://127.0.0.1:5174. The operator app is at http://127.0.0.1:5173, and Inngest traces are at http://127.0.0.1:8288. `AGENT_DEMO_MODE=1 npm run dev:agent` gives instructors deterministic choices for rehearsal.

| Process | Command | Address |
| --- | --- | --- |
| Checkout service | `npm run dev:checkout -- --fault feature` | 127.0.0.1:3004 |
| Operator API | `npm run dev:operator` | 127.0.0.1:3001 |
| Agent endpoint | `npm run dev:agent` | 127.0.0.1:3002 |
| Operator UI | `npm run dev:web` | 127.0.0.1:5173 |
| Inngest Dev Server | `npm run dev:inngest` | 127.0.0.1:8288 |

`npm run dev` starts all five, with a healthy checkout by default. For a fault drill, stop the checkout process and start it with flags while keeping the other four processes alive:

```bash
npm run dev:checkout -- --fault feature --alerts 3 --interval-ms 1000
npm run dev:checkout -- --fault release
npm run dev:checkout -- --fault dependency --recover-after-ms 30000
npm run dev:checkout -- --fault feature --lose-next-action-response
npm run dev:checkout -- --fault none
```

Run **one checkout process at a time**. `--fault` accepts `none`, `feature`, `release`, or `dependency`; each start resets state and creates a new instance. `--alerts` sets how many alert events to emit, and `--interval-ms` sets their spacing. `--recover-after-ms 0` leaves a dependency degraded until restart. The lost-response flag commits the first mutating operation and replies 503 once, exposing the side-effect/acknowledgement gap. For the agent restart exercise, restart only `dev:agent`; keep Inngest and checkout running.

The UI has three routes: `/` for human requests, `/activity` for incident runs and their saved activity, and `/events` for service events and current checkout state. There is no simulator admin page. The checkout process is a small, inspectable synthetic service; the agent and operator API do not know which startup fault flag created its state.

The workshop uses one checkout service, so at most one active incident is associated with its current instance. New events are attached by service identity and current active run, not by an LLM classifier. A production system would need incident correlation across multiple services and time windows, an event outbox durable across producer restarts, authentication, and a more rigorous recovery predicate. The historical database schema still maps unused prototype columns to avoid a destructive migration of existing Neon rehearsal data.

## Lesson branches

Each lesson starts with the prior lesson's solution. The next branch has the completed code. Read [lesson 00](lessons/index.md) first; the notes include the engineering discussion and exact edits for live coding. Branch switches change source code, not Neon or Inngest history.

| Lesson | Start | Solution |
| --- | --- | --- |
| 1 · Goal and loop | `lesson-1` | `lesson-2` |
| 2 · Durable steps | `lesson-2` | `lesson-3` |
| 3 · Wait for events | `lesson-3` | `lesson-4` |
| 4 · Human approval | `lesson-4` | `lesson-5` |
| 5 · Safe retries | `lesson-5` | `lesson-6` |
| 6 · Help and handoff | `lesson-6` | `complete` |

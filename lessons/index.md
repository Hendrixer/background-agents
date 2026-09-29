# 00 · Welcome to background agents

I think background agents are the real productivity unlock in AI. A chat agent helps while you are present to ask and answer. A background agent has a standing goal and can respond when the world changes, do work without an open tab, and bring a person back into the loop only when that person has a meaningful decision to make. That is a much more powerful product shape, and it raises the bar for engineering.

Our example is a checkout operations agent. We will configure its goal ahead of time. A simulated service will hold a JSON state object and emit events. **Each emitted event starts a new run.** The agent treats the event as a trigger, calls an observation function to read the latest state, chooses an action, and uses tools. If a risky action needs approval or the agent needs information, that run pauses and resumes after an inbox response. If no safe local action remains, the run ends as deferred. A later external event starts a *different* run. This distinction between resuming one run and starting another is central to the course.

The simulator knows nothing about the agent's strategy. Its shortcut buttons merely fill the state and event editors. The harness knows nothing about a “feature rollout scenario” or an “upstream outage scenario.” It enforces generic rules: allowed actions, approval policy, bounded decisions, idempotent effects, state freshness, and optional deterministic completion. The checkout tool implementation is a supplied adapter, not a hidden rule inside the harness.

The question I want us to ask throughout the day is **who has authority over each decision?** The model proposes. The harness permits or rejects. The observed world provides evidence. A human authorizes risky actions and supplies facts the agent cannot infer. Inngest preserves progress and waits across process restarts. A trace explains what happened; it does not make an unsafe action safe.

## What we will build

We begin with a small observe–decide–act loop and make its operations durable. Then we handle the race between an event and the latest world state, add state-version preconditions to actions, pause for a human approval, make retries idempotent, and practice a help request that ends in a handoff. We will compare **outcome** and **trajectory**: a healthy service after an unauthorized rollback is not a success, while a safe escalation may be the right result even if the service is still down.

The supplied operator app has four places:

| Page | What it shows |
| --- | --- |
| [Inbox](http://127.0.0.1:5173/) | Approval requests and questions, with controls to answer or deny |
| [Activity](http://127.0.0.1:5173/activity) | A list of runs and each run's saved observe/decide/act/pause history |
| [Events](http://127.0.0.1:5173/events) | Events emitted by the simulated service |
| [Simulator](http://127.0.0.1:5173/admin) | Standing goal, editable state JSON, event payload, and demo shortcuts |

In the simulator, save the goal, set and save the state, then send an event. Watch the new run appear in Activity. A state edit by itself creates no run. After the agent changes a feature flag or release, the simulator does not magically claim recovery. Set the observed health to healthy and emit another event to test whether a *new* run verifies the goal. Try two events quickly and ask what can overlap.

## What you need

You should be comfortable with JavaScript or TypeScript, `async`/`await`, npm, Git, and a basic Node.js server. Prior agent experience is useful but not required. Bring Node.js LTS, npm, Git, an editor, an internet connection, and an LLM API key with available usage. The app and Inngest Dev Server run locally; PostgreSQL lives on Neon. You do not need a local PostgreSQL installation, deployment, or Inngest Cloud account.

From the `background-agents` directory:

```bash
git switch lesson-1
npm install
cp .env.example .env
```

Open [neon.new](https://neon.new/) and copy its **PostgreSQL connection string** into `.env`, along with your model key and model. Copy the database URL, not the claim URL:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-available-model
```

Use your own URL and never commit `.env`. An unclaimed database expires after 72 hours. For later VOD practice, create a new one or claim it before expiry. Neon says neon.new is being sunset in favor of [Claimable Neon](https://neon.com/claimable-neon); use its current no-account flow if the old link has moved.

```bash
npm run db:push
npm run preflight
npm run db:seed
npm run dev
```

The dashboard is at [localhost:5173](http://127.0.0.1:5173), Inngest at [localhost:8288](http://127.0.0.1:8288), and these notes run in another terminal with `npm run docs` at [localhost:5174](http://127.0.0.1:5174). Keep Inngest running for restart exercises. The repository README has process details.

## How the branches work

Each lesson starts on a branch with the prior lesson's finished code. The next branch is its solution. Lesson 00 is this introduction and has no code edit.

| Live lesson | Start | Finished solution |
| --- | --- | --- |
| 1 · Goal and loop | `lesson-1` | `lesson-2` |
| 2 · Durable steps | `lesson-2` | `lesson-3` |
| 3 · Fresh state and event boundaries | `lesson-3` | `lesson-4` |
| 4 · Human approval | `lesson-4` | `lesson-5` |
| 5 · Safe retries | `lesson-5` | `lesson-6` |
| 6 · Help and handoff | `lesson-6` | `complete` |

If you fall behind, save your work before switching: `git stash push -u -m "workshop progress"`, then `git switch lesson-3`, for example. A branch switch changes code, not Neon data or Inngest history. Save a fresh state and send a new event for each drill. We will leave at least 15 minutes after each coding lesson for catch-up and questions.

These notes are for you and for me while I live code. Each lesson first develops the engineering idea and tradeoffs, then shows exact code blocks and nearby context for the edit. A diff uses red `-` lines for removals and green `+` lines for additions. Model choices may vary; judge the state, policy, and trace instead of expecting an identical transcript.

Before the first lesson, consider this: if an event is emitted while the agent endpoint is down, what must be persisted, and who owns delivery and retries? What if state changes again before the run reads it? We will return to those questions throughout the day.

[Next: Give the agent a goal →](/01-goal-and-harness/)

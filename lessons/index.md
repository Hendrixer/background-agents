# 00 · Welcome to background agents

I think background agents are the real productivity unlock in AI. A chat agent is most useful while you are there to ask and answer. A background agent can hold a standing goal, notice when the world changes, do work after you close the tab, and reach you through an inbox only when it needs your judgment. That product shape is powerful, but it also makes failures, authority, and recovery part of the agent design.

Our example is a checkout operations agent. A separate local checkout service owns a small state object, develops a fault, and sends alerts. The first alert opens an incident run. Additional alerts join that same active incident; they do not each create another agent. The agent observes the latest state through an API, inspects evidence, and can choose a remediation. A remediation changes the checkout service state. On its next turn the agent must observe again before claiming success. A human approval or help answer resumes the same run. The service can also recover independently, send a recovery event, and wake the waiting run.

The checkout process is supplied code. A startup flag selects the fault, but the agent harness has no branch for “feature scenario” or “dependency scenario.” It sees events, state, and a small set of tool results. We use one checkout service in this workshop, so the active service instance and its open run are enough to correlate alerts. In a real fleet, I would need explicit incident keys or a correlation service; I would not ask the LLM to decide whether two alerts belong together unless deterministic signals had failed.

The question I want us to ask throughout the day is **who has authority over each decision?** The model proposes an action. The harness validates it, gates risky actions, bounds the loop, and decides when a run can finish. The checkout service owns the effect and its current state. A person can authorize an exact risky action or add information. Inngest remembers checkpoints and waits. A trace explains what happened, but the outcome still needs independent verification.

## What we will build

We begin with an observe–decide–act loop, then give its operations durable checkpoints. We make `wait` a real pause until an incident event changes the world. We add human approval, a state-version check, a stable action ID for uncertain retries, and a help request. We will judge both the **outcome** and the **trajectory**: healthy checkout after an unauthorized rollback is not success, while a clear unresolved state may be the right result when our tools cannot fix an upstream dependency.

The supplied operator app has three pages:

| Page | What it shows |
| --- | --- |
| [Inbox](http://127.0.0.1:5173/) | Approval requests and questions, with controls to answer or deny |
| [Activity](http://127.0.0.1:5173/activity) | Incident runs and each run's saved observe, predict, act, pause, and terminal activity |
| [Events](http://127.0.0.1:5173/events) | Alerts from checkout and the service's current state |

There is no simulator admin page. The checkout service is our controllable synthetic environment. Start it in one fault mode, examine the run, then restart it in a different mode. Each restart resets checkout state and creates a new instance ID. It also invalidates unfinished work on the previous instance.

## What you need

You should be comfortable with JavaScript or TypeScript, `async`/`await`, npm, Git, and a basic Node.js server. Prior agent experience is useful but not required. Bring Node.js LTS, npm, Git, an editor, an internet connection, and an LLM API key with usage. The app and Inngest Dev Server run locally; PostgreSQL lives on Neon. You do not need local PostgreSQL, deployment, or an Inngest Cloud account.

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

Use your own URL and never commit `.env`. An unclaimed database is temporary. Claim it or make another for later VOD practice.

```bash
npm run db:push
npm run preflight
npm run db:seed
npm run dev
```

The dashboard is at [localhost:5173](http://127.0.0.1:5173), Inngest at [localhost:8288](http://127.0.0.1:8288), and these notes run in another terminal with `npm run docs` at [localhost:5174](http://127.0.0.1:5174). The default checkout starts healthy. For a drill, keep the other processes running and restart only checkout with a flag:

```bash
npm run dev:checkout -- --fault feature --alerts 3 --interval-ms 1000
npm run dev:checkout -- --fault release
npm run dev:checkout -- --fault dependency --recover-after-ms 30000
npm run dev:checkout -- --fault feature --lose-next-action-response
```

Only one checkout process can use port 3004. For the durability lesson, restart only the agent endpoint and keep the Inngest Dev Server running. The repository README has the full process and flag reference.

## How the branches work

Each lesson starts on a branch with the prior lesson's finished code. The next branch is its solution. Lesson 00 is this introduction and has no code edit.

| Live lesson | Start | Finished solution |
| --- | --- | --- |
| 1 · Goal and loop | `lesson-1` | `lesson-2` |
| 2 · Durable steps | `lesson-2` | `lesson-3` |
| 3 · Wait for events | `lesson-3` | `lesson-4` |
| 4 · Human approval | `lesson-4` | `lesson-5` |
| 5 · Safe retries | `lesson-5` | `lesson-6` |
| 6 · Help and handoff | `lesson-6` | `complete` |

If you fall behind, save your work before switching: `git stash push -u -m "workshop progress"`, then `git switch lesson-3`, for example. A branch switch changes code, not Neon data or Inngest history. Start a fresh checkout instance for each drill. We will leave at least 15 minutes after each coding lesson for catch-up and questions.

These notes are for you and for me while I live code. Each lesson develops the engineering idea and tradeoffs, then shows exact code blocks and nearby context for the edit. A diff uses red `-` lines for removals and green `+` lines for additions. Model choices may vary; judge the state, policy, and trace instead of expecting an identical transcript.

Before the first lesson, consider this: if checkout changes state while the agent is paused, what wakes the run? If an action commits but its HTTP response disappears, who can prove whether retrying is safe? We will return to those questions throughout the day.

[Next: Give the agent a goal →](/01-goal-and-harness/)

# 00 · Welcome to background agents

I think background agents are one of the biggest productivity unlocks in AI. A chat agent helps while you are there to prompt it. A background agent owns a goal after the conversation ends. It can notice a change, do useful work, wait for the world or a person, and come back with a result. That changes the engineering problem. We are responsible for what it does while nobody is watching.

In this workshop, we will build an incident-response agent for a simulated checkout service. We will give it a goal once. It will observe service state, choose a next action, use tools, and verify whether the service actually recovered. It may pause for new events, ask for approval before a rollback, or ask a human for help when its own tools cannot fix the problem. An inbox is how the agent reaches us; we should not have to keep a chat window open to keep it alive.

The question I want us to ask all day is **who has authority over each decision?** The model can propose an investigation or action. The harness controls the available tools, validates a proposal, records progress, enforces limits, and decides when to wait. The service's current state supplies evidence of recovery. A person authorizes risky actions and supplies information the agent cannot infer. Durable execution makes this arrangement survive process restarts; it does not replace these boundaries.

## What we will build

We start with a small goal-driven loop, then make its work durable with Inngest. We add correlated event waits and a deterministic recovery check, put human approval and help requests into an inbox, make tool retries idempotent, and finish with an incident the agent cannot resolve by itself. We will inspect both the **outcome** and the **trajectory**: a recovered service is not a success if the agent took an unauthorized action to get there.

The local app is supplied so we can spend our time on agent engineering. It has four places:

| Page | What it shows |
| --- | --- |
| [Inbox](http://127.0.0.1:5173/) | The agent's approval requests and questions, with controls to answer or deny |
| [Activity](http://127.0.0.1:5173/activity) | A list of runs and each run's saved observe/decide/act/wait history |
| [Events](http://127.0.0.1:5173/events) | Events the simulated service recorded and sent toward Inngest |
| [Simulator](http://127.0.0.1:5173/admin) | Workshop controls to create an incident, start an agent, and send events |

The simulator does not create a new agent for every event. We start **one run with one goal**. Events are signals that may wake that run; when it wakes, it reads the latest state. In the simulator, create a scenario, start the agent, then send a finite batch. Choose a count, an interval, and one event type or a weighted mix. A one-event batch is useful for a wakeup experiment. Several spaced health events are needed when we verify sustained recovery. The batch runs on the lab server even if you close the dashboard.

## What you need before we start

You should be comfortable with JavaScript or TypeScript, `async`/`await`, npm, Git, and a basic Node.js server. Prior agent experience is helpful but not required. Bring Node.js LTS, npm, Git, an editor, an internet connection, and an LLM API key with available usage. The app and Inngest Dev Server run locally; the database lives on Neon. You do not need a local PostgreSQL installation, a deployment, or an Inngest Cloud account.

From the `background-agents` directory, start on the `lesson-1` branch and set up the supplied app:

```bash
git switch lesson-1
npm install
cp .env.example .env
```

Open [neon.new](https://neon.new/), create a temporary database without an account, and copy its **PostgreSQL connection string**. Put the entire string in `.env`, along with your working model key and model. Copy the database URL, not the claim URL:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-available-model
```

That URL is an example of the format; use your own from Neon and do not commit `.env`. The unclaimed database expires after **72 hours**. For work beyond that window, claim it before expiry or create another free database and run the schema and seed commands again. Neon says neon.new is being sunset in favor of [Claimable Neon](https://neon.com/claimable-neon), so use Neon's current no-account page if this link has moved by the time you watch the VOD.

Run the setup and start the lab:

```bash
npm run db:push
npm run preflight
npm run db:seed
npm run dev
```

The dashboard is at [localhost:5173](http://127.0.0.1:5173), the Inngest Dev Server is at [localhost:8288](http://127.0.0.1:8288), and these notes can run in another terminal with `npm run docs` at [localhost:5174](http://127.0.0.1:5174). Keep the Inngest Dev Server running during the restart experiments. The repository's `README.md` has more setup detail if a process does not start.

## How the lesson branches work

Each lesson starts on a branch that contains the previous lesson's finished code. Its solution is the next branch. The notes show the exact edits between them, so you can follow live, catch up during the break, or compare your files with the solution. Lesson 00 is this introduction; it has no code edit. Begin the live coding on `lesson-1`.

| Live lesson | Start here | Finished solution |
| --- | --- | --- |
| 1 · Goal and harness | `lesson-1` | `lesson-2` |
| 2 · Durable execution | `lesson-2` | `lesson-3` |
| 3 · Events and waiting | `lesson-3` | `lesson-4` |
| 4 · Human approval | `lesson-4` | `lesson-5` |
| 5 · Safe retries | `lesson-5` | `lesson-6` |
| 6 · Incident drill | `lesson-6` | `complete` |

For example, after lesson 2, your working code should match `lesson-3`. If you fall behind, save your work before switching: `git stash push -u -m "workshop progress"`, then `git switch lesson-3`. A branch switch changes code; it does not reset PostgreSQL or Inngest history. Create a fresh simulator scenario before a new drill. We will leave at least 15 minutes after each live lesson to catch up and ask questions.

Each lesson begins with the engineering idea and the tradeoffs I want us to discuss. Then we inspect the behavior, type the code, run it, break it deliberately, and look at the trace. New functions appear as normal code blocks. When an existing block changes, the diff includes unchanged context to show exactly where the edit belongs; red lines leave and green lines enter. The code is here for you as well as for me while I live code. Some model choices will vary, so compare the state, policy, and trace instead of expecting a fixed transcript.

Before we begin, open the Simulator and explain to a neighbor what would happen if a health event arrived while the agent process was down. Where should the event be stored? How would the run notice it later? Keep that answer in mind as we add durability and waits.

[Next: Give the agent a goal →](/01-goal-and-harness/)

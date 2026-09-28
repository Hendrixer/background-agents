# Build AI Agents that Never Sleep

I think background agents are the real productivity unlock: give one a goal, let it observe a changing world, and have it reach out when it needs your judgment. In this workshop we will build a Node.js incident-response agent that keeps working after the initial request, waits for service events and human decisions, and resumes after a process restart.

The loop we will keep returning to is **goal → observe state → choose an action → enforce policy → act or wait → observe again**. The model proposes a next action. The harness decides what is allowed, when to pause, and what evidence counts as done. By the end of the day, the agent inbox will show where it needs your approval or answer, and the per-run activity log will show what happened while you were away.

The [Incident Lab](http://127.0.0.1:5173) and [Inngest Dev Server](http://127.0.0.1:8288) run locally. The lab UI, simulator, and database are supplied. Use `/admin` to create incidents and control events, `/agent` to inspect the agent's activity, `/events` to inspect service events, and the home page to respond to the agent in its inbox. You will build the agent and its harness.

## The day

| Time | Lesson |
| --- | --- |
| 09:30 | Give the agent a goal |
| 10:30 | Make progress durable |
| 11:30 | Wait for the world |
| 13:15 | Put a human in control |
| 14:15 | Make retries safe |
| 15:15 | Run an incident drill |

There is at least a 15-minute catch-up break after each lesson. Lunch begins at 12:15.

## Lesson notes and code

| Lesson | Start branch | Solution branch | Notes |
| --- | --- | --- | --- |
| 1 | `lesson-1` | `lesson-2` | [Goal and harness](/01-goal-and-harness/) |
| 2 | `lesson-2` | `lesson-3` | [Durable execution](/02-durable-execution/) |
| 3 | `lesson-3` | `lesson-4` | [Events and waiting](/03-events-and-waiting/) |
| 4 | `lesson-4` | `lesson-5` | [Human approval](/04-human-approval/) |
| 5 | `lesson-5` | `lesson-6` | [Safe retries](/05-safe-retries/) |
| 6 | `lesson-6` | `complete` | [Incident drill](/06-incident-drill/) |

If you move quickly, take the [advanced lab](/advanced-lab/): evaluate the agent across normal, failed, and human-interrupted runs, then defend one architecture change. It uses the same app and traces, so the challenge is in reasoning about evidence, authority, and failure rather than learning another framework.

Each lesson page contains exact code blocks derived from those two branches. Red lines are removed, green lines are added, and unchanged lines show where the edit belongs. The copy button on a diff copies the resulting code without diff prefixes.

Start with the lesson's engineering idea, including the research and tradeoffs I want us to discuss. Then see the behavior in the lab, make the live edits, inspect the trace, and run the failure experiment and engineering challenge. If your model picks a different action, follow the state and policy in the trace rather than expecting a fixed script. The instructor can use `AGENT_DEMO_MODE=1` for a repeatable demonstration; your normal run uses the model configured in `.env`.

For setup, install dependencies, create the `background_agents` PostgreSQL database, add your API key and model to `.env`, then run `npm run db:push`, `npm run db:seed`, and `npm run dev`. The repository README has the full process and branch instructions.

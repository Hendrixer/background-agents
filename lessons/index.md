# Build AI Agents that Never Sleep

In this workshop you will build a Node.js incident-response agent that keeps working after the initial request, waits for service events and human decisions, and resumes after a process restart.

The [Incident Lab](http://127.0.0.1:5173) and [Inngest Dev Server](http://127.0.0.1:8288) run locally. The lab UI, simulator, and database are supplied. You will build the agent and its harness.

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

Each lesson page contains exact code blocks derived from those two branches. Red lines are removed, green lines are added, and unchanged lines show where the edit belongs. The copy button on a diff copies the resulting code without diff prefixes.

For setup, install dependencies, create the `background_agents` PostgreSQL database, add your API key and model to `.env`, then run `npm run db:push`, `npm run db:seed`, and `npm run dev`. The repository README has the full process and branch instructions.

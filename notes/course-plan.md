# Background agents workshop — course plan

Status: reference app and six teaching checkpoints built, September 28, 2026. Instructor rehearsal with a real model key remains.

## Confirmed decisions

- One-day live workshop, later edited into a VOD.
- TypeScript/Node.js and Inngest. Required exercises run locally.
- Students bring a working LLM API key. No keyless runtime is required.
- Build an incident-response agent operating a small local demo service.
- Supply the UI, simulator, fixture data, and routine plumbing as starter code.
- Include event type, rate, start, stop, and manual injection controls in the UI.
- Scott live codes on the mirrored main screen and reads notes on a small podium monitor.
- Every lesson has Markdown notes containing the exact code changes and their locations.
- New files/functions use normal code blocks. Existing-code edits use contextual diffs with unchanged surrounding lines, green additions, and red removals.
- Preserve the branch convention: the next lesson starts with the current lesson's solution.
- Allow at least 15 minutes after each lesson for students to catch up; lunch can serve this purpose.

## Learning promise

Give an agent a goal, leave it working, and understand how it resumes correctly after a failure, an external event, or a human decision.

Chat describes an interface. Background execution describes a lifecycle. The same chat UI could launch a durable background run; the workshop makes that lifecycle visible.

## The application

An incident-response agent receives a goal such as:

> Restore the demo service, get approval before disruptive changes, verify sustained recovery, and produce an incident report.

The agent can inspect service health, read logs, inspect recent changes, propose changes, request help, and create an incident report. The exact tool list will be kept small during the reference build.

Candidate scenarios:

1. A feature rollout causes errors; disabling the relevant flag restores service.
2. A release causes errors; rollback requires approval.
3. An upstream dependency fails; retrying or rolling back the local release does not fix it, and the agent needs additional information or escalation.

Use real local state changes behind a simulated operations API. Clearly identify telemetry and infrastructure operations as simulated. Changing a flag must affect subsequent simulated health observations, rather than merely returning a success string.

The model chooses among meaningful investigation and remediation actions. Do not encode one hardcoded action sequence per incident, or expose the simulator's hidden root cause directly in the agent's context.

Keep arbitrary code execution, patch generation, GitHub integration, deployment, authentication, and cloud provisioning outside the required project.

## Architecture boundaries

| Component | Responsibility | Teaching treatment |
| --- | --- | --- |
| Lab server and UI | Service simulator, controls, event feed, local domain persistence, approvals interface, report display | Starter code |
| Agent process | State hydration, model decision, action validation, execution, completion rules | Live coded |
| Inngest Dev Server | Durable execution and development inspection | Introduced early and used throughout |
| Notes site | Local Markdown lesson browser | Starter tooling |

The simulator runs server-side and independently of the agent process. Closing the browser or restarting the agent must not reset the lab. Scripts should make the agent process easy to restart without restarting the entire environment.

Separate authoritative service state from Inngest's execution checkpoints. At a new decision boundary, read fresh service state inside a new durable step. On replay of an existing step, reuse its saved result. After approval, check current preconditions before executing the approved action.

The harness owns validation, tool policy, limits, suspension, and terminal transitions. The model proposes an action; the harness determines whether and how to execute it.

For the main scenario, use an explicit success predicate: fresh health observations satisfy a configured recovery window, required actions have completed, and a report exists. A model-selected `complete` action requests completion; it does not override the predicate. An unsupported scenario may end as unresolved/escalated, visibly distinct from success.

Waiting for approval or help is nonterminal. Model/tool failures may be retryable. Completed, failed, cancelled, and escalated outcomes must be distinguishable.

## Six-lesson progression

Each lesson should take roughly 45 minutes: 8 minutes of explanation, 5 minutes of demonstration/prediction, 25 minutes of coding, and 7 minutes of verification. This is a rehearsal budget, not a promise before the code is written.

| Lesson | Student work | Visible proof |
| --- | --- | --- |
| 1. Give the agent a goal | Define the small action catalog, hydrate state, build the decision loop, enforce basic validation and a completion condition | Investigate and fix a simple incident; inspect every decision |
| 2. Make progress durable | Move model calls and tool execution into explicit Inngest steps | Restart the agent process; completed steps reuse their results |
| 3. Wait for the world | Introduce event correlation, durable waits, timeouts, fresh state on wakeup, and recovery verification | Stop health events, resume them, and see the run wait instead of spin |
| 4. Put a human in control | Gate disruptive actions, persist exact proposals, handle approval/rejection/expiry, revalidate before execution | Approve after an app restart; reject or expire another proposal |
| 5. Make retries safe | Demonstrate the side-effect/checkpoint gap, implement action idempotency, add run bounds and cancellation | Lose a response after a successful action; recover without repeating the effect |
| 6. Run an incident drill | Add a small new policy/tool or scenario with a complete reference solution; diagnose it from the trace | Handle an unfamiliar incident and explain the final report and run history |

Keep observability present from the first lesson. Treat context management as selecting the evidence needed for the next decision. Explain queueing and concurrency at the relevant execution boundary; do not build an extra queue system.

Scheduling is a brief application of the same wakeup model. Prefer durable timers and recovery checks in the main path; a cron-triggered run can be a short extension if rehearsal time permits.

## Schedule

Assumes the original 09:30–16:30 window. Lunch moves 15 minutes later to give all six lessons equal space.

| Time | Activity |
| --- | --- |
| 09:30–10:15 | Lesson 1 |
| 10:15–10:30 | Break and catch-up |
| 10:30–11:15 | Lesson 2 |
| 11:15–11:30 | Break and catch-up |
| 11:30–12:15 | Lesson 3 |
| 12:15–13:15 | Lunch and optional catch-up |
| 13:15–14:00 | Lesson 4 |
| 14:00–14:15 | Break and catch-up |
| 14:15–15:00 | Lesson 5 |
| 15:00–15:15 | Break and catch-up |
| 15:15–16:00 | Lesson 6 |
| 16:00–16:15 | Break and catch-up |
| 16:15–16:30 | Wrap-up and questions |

The six lessons total 270 minutes. Breaks total 75 minutes, lunch 60, and wrap-up 15: 420 minutes overall. If lunch must remain at noon, shorten the morning lessons rather than remove catch-up breaks.

## Branches and authoring process

Retain the established convention:

- `lesson-1` contains the starter and lesson 1 notes.
- `lesson-2` contains lesson 1's solution and lesson 2 notes.
- Continue through `lesson-6`.
- `complete` contains lesson 6's solution and all notes.

List the start and solution branch explicitly at the top of every lesson. A mapping table should remove the off-by-one ambiguity. Optional immutable release tags can preserve the exact VOD checkpoints after the live course.

Build a complete reference app to discover the architecture, then construct a deliberate forward teaching sequence. Design the file boundaries around the lessons before polishing the full build. Most lessons should add a small module or make focused edits within existing functions. Keep surrounding code visible in the notes so every insertion and removal is easy to locate.

Keep starter contracts compatible across checkpoints so the UI can show unavailable features without requiring students to change UI code. The final demo should run in a separate prepared copy, so switching to the starter cannot destroy a live demo or its data.

Author explanations manually and derive code examples from actual checkpoint code. Validate the ordered edits against the start and solution snapshots. Full details are in [lesson-authoring.md](./lesson-authoring.md).

## Preparation sequence

1. ~~Agree on the tool catalog and simulator scenarios.~~
2. ~~Build the lab shell and one end-to-end reference incident.~~
3. ~~Add the durable lifecycle, approval gate, and failure experiments.~~
4. ~~Construct the forward lesson checkpoints and exact edit sequence.~~
5. ~~Generate code blocks and validate notes against checkpoints.~~
6. Rehearse every lesson on a clean checkout with a real model key and fresh lab state.
7. Freeze demo recordings and the teaching release for the VOD.

No lesson is ready solely because the final app works. Each start branch must run, its notes must lead to the documented end state, and its demo must be repeatable within the time budget.

## Reference behavior to verify during the build

- [Inngest durable agents](https://www.inngest.com/docs/learn/durable-agents): execution reconstruction with memoized step results.
- [Local development](https://www.inngest.com/docs/local-development): separate local runtime and app endpoint.
- [Wait for event](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event): event matching, timeouts, and events arriving before the wait.
- [Error handling](https://www.inngest.com/docs/guides/error-handling): retries do not remove the need for idempotent effects.

Pin and verify the chosen SDK and CLI versions before writing final code examples. Do not promise that killing the Inngest runtime itself has the same recovery behavior as restarting the student agent process; test any such demonstration separately with its actual persistence configuration.

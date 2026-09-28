from pathlib import Path
import subprocess
import sys

project = Path(__file__).resolve().parent.parent
lessons = [
    dict(slug='01-goal-and-harness', title='Give the agent a goal', time='09:30–10:15', start='lesson-1', solution='lesson-2',
         promise='A goal becomes a sequence of observed state, model-selected action, harness validation, and tool execution.',
         opening='Reset **Feature rollout**, select **health** and **log**, set **2/sec**, and start events. Show the degraded checkout service. Ask: “If I close the browser now, who owns the work?” The browser is only a control surface; the run is triggered by an event.',
         talk='A chat agent is usually organized around a request/response turn. This run has a goal and its own lifecycle. The model proposes one action at a time; the harness owns state lookup, action execution, the decision cap, and completion. Today the whole loop is deliberately one opaque Inngest step so the next lesson has a concrete failure to fix.',
         edit='Replace the placeholder handler inside `incidentAgent`. The imports and `executeAction` helper above it already exist and stay. Read the `-` lines as removals and the `+` lines as code to type.',
         verify='Start an agent from the UI with the supplied goal. It should inspect logs and changes, disable the feature, then complete once a healthy observation arrives. Open the Inngest trace: the entire loop is one `whole-agent-loop` step.',
         experiment='Stop the agent process while that single step is running, then restart it. Predict which model calls or tools might run again. The loop has no internal checkpoints, so a retry can replay earlier work. Do this only on a fresh lab instance.',
         mistakes='If it ends at the decision limit, confirm health events are streaming. If the model key is missing, set `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env` and restart only the agent process.',
         extension='Change the goal to request a different final report and inspect which parts of the harness still stay deterministic.'),
    dict(slug='02-durable-execution', title='Make progress durable', time='10:30–11:15', start='lesson-2', solution='lesson-3',
         promise='Each costly or effectful operation becomes a named Inngest step whose result survives a process restart.',
         opening='Show the `whole-agent-loop` trace from lesson 1. Ask: “If the process dies after disabling the feature but before the step returns, what can the retry know?” Then reset Feature rollout.',
         talk='Inngest reruns function code to reconstruct a workflow and reuses completed step results. A `step.run` boundary is therefore both a replay boundary and a debugging landmark. Keep step IDs stable and unique for each loop cycle. A durable sleep releases the process while the run is waiting.',
         edit='In `server/agent-workflow.ts`, replace the single opaque `step.run("whole-agent-loop")` with the shown loop. The helper and function options remain. This is one larger refactor; typecheck after the whole block is in place.',
         verify='Start the Feature rollout run and inspect the Inngest trace. You should see `observe-state-*`, `choose-action-*`, `execute-action-*`, and named sleeps as separate steps. Restart only `npm run dev:agent` while the run sleeps; the lab and Inngest Dev Server stay up.',
         experiment='While a run sleeps, stop only the agent endpoint and restart it. Ask students to identify which step outputs were replayed from history rather than redoing a tool call. The Inngest Dev Server used in this workshop is local and should remain running.',
         mistakes='Do not restart the Inngest Dev Server for this demo. If “duplicate step ID” appears, check that the ID contains `cycle`; repeated static IDs inside a loop are ambiguous.',
         extension='Add one more read-only inspection action and decide whether its result belongs inside its own step.'),
    dict(slug='03-events-and-waiting', title='Wait for the world', time='11:30–12:15', start='lesson-3', solution='lesson-4',
         promise='The run pauses on correlated events, wakes up, reloads state, and completes only after sustained fresh recovery.',
         opening='With Feature rollout reset, stop the event stream before starting an agent. The current code polls every two seconds. Ask: “What state should the agent trust after it wakes?”',
         talk='The event is a wakeup signal, not the truth. Match it to this lab instance, then read the latest state again. A timeout is a reconciliation opportunity when delivery is missed. Completion is owned by `hasRecovered`: three recent healthy observations spread across time, so one green sample cannot prematurely end the run.',
         edit='In `server/agent-workflow.ts`, change the completion check and each poll. Keep the surrounding status updates. The `hasRecovered` helper is supplied in `server/agent-data.ts`; this lesson wires it into the durable loop.',
         verify='Start the run with events stopped. The UI should show `waiting`. Emit one health event: the run wakes but must not complete. Resume the stream; after remediation and three fresh healthy observations, it completes and writes a report.',
         experiment='Stop events again while the run is waiting. Wait longer than one ten-second timeout and inspect the trace: the function reconciles, then waits again without adding a new model decision. Restart events and watch it resume.',
         mistakes='If the run never wakes, check that the event has the same `labId` and that the Inngest Dev Server is still running. A deployment or log event wakes the run but does not count as a healthy observation.',
         extension='Change the recovery predicate to require a longer window and discuss how demo time and production signal quality trade off.'),
    dict(slug='04-human-approval', title='Put a human in control', time='13:15–14:00', start='lesson-4', solution='lesson-5',
         promise='A model can propose a rollback, but only an explicit human decision can authorize it.',
         opening='Reset **Faulty release** and start health/log events at **1/sec**. Show that the model can select `rollback_release` on the current branch. Ask who must own permission for that action.',
         talk='An approval is a persisted proposal with exact input and an expiry. The workflow waits for the decision event, reads the saved decision after wakeup, and rechecks the release before acting. If the condition changed, old approval is stale. Rejection and expiry are terminal escalations, not silent retries.',
         edit='In `server/agent-workflow.ts`, add the imports and the rollback gate immediately after `actionId` is computed. The final `execute-action` call must remain below the gate.',
         verify='Start an agent on Faulty release. It should reach `needs approval` without rolling back. Stop and restart only the agent endpoint, then approve in the UI. The rollback should happen once and the run should verify recovery. Reset and repeat with Reject to see `escalated`.',
         experiment='Leave a proposal pending while the agent process is down, approve, then restart it. The decision is in PostgreSQL and the wait reconciles even if the notification arrived before the endpoint was ready. For an expiry rehearsal, temporarily shorten the proposal expiry in `server/agent-data.ts` and reset afterward.',
         mistakes='Do not approve a proposal from an older lab reset. The dashboard only shows the current lab; reset creates a new lab ID. If approval seems stuck, inspect the `wait-for-approval-*` trace and the saved proposal status.',
         extension='Add a second gated action and decide whether it should require the same approval shape or a different one.'),
    dict(slug='05-safe-retries', title='Make retries safe', time='14:15–15:00', start='lesson-5', solution='lesson-6',
         promise='A tool response can disappear after its effect commits; the same action ID must return the prior result instead of repeating the effect.',
         opening='Reset **Feature rollout**, arm **Lose the next tool response**, start health/log events, then start an agent. The first call returns 503 after the database commit. Ask: “Did the action happen, and how can the retry find out?”',
         talk='Inngest checkpoints after `step.run` returns. Between the external effect and that checkpoint is an uncertainty window. The operations API owns idempotency using a stable action ID inside a database transaction. Cancellation is another durable event and the loop also reads the run status at a safe boundary.',
         edit='Make the two focused edits in `server/agent-workflow.ts`, then the two edits inside `applyAction` in `server/lab-data.ts`. The rest of the simulator code is supplied. The ID already passed from the workflow is `runId:iteration:action`.',
         verify='Arm the failure and run Feature rollout. In the trace, `execute-action-*` retries. In the dashboard timeline and `actions` table, the matching action ID appears once. Use Cancel run while a workflow waits and confirm it stops.',
         experiment='Before adding the `applyAction` edits, the retry inserts a second action row because the server makes a new UUID. After the edits, the first response can still be lost, but the second request returns the saved result. Reset the scenario between the two runs.',
         mistakes='Idempotency must live where the effect happens. A client-side “already called” flag disappears on restart. Keep the same `actionId` across retries; a new UUID for each attempt defeats the table constraint.',
         extension='Consider how you would carry this key through a third-party API that supports an idempotency header.'),
    dict(slug='06-incident-drill', title='Run an incident drill', time='15:15–16:00', start='lesson-6', solution='complete',
         promise='The agent asks for help when its tools cannot fix an external dependency, then waits for a recovery signal and reports the outcome.',
         opening='Reset **Upstream outage** and start health, log, and dependency events. Ask: “Would another local rollback change the payment gateway?” The agent needs a human answer and a new external state, not more local tool calls.',
         talk='`request_help` is a model-selected action that the harness turns into a nonterminal human gate. Once answered, the run waits for the dependency to recover. It does not treat an answer as proof of service health. A fresh observation and the deterministic recovery predicate still decide completion.',
         edit='In `server/agent-workflow.ts`, add the external-wait branch before `chooseAction`, then let `request_help` share the persisted proposal path. The rollback recheck still applies only to rollback.',
         verify='Start the Upstream outage run. Answer the agent in the UI, then click **Simulate upstream recovery**. It should wait until fresh healthy observations arrive, complete, and produce an incident report. Read the Inngest trace and timeline aloud to reconstruct the run.',
         experiment='Answer the help request but do not recover the dependency. The run should remain waiting through multiple timeouts. Then recover it; no second help proposal or local rollback should be needed. Reset and try `Cannot help` to see escalation.',
         mistakes='If the model keeps asking for help, confirm the saved human decision is `approved` and inspect `agentState.humanDecisions`. If the service is healthy but completion has not happened, ensure health events continue long enough for three fresh samples.',
         extension='Have students propose one different terminal policy, such as an explicit unresolved report after a configured deadline, and identify which part belongs to the model versus the harness.'),
]

def diff_blocks(start, solution):
    output = subprocess.check_output(['git', 'diff', '--unified=3', start, solution, '--', 'server/agent-workflow.ts', 'server/lab-data.ts'], cwd=project, text=True)
    blocks = []
    file = None
    hunk = None
    for line in output.splitlines():
        if line.startswith('diff --git '):
            if hunk:
                blocks.append((file, hunk))
                hunk = None
            file = line.split(' b/', 1)[1]
        elif line.startswith('@@ '):
            if hunk:
                blocks.append((file, hunk))
            hunk = []
        elif hunk is not None and line[:1] in (' ', '+', '-') and not line.startswith(('+++ ', '--- ')):
            hunk.append(line)
    if hunk:
        blocks.append((file, hunk))
    return blocks

for number, lesson in enumerate(lessons, 1):
    output = project / 'lessons' / lesson['slug'] / 'index.md'
    output.parent.mkdir(parents=True, exist_ok=True)
    blocks = diff_blocks(lesson['start'], lesson['solution'])
    content = [f"# {number:02d} · {lesson['title']}", '',
               f"**{lesson['time']} · 45 minutes**  ",
               f"Start: `{lesson['start']}` · Finished solution: `{lesson['solution']}`", '',
               f"**Outcome:** {lesson['promise']}", '',
               '## Open and predict', '', lesson['opening'], '',
               'Instructor cue: spend about 8 minutes on the idea, 5 minutes on this demo and prediction, 25 minutes coding, and 7 minutes verifying. Leave the scheduled catch-up break intact.', '',
               '## The idea', '', lesson['talk'], '',
               '## Live coding', '', lesson['edit'], '',
               'These code blocks are the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed. Keep the unchanged context visible while typing.', '']
    for index, (file, lines) in enumerate(blocks, 1):
        content += [f'### Edit {index} · `{file}`', '',
                    f'Open `{file}` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.', '',
                    '```diff', *lines, '```', '']
    content += ['Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.', '',
                '## Verify', '', lesson['verify'], '',
                '## Failure experiment', '', lesson['experiment'], '',
                '## Catch-up checkpoint', '',
                f'Your solution is `{lesson["solution"]}`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson {number} progress"`, then `git switch {lesson["solution"]}`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.', '',
                f'**Common mistake:** {lesson["mistakes"]}', '',
                f'**Optional extension:** {lesson["extension"]}', '']
    rendered = '\n'.join(content)
    if '--check' in sys.argv:
        if not output.exists() or output.read_text() != rendered:
            raise SystemExit(f'Lesson notes are out of sync: {output}')
    else:
        output.write_text(rendered)

if '--check' in sys.argv:
    print('All six lesson code blocks match the branch checkpoints.')

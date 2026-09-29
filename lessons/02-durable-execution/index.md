# 02 · Make progress durable

Start: `lesson-2` · Finished solution: `lesson-3`

**Outcome:** Each observation, model decision, tool effect, and report becomes a named durable step.

## The engineering idea

Our first agent has a goal and a loop, but all of its work sits inside one `whole-agent-loop` step. Imagine it inspects logs, calls a model, disables the bad feature, and then the Node process dies before the step returns. The service may have changed, but the workflow has no saved result for the step. A retry may have to repeat the whole block. A long-running agent cannot rely on one process remaining alive.

Durable execution gives the run a history outside that process. Inngest persists each completed `step.run` result and reconstructs the function by rerunning its code with those saved results. Completed callbacks are skipped; the workflow continues at the first unfinished step. That is why we give **state read**, **model choice**, **tool effect**, and **report** their own named boundaries. The decision is especially important: on replay, I do not want a fresh model answer to rewrite what the agent decided earlier. [Inngest's execution model](https://www.inngest.com/docs/learn/how-functions-are-executed) explains this step-by-step reconstruction.

There is a subtle distinction here. A model-directed path can be dynamic on its first run while its replay is deterministic. The model may choose `inspect_logs`, `disable_feature`, or `request_help`; we do not predefine that sequence. Once a choice is checkpointed, replay must use the recorded choice so the same branch is reconstructed. Our `cycle` number makes every step ID unique as the loop repeats. Static IDs inside the loop would make the history ambiguous.

This is also a developer-experience choice. I want to open the Inngest trace and see where an agent observed, decided, acted, failed, slept, and resumed. A single opaque step might technically run, but it gives me very little to debug or explain to a user. A good background agent should have a legible run history, not just a final answer.

We will replace an in-process delay with `step.sleep`. The run can pause without keeping our agent endpoint busy. Then we will restart only the endpoint and watch the workflow resume. The checkout service and Inngest Dev Server remain up; in this local workshop the Dev Server holds its own execution history in memory, so restarting it is a different experiment.

Durability is not a promise that external effects happen exactly once. A tool can commit a change and lose its response before the step result is saved. We will deliberately cause that gap in lesson 5. For now, the point is to make progress explicit and recoverable one meaningful step at a time.

### Replay is not restoring a suspended stack

The function body runs again after a wakeup or retry. Inngest uses the completed step results to reconstruct the path through it. Code outside a step can run again, so I keep external effects inside named steps. The [Inngest execution guide](https://www.inngest.com/docs/learn/how-functions-are-executed) is the reference for this behavior. When you inspect a trace, separate **the JavaScript that was reevaluated** from **the step callback that actually executed**. That distinction explains why a normal local variable is fine for computing a step name but not a durable place to store business state.

Think carefully about the model call. If `chooseAction` ran again after a restart, a newer model version or a stochastic response could pick a different action for the same old observation. Saving the decision in `choose-action-*` makes that choice part of the run's history. The following tool step must use the saved choice. This is the useful tension in a durable agent: the agent is free to choose a path at a new decision point, but a replay must respect a choice it already made.

### Two clocks, two stores

The checkout process holds current service state; PostgreSQL holds incident, approval, event, and action history. Inngest holds completed workflow steps. A checkpointed `observe-state-3` is evidence of what the agent saw during cycle 3; it is not a promise that checkout still looks that way in cycle 4. We create a new observation step for each cycle precisely because the world is mutable. The database and workflow history answer different questions: **What is true now?** and **What did this run already do?**

There is a tradeoff in where we put step boundaries. One step around the entire loop hides partial progress and can repeat many operations. A step around every tiny pure calculation makes the trace noisy and increases history without adding recoverability. I checkpoint calls whose results matter after a crash: reading current state, choosing an action, executing an effect, and writing a report. The status writes are visible in the trace because they explain what a person sees while the agent works. I would revisit that granularity with actual traces, not by adding steps everywhere by habit.

Long-running code also changes while old runs are sleeping. [Inngest's versioning guide](https://www.inngest.com/docs/learn/versioning) explains how step IDs affect memoized results. Reusing an ID means an in-progress run can reuse an old result; changing it can force work to execute again. That is an architecture and deployment decision, especially for a model call or side effect. Before changing a step name in a production agent, I would ask which existing runs might wake on the new code and what they would repeat.

Anthropic's [long-running harness work](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) reaches a related conclusion from coding agents: progress across sessions needs explicit artifacts that the next session can inspect. Our incident state and step history are small versions of those artifacts. A long prompt alone is not durable memory.

## See it in the lab

Open Inngest traces for a feature incident. The whole loop is one opaque step; a failure near the end can replay model calls and tool attempts. We will expose the important checkpoints and a durable settle timer.

## Live coding

Replace the opaque `whole-agent-loop` handler in `server/agent-workflow.ts` with named Inngest steps. Keep each repeated step ID tied to its cycle number. The action ID is still attempt-local; lesson 5 will show why that is insufficient for external effects.

These code blocks show the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Replace the whole-loop checkpoint with named steps; keep unique cycle suffixes.

```diff
 } from './agent-data'
 import { chooseAction, writeReport } from './agent-brain'
 import { inngest } from './inngest'
+import { logAgentActivity } from './agent-log'
 import { checkoutServiceUrl } from './observe'
+import { actionPolicy } from './tool-policy'
+import type { ActionName } from '../shared/types'
+
+async function executeAction(
+  environmentId: string,
+  runId: string,
+  actionId: string,
+  name: ActionName,
+  expectedVersion?: number,
+) {
+  const input = expectedVersion === undefined ? {} : { expectedVersion }
+  await logAgentActivity(environmentId, runId, 'act', `Calling ${name.replaceAll('_', ' ')}`, {
+    actionId,
+    input,
+  })
+  try {
+    const response = await fetch(`${checkoutServiceUrl}/operations`, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ actionId, name, ...input }),
+    })
+    const result = (await response.json()) as Record<string, unknown>
+    if (!response.ok) throw new Error(String(result.error || `Tool failed: ${response.status}`))
+    if (result.stale !== true)
+      await recordToolAction(environmentId, runId, actionId, name, input, result)
+    return result
+  } catch (error) {
+    await logAgentActivity(
+      environmentId,
+      runId,
+      'act',
+      `${name.replaceAll('_', ' ')} attempt failed`,
+      {
+        actionId,
+        error: error instanceof Error ? error.message : String(error),
+      },
+    )
+    throw error
+  }
+}

 export const incidentAgent = inngest.createFunction(
-  { id: 'incident-agent', name: 'Checkout incident agent', triggers: { event: 'incident/opened' } },
+  {
+    id: 'incident-agent',
+    name: 'Checkout incident agent',
+    triggers: { event: 'incident/opened' },
+    retries: 2,
+    // This limits executing steps, not the number of waiting incidents.
+    concurrency: { limit: 1, key: 'event.data.environmentId' },
+    onFailure: async ({ error, event }) => {
+      const original = event.data.event as { data?: { runId?: string } }
+      if (original.data?.runId) await setRun(original.data.runId, 'failed', error.message)
+    },
+  },
   async ({ event, step }) => {
-    const { environmentId, runId } = event.data
-    // One opaque checkpoint proves the loop, but hides where each effect happened.
-    return step.run('whole-agent-loop', async () => {
-      const run = await getRun(runId)
-      for (let cycle = 1; cycle <= 8; cycle++) {
-        const state = await agentState(environmentId, runId)
-        if (goalSatisfied(state, run.goalCondition)) {
-          const report = await writeReport(run.goal, state)
-          await setRun(runId, 'completed', null, report)
-          return { report }
-        }
-        const decision = await chooseAction(run.goal, state)
-        await setIteration(runId, cycle)
-        await recordDecision(environmentId, runId, cycle, decision.action, decision.reason)
-        if (
-          decision.action === 'wait' ||
-          decision.action === 'complete' ||
-          decision.action === 'request_help'
-        ) {
-          await setRun(runId, 'escalated', 'This first loop cannot pause yet')
-          return
-        }
-        if (decision.action === 'rollback_release') {
-          await setRun(runId, 'escalated', 'Approval gate is not built yet')
-          return
-        }
-        const actionId = randomUUID()
-        const response = await fetch(checkoutServiceUrl + '/operations', {
-          method: 'POST',
-          headers: { 'Content-Type': 'application/json' },
-          body: JSON.stringify({
-            actionId,
-            name: decision.action,
-            expectedVersion: state.world.version,
-          }),
-        })
-        const result = (await response.json()) as Record<string, unknown>
-        if (!response.ok) throw new Error(String(result.error ?? response.status))
-        if (result.stale !== true)
-          await recordToolAction(
+    const { environmentId, runId, instanceId } = event.data
+    const run = await getRun(runId)
+    if (
+      run.instanceId !== instanceId ||
+      ['completed', 'failed', 'cancelled', 'escalated', 'superseded'].includes(run.status)
+    )
+      return
+
+    for (let cycle = 1; cycle <= 24; cycle++) {
+      const current = await getRun(runId)
+      if (['completed', 'failed', 'cancelled', 'escalated', 'superseded'].includes(current.status))
+        return
+      const state = await step.run(`observe-state-${cycle}`, () => agentState(environmentId, runId))
+
+      if (goalSatisfied(state, run.goalCondition)) {
+        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state))
+        await step.run(`complete-run-${cycle}`, () => setRun(runId, 'completed', null, report))
+        return { report }
+      }
+
+      const decision = await step.run(`choose-action-${cycle}`, () => chooseAction(run.goal, state))
+      await step.run(`set-iteration-${cycle}`, () => setIteration(runId, cycle))
+      await step.run(`record-decision-${cycle}`, () =>
+        recordDecision(environmentId, runId, cycle, decision.action, decision.reason),
+      )
+
+      if (decision.action === 'wait' || (decision.action === 'complete' && run.goalCondition)) {
+        await step.run('wait-unavailable-' + cycle, () =>
+          setRun(runId, 'escalated', 'Event wait is not built yet'),
+        )
+        return
+      }
+      if (decision.action === 'complete') {
+        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state))
+        await step.run(`complete-run-${cycle}`, () => setRun(runId, 'completed', null, report))
+        return { report }
+      }
+
+      if (decision.action === 'request_help') {
+        await step.run(`help-unavailable-${cycle}`, () =>
+          setRun(runId, 'escalated', 'Human help path is not built yet'),
+        )
+        return
+      }
+      // An attempt-local ID is intentionally unsafe when a response is lost.
+      const actionId = randomUUID()
+      const policy = actionPolicy[decision.action]
+      if (policy === 'approval') {
+        await step.run('approval-unavailable-' + cycle, () =>
+          setRun(runId, 'escalated', 'Approval gate is not built yet'),
+        )
+        return
+      }
+
+      const result = await step.run(`execute-action-${cycle}`, () =>
+        executeAction(
+          environmentId,
+          runId,
+          actionId,
+          decision.action,
+          policy === 'read' ? undefined : state.world.version,
+        ),
+      )
+      if (result.stale === true) {
+        await step.run(`stale-action-${cycle}`, () =>
+          logAgentActivity(
             environmentId,
             runId,
-            actionId,
-            decision.action,
-            { expectedVersion: state.world.version },
+            'act',
+            'Action rejected because service state changed',
             result,
-          )
+          ),
+        )
+        continue
       }
-      await setRun(runId, 'escalated', 'Decision limit reached')
-    })
+      await step.run(`settle-status-${cycle}`, () =>
+        setRun(runId, 'waiting', 'Waiting briefly before observing the effect'),
+      )
+      await step.sleep(`settle-${cycle}`, '1s')
+    }
+
+    await step.run('stop-at-limit', () => setRun(runId, 'escalated', 'Decision limit reached'))
   },
 )
```

Run `npm run format`, `npm run lint`, and `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Start checkout with `--fault feature`. Inngest should show observation, choice, action, and sleep steps. Restart only `dev:agent` during a sleep while keeping checkout and Inngest running; the run should continue from saved checkpoints.

## Break it on purpose

Find the boundary between a service operation committing and Inngest recording a successful step result. What happens if the response is lost in that gap?

## Engineering challenge

Make a crash-window table: before model output is saved, after a tool commits but before acknowledgement, and after a step result is saved. For each window, state what can repeat.

## Catch up

Your solution is `lesson-3`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 2 progress"`, then `git switch lesson-3`. A branch switch changes code, not PostgreSQL, checkout process state, or Inngest history. Restart checkout with a fresh fault flag for the next drill.

**Common mistake:** A durable step records a successful result, not an effect it never heard back from. Do not restart the Inngest Dev Server for the local replay demonstration.

**Optional extension:** Identify one step whose output could be recomputed without changing the result, and defend whether it should be checkpointed.

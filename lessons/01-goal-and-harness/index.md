# 01 · Give the agent a goal

Start: `lesson-1` · Finished solution: `lesson-2`

**Outcome:** A checkout alert opens an incident, and a bounded harness observes, chooses, acts, and verifies the goal.

## The engineering idea

I think background agents are the real productivity unlock. A chat box can answer while I am there, but work I care about often outlives the conversation. A service needs to recover; a project needs more evidence; a person may need to approve a risky action hours later. I want to give an agent an **outcome**, leave, and return to progress or a precise request for my help.

“Chat agent” describes an interface. “Background agent” describes a lifecycle. A chat message can launch a durable run, and that run can later reach me in an inbox. What matters is who owns work between interactions. Our checkout service sends an alert to the operator API. That API opens one incident run with a goal snapshot, status, history, and stopping condition. Later alerts join it. The browser is irrelevant to the run's survival.

The loop we build is **observe current world → choose one action → let the harness validate and execute it → observe again**. The model can select among actions based on evidence without our coding a path for every failure. The harness owns the action catalog, the decision limit, and the test for completion. I do not want the model to be the sole authority on its own success. [Anthropic's agent guidance](https://www.anthropic.com/engineering/building-effective-agents) distinguishes model-directed action from predefined workflows and emphasizes environmental feedback and stopping conditions.

The checkout process is a small synthetic service, but it is still a separate process with its own state and API. A startup fault changes what it returns; an agent operation can change that state again. The harness sees no fault flag. `agentState` reads current checkout state and a bounded slice of events, actions, and human decisions. The model returns one structured choice, which the harness evaluates. This first loop sits inside one large step, making its recovery weakness visible for lesson 2.

Not every task needs an agent. If `if release === "v2-bad" then rollback` describes the full, authorized solution, I would write a workflow. The model earns its place when evidence and the next action are uncertain. A validated JSON action is only a well-formed suggestion; it is not authorization, proof of cause, or evidence of recovery.

### Four different kinds of information

**World state** is what checkout returns now. **Run state** is the incident's goal, status, and decision count. **Execution history** is what Inngest has already checkpointed. **Event history** records notifications that the world may have changed. Confusing these leads to common agent failures: treating an alert payload as a current snapshot, treating a past observation as current, or treating a model's proposed outcome as an actual effect. The [ReAct paper](https://arxiv.org/abs/2210.03629) studies reasoning and acting with environmental feedback; the practical lesson here is to take a bounded step and look again.

Our tool list is deliberately small. `inspect_logs` and `inspect_changes` gather evidence. `disable_feature` and `rollback_release` change checkout. `wait`, `request_help`, and `complete` request lifecycle changes, which the harness interprets. Clear, compact tool boundaries make a model's choices easier to inspect; [Anthropic's tool-design guidance](https://www.anthropic.com/engineering/writing-tools-for-agents) is a useful reference. Logs are evidence, not instructions: untrusted tool content can try to redirect an agent, as [AgentDojo](https://arxiv.org/abs/2406.13352) demonstrates. Policy enforced in code matters more than a prompt telling the model to behave.

## See it in the lab

Start checkout with `--fault feature`. The service sends an alert and the operator API opens an incident, but the placeholder function does no investigation. Inspect `/events` and `/activity`: an event is present, and the run lacks a useful trajectory.

## Live coding

Replace the placeholder function in `server/agent-workflow.ts` with the first observe–decide–act loop. The checkout API, event intake, database access, model choice, and operator UI are supplied. This first version deliberately puts the whole loop inside one Inngest step.

These code blocks show the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Replace the placeholder function. The alert intake and checkout API are supplied.

```diff
+import { randomUUID } from 'node:crypto'
+import {
+  agentState,
+  getRun,
+  goalSatisfied,
+  recordDecision,
+  recordToolAction,
+  setIteration,
+  setRun,
+} from './agent-data'
+import { chooseAction, writeReport } from './agent-brain'
 import { inngest } from './inngest'
+import { checkoutServiceUrl } from './observe'

-// The alert intake has already opened an incident. Build its harness here.
 export const incidentAgent = inngest.createFunction(
   { id: 'incident-agent', name: 'Checkout incident agent', triggers: { event: 'incident/opened' } },
-  async ({ event }) => {
-    return { runId: event.data.runId, next: 'Build the observe–decide–act loop' }
+  async ({ event, step }) => {
+    const { environmentId, runId } = event.data
+    // One opaque checkpoint proves the loop, but hides where each effect happened.
+    return step.run('whole-agent-loop', async () => {
+      const run = await getRun(runId)
+      for (let cycle = 1; cycle <= 8; cycle++) {
+        const state = await agentState(environmentId, runId)
+        if (goalSatisfied(state, run.goalCondition)) {
+          const report = await writeReport(run.goal, state)
+          await setRun(runId, 'completed', null, report)
+          return { report }
+        }
+        const decision = await chooseAction(run.goal, state)
+        await setIteration(runId, cycle)
+        await recordDecision(environmentId, runId, cycle, decision.action, decision.reason)
+        if (
+          decision.action === 'wait' ||
+          decision.action === 'complete' ||
+          decision.action === 'request_help'
+        ) {
+          await setRun(runId, 'escalated', 'This first loop cannot pause yet')
+          return
+        }
+        if (decision.action === 'rollback_release') {
+          await setRun(runId, 'escalated', 'Approval gate is not built yet')
+          return
+        }
+        const actionId = `${runId}:${randomUUID()}`
+        const response = await fetch(checkoutServiceUrl + '/operations', {
+          method: 'POST',
+          headers: { 'Content-Type': 'application/json' },
+          body: JSON.stringify({
+            actionId,
+            name: decision.action,
+            expectedVersion: state.world.version,
+          }),
+        })
+        const result = (await response.json()) as Record<string, unknown>
+        if (!response.ok) throw new Error(String(result.error ?? response.status))
+        if (result.stale !== true)
+          await recordToolAction(
+            environmentId,
+            runId,
+            actionId,
+            decision.action,
+            { expectedVersion: state.world.version },
+            result,
+          )
+      }
+      await setRun(runId, 'escalated', 'Decision limit reached')
+    })
   },
 )
```

Run `npm run format`, `npm run lint`, and `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Restart checkout with `--fault feature`. The model may inspect logs, changes, or both; the run should disable the feature, observe the now-healthy state, and complete. Try `--fault release`: this early harness escalates because its approval gate is not built.

## Break it on purpose

Compare the alert payload with the body returned by the checkout `/state` endpoint. Why should the agent read the latter? Restart checkout healthy and confirm that `service.started` does not open an incident.

## Engineering challenge

Draw the authority boundaries for checkout state, event delivery, incident creation, model choice, tool policy, and completion. Which data is snapshotted when the incident opens, and which must be read fresh?

## Catch up

Your solution is `lesson-2`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 1 progress"`, then `git switch lesson-2`. A branch switch changes code, not PostgreSQL, checkout process state, or Inngest history. Restart checkout with a fresh fault flag for the next drill.

**Common mistake:** The event is a doorbell, not the world state. Do not let the model decide whether it needs an approval; the harness owns that boundary.

**Optional extension:** Write one extra read-only investigation tool and identify which process owns its result.

# 02 · Make progress durable

Start: `lesson-2` · Finished solution: `lesson-3`

**Outcome:** Model choices, observations, effects, and reports become named Inngest checkpoints.

## The engineering idea

Our first agent has a goal and a loop, but all of its work sits inside one `whole-agent-loop` step. Imagine it inspects logs, calls a model, disables the bad feature, and then the Node process dies before the step returns. The service may have changed, but the workflow has no saved result for the step. A retry may have to repeat the whole block. A long-running agent cannot rely on one process remaining alive.

Durable execution gives the run a history outside that process. Inngest persists each completed `step.run` result and reconstructs the function by rerunning its code with those saved results. Completed callbacks are skipped; the workflow continues at the first unfinished step. That is why we give **state read**, **model choice**, **tool effect**, and **report** their own named boundaries. The decision is especially important: on replay, I do not want a fresh model answer to rewrite what the agent decided earlier. [Inngest's execution model](https://www.inngest.com/docs/learn/how-functions-are-executed) explains this step-by-step reconstruction.

There is a subtle distinction here. A model-directed path can be dynamic on its first run while its replay is deterministic. The model may choose `inspect_logs`, `disable_feature`, or `request_help`; we do not predefine that sequence. Once a choice is checkpointed, replay must use the recorded choice so the same branch is reconstructed. Our `cycle` number makes every step ID unique as the loop repeats. Static IDs inside the loop would make the history ambiguous.

This is also a developer-experience choice. I want to open the Inngest trace and see where an agent observed, decided, acted, failed, slept, and resumed. A single opaque step might technically run, but it gives me very little to debug or explain to a user. A good background agent should have a legible run history, not just a final answer.

We will replace an in-process delay with `step.sleep`. The run can pause without keeping our agent endpoint busy. Then we will restart only the endpoint and watch the workflow resume. The lab and Inngest Dev Server remain up; in this local workshop the Dev Server holds its own execution history in memory, so restarting it is a different experiment.

Durability is not a promise that external effects happen exactly once. A tool can commit a change and lose its response before the step result is saved. We will deliberately cause that gap in lesson 5. For now, the point is to make progress explicit and recoverable one meaningful step at a time.

### Replay is not restoring a suspended stack

The function body runs again after a wakeup or retry. Inngest uses the completed step results to reconstruct the path through it. Code outside a step can run again, so I keep external effects inside named steps. The [Inngest execution guide](https://www.inngest.com/docs/learn/how-functions-are-executed) is the reference for this behavior. When you inspect a trace, separate **the JavaScript that was reevaluated** from **the step callback that actually executed**. That distinction explains why a normal local variable is fine for computing a step name but not a durable place to store business state.

Think carefully about the model call. If `chooseAction` ran again after a restart, a newer model version or a stochastic response could pick a different action for the same old observation. Saving the decision in `choose-action-*` makes that choice part of the run's history. The following tool step must use the saved choice. This is the useful tension in a durable agent: the agent is free to choose a path at a new decision point, but a replay must respect a choice it already made.

### Two clocks, two stores

PostgreSQL holds the current service state, approval, and run status. Inngest holds completed workflow steps. A checkpointed `observe-state-3` is evidence of what the agent saw during cycle 3; it is not a promise that checkout still looks that way in cycle 4. We create a new observation step for each cycle precisely because the world is mutable. The database and workflow history answer different questions: **What is true now?** and **What did this run already do?**

There is a tradeoff in where we put step boundaries. One step around the entire loop hides partial progress and can repeat many operations. A step around every tiny pure calculation makes the trace noisy and increases history without adding recoverability. I checkpoint calls whose results matter after a crash: reading current state, choosing an action, executing an effect, and writing a report. The status writes are visible in the trace because they explain what a person sees while the agent works. I would revisit that granularity with actual traces, not by adding steps everywhere by habit.

Long-running code also changes while old runs are sleeping. [Inngest's versioning guide](https://www.inngest.com/docs/learn/versioning) explains how step IDs affect memoized results. Reusing an ID means an in-progress run can reuse an old result; changing it can force work to execute again. That is an architecture and deployment decision, especially for a model call or side effect. Before changing a step name in a production agent, I would ask which existing runs might wake on the new code and what they would repeat.

Anthropic's [long-running harness work](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) reaches a related conclusion from coding agents: progress across sessions needs explicit artifacts that the next session can inspect. Our incident state and step history are small versions of those artifacts. A long prompt alone is not durable memory.

## See it in the lab

Run a degraded Feature rollout event and inspect the one whole-agent-loop trace. It hides the distinction between a model choice and a committed tool effect. We will split those operations into named steps and replace the in-process timer with a durable sleep.

## Live coding

In server/agent-workflow.ts, add the concurrency comment, then replace the whole handler after the run is loaded. Keep each repeated step ID tied to its cycle number. Make the replacement as one edit, then typecheck.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Keep the concurrency setting; this comment makes its step-level scope explicit.

```diff
     name: "Event-triggered background agent",
     triggers: { event: "service/event.received" },
     retries: 2,
+    // Separate events create separate runs. Only one step per environment executes
+    // at a time; a waiting human approval does not block later runs.
     concurrency: { limit: 1, key: "event.data.environmentId" },
     onFailure: async ({ error, event }) => {
       const original = event.data.event as { data?: { eventId?: string } };
```

### Edit 2 · `server/agent-workflow.ts`

Replace the opaque whole-agent-loop block with named steps. A unique cycle suffix prevents step-ID collisions.

```diff
     const { environmentId, eventId, type, payload } = event.data;
     const run = await startRun(environmentId, eventId, type, payload);
     const runId = run.id;
-    return step.run("whole-agent-loop", async () => {
-      for (let cycle = 1; cycle <= 8; cycle++) {
-        const state = await agentState(environmentId, runId);
-        if (goalSatisfied(state, run.goalCondition)) {
-          const report = await writeReport(run.goal, state);
-          await setRun(runId, "completed", null, report);
-          return { report };
-        }
-        const decision = await chooseAction(run.goal, state);
-        await setIteration(runId, cycle);
-        await recordDecision(environmentId, runId, cycle, decision.action, decision.reason);
-        if (decision.action === "defer") {
-          await setRun(runId, "deferred", decision.reason);
-          return;
-        }
-        if (decision.action === "complete") {
-          if (run.goalCondition) {
-            await setRun(runId, "deferred", "Configured goal condition is not satisfied");
-            return;
-          }
-          const report = await writeReport(run.goal, state);
-          await setRun(runId, "completed", null, report);
-          return { report };
-        }
-        if (decision.action === "request_help") {
-          await setRun(runId, "escalated", "Help requests are added in lesson 6");
+    if (["completed", "failed", "cancelled", "escalated", "deferred"].includes(run.status)) return;
+
+    for (let cycle = 1; cycle <= 8; cycle++) {
+      const state = await step.run(`observe-state-${cycle}`, () => agentState(environmentId, runId));
+
+      if (goalSatisfied(state, run.goalCondition)) {
+        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
+        await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
+        return { report };
+      }
+
+      const decision = await step.run(`choose-action-${cycle}`, () => chooseAction(run.goal, state));
+      await step.run(`set-iteration-${cycle}`, () => setIteration(runId, cycle));
+      await step.run(`record-decision-${cycle}`, () => recordDecision(environmentId, runId, cycle, decision.action, decision.reason));
+
+      if (decision.action === "defer") {
+        await step.run(`defer-run-${cycle}`, () => setRun(runId, "deferred", decision.reason));
+        return;
+      }
+      if (decision.action === "complete") {
+        if (run.goalCondition) {
+          await step.run(`reject-completion-${cycle}`, () => logAgentActivity(environmentId, runId, "human", "Completion blocked by configured goal condition", { condition: run.goalCondition }));
+          await step.run(`defer-unverified-${cycle}`, () => setRun(runId, "deferred", "Configured goal condition is not satisfied"));
           return;
         }
-        await executeAction(environmentId, runId, `${runId}:${cycle}:${decision.action}`, decision.action);
-        await new Promise((resolve) => setTimeout(resolve, 1000));
+        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
+        await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
+        return { report };
       }
-      await setRun(runId, "escalated", "Decision limit reached");
-    });
+
+      if (decision.action === "request_help") {
+        await step.run(`help-not-implemented-${cycle}`, () => setRun(runId, "escalated", "Help requests are added in lesson 6"));
+        return;
+      }
+      const actionId = `${runId}:${cycle}:${decision.action}`;
+      await step.run(`execute-action-${cycle}`, () => executeAction(environmentId, runId, actionId, decision.action));
+      await step.run(`settle-status-${cycle}`, () => setRun(runId, "waiting", "Waiting briefly before observing tool effects"));
+      await step.sleep(`settle-${cycle}`, "2s");
+    }
+
+    await step.run("stop-at-limit", () => setRun(runId, "escalated", "Decision limit reached"));
   },
 );
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Send a Feature rollout event. Inngest should show observe-state, choose-action, execute-action, and settle steps rather than one opaque loop. Restart only dev:agent during a two-second settle sleep and confirm the run resumes without repeating completed step callbacks.

## Break it on purpose

Contrast a successful step result with the database's latest state. What did the run observe then, and what is true now? Deliberately stop the agent endpoint during sleep while keeping Inngest and the simulator running.

## Engineering challenge

Build a crash-window table for before the model choice is saved, after a tool commits but before its response arrives, and after the step result is saved. For each window, say what replay knows and what might repeat. Explain why durable execution alone cannot guarantee exactly one external effect.

## Catch up

Your solution is `lesson-3`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 2 progress"`, then `git switch lesson-3`. A branch switch changes code, not PostgreSQL or Inngest history; save a fresh state and emit a new event for the next drill.

**Common mistake:** Do not restart the Inngest Dev Server for this local durability demo; its history is in memory. Reused static step IDs inside a loop make replay ambiguous.

**Optional extension:** Choose one step whose result need not be checkpointed and justify removing it.

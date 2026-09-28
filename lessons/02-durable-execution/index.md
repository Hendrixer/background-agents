# 02 · Make progress durable

Start: `lesson-2` · Finished solution: `lesson-3`

**Outcome:** Each costly or effectful operation becomes a named Inngest step whose result survives a process restart.

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

PostgreSQL holds the current incident, approval, and run status. Inngest holds completed workflow steps. A checkpointed `observe-state-3` is evidence of what the agent saw during cycle 3; it is not a promise that checkout still looks that way in cycle 4. We create a new observation step for each cycle precisely because the world is mutable. The database and workflow history answer different questions: **What is true now?** and **What did this run already do?**

There is a tradeoff in where we put step boundaries. One step around the entire loop hides partial progress and can repeat many operations. A step around every tiny pure calculation makes the trace noisy and increases history without adding recoverability. I checkpoint calls whose results matter after a crash: reading current state, choosing an action, executing an effect, and writing a report. The status writes are visible in the trace because they explain what a person sees while the agent works. I would revisit that granularity with actual traces, not by adding steps everywhere by habit.

Long-running code also changes while old runs are sleeping. [Inngest's versioning guide](https://www.inngest.com/docs/learn/versioning) explains how step IDs affect memoized results. Reusing an ID means an in-progress run can reuse an old result; changing it can force work to execute again. That is an architecture and deployment decision, especially for a model call or side effect. Before changing a step name in a production agent, I would ask which existing runs might wake on the new code and what they would repeat.

Anthropic's [long-running harness work](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) reaches a related conclusion from coding agents: progress across sessions needs explicit artifacts that the next session can inspect. Our incident state and step history are small versions of those artifacts. A long prompt alone is not durable memory.

## See it in the lab

Open the `whole-agent-loop` trace from lesson 1, then reset **Feature rollout**. The service may have changed during the step, but the trace contains one result for the entire loop. We will make each expensive decision and external effect visible as its own checkpoint.

## Live coding

In `server/agent-workflow.ts`, replace the single opaque `step.run("whole-agent-loop")` with the shown loop. The helper and function options remain. This is one larger refactor; typecheck after the whole block is in place.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Lift the loop out of `whole-agent-loop` so Inngest can checkpoint its meaningful operations separately. Notice the unique `${cycle}` suffix on every repeated step ID. Replace this handler as one edit, then typecheck.

```diff
   async ({ event, step }) => {
     const { labId, runId } = event.data;
     const run = await getRun(runId);
+    if (["completed", "failed", "cancelled", "escalated"].includes(run.status)) return;
 
-    return step.run("whole-agent-loop", async () => {
-      for (let iteration = 1; iteration <= 12; iteration++) {
-        const currentLab = await activeLab();
-        if (currentLab?.id !== labId) {
-          await setRun(runId, "cancelled", "Scenario was reset");
-          return;
-        }
+    let decisions = 0;
+    let cycle = 0;
+    while (decisions < 12) {
+      cycle += 1;
+      const currentLab = await activeLab();
+      if (currentLab?.id !== labId) {
+        await step.run(`scenario-reset-${cycle}`, () => setRun(runId, "cancelled", "Scenario was reset"));
+        return;
+      }
+
+      const state = await step.run(`observe-state-${cycle}`, () => agentState(labId));
 
-        const state = await agentState(labId);
-        if (state.service.healthy && state.observations.length > 0) {
-          const report = await writeReport(run.goal, state);
-          await setRun(runId, "completed", null, report);
-          return { report };
-        }
+      if (state.service.healthy && state.observations.length > 0) {
+        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
+        await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
+        return { report };
+      }
 
-        if (state.observations.length === 0) {
-          await setRun(runId, "waiting", "Waiting for the first health observation");
-          await new Promise((resolve) => setTimeout(resolve, 1000));
-          continue;
-        }
+      if (state.service.healthy || state.observations.length === 0) {
+        await step.run(`wait-status-${cycle}`, () => setRun(runId, "waiting", "Waiting for fresh health observations"));
+        await step.sleep(`poll-for-health-${cycle}`, "2s");
+        continue;
+      }
 
-        const decision = await chooseAction(run.goal, state);
-        await setIteration(runId, iteration);
-        await recordDecision(labId, runId, iteration, decision.action, decision.reason);
-        if (decision.action === "complete") {
-          await addTimeline(labId, "policy", "Completion rejected: service is not healthy", {}, runId);
-          continue;
-        }
+      const decision = await step.run(`choose-action-${cycle}`, () => chooseAction(run.goal, state));
+      decisions += 1;
+      const iteration = decisions;
+      await step.run(`set-iteration-${cycle}`, () => setIteration(runId, iteration));
+      await step.run(`record-decision-${cycle}`, () => recordDecision(labId, runId, iteration, decision.action, decision.reason));
 
-        await executeAction(labId, `${runId}:${iteration}:${decision.action}`, decision.action);
-        await new Promise((resolve) => setTimeout(resolve, 1000));
+      if (decision.action === "complete") {
+        await step.run(`reject-early-completion-${cycle}`, () => addTimeline(labId, "policy", "Completion rejected: recovery is not verified", {}, runId));
+        await step.sleep(`poll-after-early-completion-${cycle}`, "2s");
+        continue;
       }
-      await setRun(runId, "escalated", "Decision limit reached");
-    });
+
+      const actionId = `${runId}:${iteration}:${decision.action}`;
+      await step.run(`execute-action-${cycle}`, () => executeAction(labId, actionId, decision.action));
+      await step.run(`wait-status-after-action-${cycle}`, () => setRun(runId, "waiting", "Waiting for the service to report its new state"));
+      await step.sleep(`poll-after-action-${cycle}`, "2s");
+    }
+
+    await step.run("stop-at-limit", () => setRun(runId, "escalated", "Decision limit reached"));
   },
 );
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Start the Feature rollout run and inspect the Inngest trace. You should see `observe-state-*`, `choose-action-*`, `execute-action-*`, and named sleeps as separate steps. Restart only the agent endpoint while the run sleeps; the lab and Inngest Dev Server stay up.

## Break it on purpose

If you started everything with `npm run dev`, stop that combined command first and restart `npm run dev:lab`, `npm run dev:web`, `npm run dev:inngest`, and `npm run dev:agent` in separate terminals. While a run sleeps, restart only the agent terminal. Identify which step outputs came from history and which callback actually ran. Keep the local Inngest Dev Server running throughout this experiment.

## Engineering challenge

Make a crash-window table for three points: after the model chooses an action, after the operations API commits but before it replies, and after Inngest records the step result. For each point, state what replay knows, what it may repeat, and which system has the authority to deduplicate the effect. Then imagine deploying a changed `choose-action-*` step while a run waits. Would you reuse the step ID or deliberately change it, and why?

## Catch up

Your solution is `lesson-3`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 2 progress"`, then `git switch lesson-3`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** Do not restart the Inngest Dev Server for this demo. If “duplicate step ID” appears, check that the ID contains `cycle`; repeated static IDs inside a loop are ambiguous.

**Optional extension:** Add one more read-only inspection action and decide whether its result belongs inside its own step.

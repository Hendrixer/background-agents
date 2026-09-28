# 02 · Make progress durable

**10:30–11:15 · 45 minutes**  
Start: `lesson-2` · Finished solution: `lesson-3`

**Outcome:** Each costly or effectful operation becomes a named Inngest step whose result survives a process restart.

## Open and predict

Show the `whole-agent-loop` trace from lesson 1. Ask: “If the process dies after disabling the feature but before the step returns, what can the retry know?” Then reset Feature rollout.

Instructor cue: spend about 8 minutes on the idea, 5 minutes on this demo and prediction, 25 minutes coding, and 7 minutes verifying. Leave the scheduled catch-up break intact.

## The idea

Inngest reruns function code to reconstruct a workflow and reuses completed step results. A `step.run` boundary is therefore both a replay boundary and a debugging landmark. Keep step IDs stable and unique for each loop cycle. A durable sleep releases the process while the run is waiting.

## Live coding

In `server/agent-workflow.ts`, replace the single opaque `step.run("whole-agent-loop")` with the shown loop. The helper and function options remain. This is one larger refactor; typecheck after the whole block is in place.

These code blocks are the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed. Keep the unchanged context visible while typing.

### Edit 1 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

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

Start the Feature rollout run and inspect the Inngest trace. You should see `observe-state-*`, `choose-action-*`, `execute-action-*`, and named sleeps as separate steps. Restart only `npm run dev:agent` while the run sleeps; the lab and Inngest Dev Server stay up.

## Failure experiment

While a run sleeps, stop only the agent endpoint and restart it. Ask students to identify which step outputs were replayed from history rather than redoing a tool call. The Inngest Dev Server used in this workshop is local and should remain running.

## Catch-up checkpoint

Your solution is `lesson-3`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 2 progress"`, then `git switch lesson-3`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** Do not restart the Inngest Dev Server for this demo. If “duplicate step ID” appears, check that the ID contains `cycle`; repeated static IDs inside a loop are ambiguous.

**Optional extension:** Add one more read-only inspection action and decide whether its result belongs inside its own step.

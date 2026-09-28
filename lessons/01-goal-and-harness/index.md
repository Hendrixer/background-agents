# 01 · Give the agent a goal

**09:30–10:15 · 45 minutes**  
Start: `lesson-1` · Finished solution: `lesson-2`

**Outcome:** A goal becomes a sequence of observed state, model-selected action, harness validation, and tool execution.

## Open and predict

Reset **Feature rollout**, select **health** and **log**, set **2/sec**, and start events. Show the degraded checkout service. Ask: “If I close the browser now, who owns the work?” The browser is only a control surface; the run is triggered by an event.

Instructor cue: spend about 8 minutes on the idea, 5 minutes on this demo and prediction, 25 minutes coding, and 7 minutes verifying. Leave the scheduled catch-up break intact.

## The idea

A chat agent is usually organized around a request/response turn. This run has a goal and its own lifecycle. The model proposes one action at a time; the harness owns state lookup, action execution, the decision cap, and completion. Today the whole loop is deliberately one opaque Inngest step so the next lesson has a concrete failure to fix.

## Live coding

Replace the placeholder handler inside `incidentAgent`. The imports and `executeAction` helper above it already exist and stay. Read the `-` lines as removals and the `+` lines as code to type.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
       if (original.data?.runId) await setRun(original.data.runId, "failed", error.message);
     },
   },
-  async ({ event }) => {
-    await setRun(event.data.runId, "waiting", "Build the agent loop in lesson 1");
+  async ({ event, step }) => {
+    const { labId, runId } = event.data;
+    const run = await getRun(runId);
+
+    return step.run("whole-agent-loop", async () => {
+      for (let iteration = 1; iteration <= 12; iteration++) {
+        const currentLab = await activeLab();
+        if (currentLab?.id !== labId) {
+          await setRun(runId, "cancelled", "Scenario was reset");
+          return;
+        }
+
+        const state = await agentState(labId);
+        if (state.service.healthy && state.observations.length > 0) {
+          const report = await writeReport(run.goal, state);
+          await setRun(runId, "completed", null, report);
+          return { report };
+        }
+
+        if (state.observations.length === 0) {
+          await setRun(runId, "waiting", "Waiting for the first health observation");
+          await new Promise((resolve) => setTimeout(resolve, 1000));
+          continue;
+        }
+
+        const decision = await chooseAction(run.goal, state);
+        await setIteration(runId, iteration);
+        await recordDecision(labId, runId, iteration, decision.action, decision.reason);
+        if (decision.action === "complete") {
+          await addTimeline(labId, "policy", "Completion rejected: service is not healthy", {}, runId);
+          continue;
+        }
+
+        await executeAction(labId, `${runId}:${iteration}:${decision.action}`, decision.action);
+        await new Promise((resolve) => setTimeout(resolve, 1000));
+      }
+      await setRun(runId, "escalated", "Decision limit reached");
+    });
   },
 );
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Start an agent from the UI with the supplied goal. It should inspect logs and changes, disable the feature, then complete once a healthy observation arrives. Open the Inngest trace: the entire loop is one `whole-agent-loop` step.

## Failure experiment

Stop the agent process while that single step is running, then restart it. Predict which model calls or tools might run again. The loop has no internal checkpoints, so a retry can replay earlier work. Do this only on a fresh lab instance.

## Catch-up checkpoint

Your solution is `lesson-2`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 1 progress"`, then `git switch lesson-2`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** If it ends at the decision limit, confirm health events are streaming. If the model key is missing, set `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env` and restart only the agent process.

**Optional extension:** Change the goal to request a different final report and inspect which parts of the harness still stay deterministic.

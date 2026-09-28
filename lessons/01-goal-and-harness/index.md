# 01 · Give the agent a goal

**09:30–10:15 · 45 minutes**  
Start: `lesson-1` · Finished solution: `lesson-2`

**Outcome:** A goal becomes a sequence of observed state, model-selected action, harness validation, and tool execution.

## Open and predict

Reset **Feature rollout**, select **health** and **log**, set **2/sec**, and start events. Checkout is degraded. Before we code, answer this: if you close the browser after giving the agent a goal, who owns the work? What would have to remain true for the agent to finish?

## The idea

I think background agents are the real productivity unlock. A chat box can answer a question, but the work I care about often outlives the conversation: a service needs to recover, a customer needs an answer, or a project needs several steps spread across hours. I want to hand an agent an **outcome**, leave, and come back to progress or a precise request for my help.

“Chat agent” and “background agent” describe different things. Chat is an interface. Background execution is a lifecycle. A chat message can start a background run, and a background run can later reach me in an inbox. What changes is who owns the work between those interactions. In our app, the browser sends a goal and can close. The run keeps its own ID, status, history, and stopping condition.

The loop we will build is small: **observe the current world → choose one next action → let the harness validate and execute it → observe again**. The model is useful because it can choose among actions based on evidence we did not hard-code into a fixed path. The harness is useful because it controls the action catalog, the actual tool call, the maximum number of decisions, and whether the goal is truly done. I do not want the model to be the sole authority on its own success. [Anthropic's agent guidance](https://www.anthropic.com/engineering/building-effective-agents) makes the same distinction between model-directed action and predefined workflow, and emphasizes ground truth from the environment and stopping conditions.

The incident lab gives us a concrete world to observe. `agentState` returns the service state, recent events, recent actions, and human decisions. Those are facts for the next decision, not a transcript to blindly replay. The model returns one structured choice. The harness performs the selected operation and checks the result. The first version puts that entire loop inside one long step. It works for the feature incident, but if the process disappears halfway through, we cannot tell which internal actions were already done. We will make that flaw visible before fixing it.

Not every task needs this architecture. If one model call can answer a question and nothing needs to happen later, keep it simple. Use a background agent when the goal needs multiple observations, actions, waits, or human decisions and when progress must survive the original request. The goal is more productive autonomy with clear boundaries, not a larger loop for its own sake.

Before coding, decide which parts you would trust to the model in this incident and which parts you would insist the application control. We will revisit that boundary in every lesson.

## Live coding

Replace the placeholder handler inside `incidentAgent`. The imports and `executeAction` helper above it already exist and stay. Read the `-` lines as removals and the `+` lines as code to type.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Replace the placeholder handler inside `incidentAgent`. Follow the loop in order: verify the lab, observe state, check completion, ask the model for one action, record it, execute it, and repeat. The imports and `executeAction` helper above already exist.

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

Start an agent from the UI with the supplied goal. Watch which action your model selects; in instructor demo mode it inspects logs and changes before disabling the feature. Once a healthy observation arrives, the run completes. Open the Inngest trace: the entire loop is one `whole-agent-loop` step.

## Failure experiment

On a fresh lab instance, stop the agent process while that single step is running, then restart it. Which model calls or tools could run again? The loop has no internal checkpoints, so a retry can replay earlier work.

## Catch-up checkpoint

Your solution is `lesson-2`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 1 progress"`, then `git switch lesson-2`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** If it ends at the decision limit, confirm health events are streaming. If the model key is missing, set `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env` and restart only the agent process.

**Optional extension:** Change the goal to request a different final report and inspect which parts of the harness still stay deterministic.

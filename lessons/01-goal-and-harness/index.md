# 01 · Give the agent a goal

Start: `lesson-1` · Finished solution: `lesson-2`

**Outcome:** One external event starts one bounded observe–decide–act run against a standing goal.

## The engineering idea

I think background agents are the real productivity unlock. A chat box can answer a question, but the work I care about often outlives the conversation: a service needs to recover, a customer needs an answer, or a project needs several steps spread across hours. I want to hand an agent an **outcome**, leave, and come back to progress or a precise request for my help.

“Chat agent” and “background agent” describe different things. Chat is an interface. Background execution is a lifecycle. A chat message can start a background run, and a background run can later reach me in an inbox. What changes is who owns the work between those interactions. In our app, we configure a standing goal before an event arrives. The event handler creates a run with its own ID, goal snapshot, status, history, and stopping condition. The browser can close.

The loop we will build is small: **observe the current world → choose one next action → let the harness validate and execute it → observe again**. The model is useful because it can choose among actions based on evidence we did not hard-code into a fixed path. The harness is useful because it controls the action catalog, the actual tool call, the maximum number of decisions, and whether the goal is truly done. I do not want the model to be the sole authority on its own success. [Anthropic's agent guidance](https://www.anthropic.com/engineering/building-effective-agents) makes the same distinction between model-directed action and predefined workflow, and emphasizes ground truth from the environment and stopping conditions.

The incident simulator gives us a concrete world to observe. It stores a JSON state object and publishes events, just as a simple external service could. The agent's event handler records the event and creates a run. `agentState` returns the latest service state, recent events, recent actions, and human decisions. Those are facts for the next decision, not a transcript to blindly replay. The model returns one structured choice. The harness performs the selected operation and checks the result. The first version puts that entire loop inside one long step. It works for the feature incident, but if the process disappears halfway through, we cannot tell which internal actions were already done. We will make that flaw visible before fixing it.

The checkout service is a simulation, and the dashboard says so explicitly. Saving a state does not create a run. Sending an event does not certify that the state is healthy. The agent must read the latest state and compare it with the goal. This gives us reproducible evidence for the workshop, not a claim that we measured real user traffic. In a production system I would ask where the signal came from, how fresh it is, whether it represents customers, and what false positives would cost before letting it end a run.

Not every task needs this architecture. If one model call can answer a question and nothing needs to happen later, keep it simple. Use a background agent when the goal needs multiple observations, actions, waits, or human decisions and when progress must survive the original request. The goal is more productive autonomy with clear boundaries, not a larger loop for its own sake.

Before coding, decide which parts you would trust to the model in this incident and which parts you would insist the application control. We will revisit that boundary in every lesson.

### The architecture is a contract

Our model returns `{ action, reason, detail }`. That schema is useful, but it only tells us that the response has the right *shape*. It does not prove the action is authorized, that the reason is true, or that the goal has been reached. The harness must still decide whether the action exists, whether its preconditions hold, whether it needs approval, and what to do after it runs. A valid JSON object can still be a bad decision.

I want you to distinguish three kinds of state. **World state** is what the checkout service is doing now. **Run state** is the agent's goal, status, and decision count. **Execution history** is what Inngest has already completed. If we mix these together, we can mistake a past observation for the current world or a model's claim for an actual side effect. The event is a fourth object: a notification that something may have changed. In lesson 1 we keep the loop deliberately crude so that distinction becomes visible when it fails.

The [ReAct paper](https://arxiv.org/abs/2210.03629) studied interleaving reasoning and actions with environmental feedback. I take a practical lesson from it: an agent should not make a long plan once and then act on stale assumptions. It needs to gather evidence, take a bounded next step, and look again. Our implementation does **not** need to expose a model's private reasoning trace to get that benefit. We need observable actions and results.

### Tool design is AI engineering

The action catalog is small on purpose. `inspect_logs` and `inspect_changes` gather evidence; `disable_feature` and `rollback_release` change the service; `request_help` hands a question to a person; `complete` is a proposal to stop. If I add ten nearly identical tools, I make selection harder without necessarily adding capability. [Anthropic's tool-design work](https://www.anthropic.com/engineering/writing-tools-for-agents) emphasizes clear boundaries and useful, compact tool results. In this app, the `agentState` tool gives the model a bounded view instead of dumping the entire event table into its context.

There is also a trust boundary. A log line is evidence about the service, not an instruction to the agent. Real logs, webpages, and tickets can contain text written by someone other than the operator. [AgentDojo](https://arxiv.org/abs/2406.13352) demonstrates how tool-fed content can redirect agents in realistic tasks. Our lab does not implement an injection attack, but the architectural answer is already visible: constrain the model's capabilities in code, treat retrieved content as data, and make consequential actions pass through policy.

If the correct remediation could be expressed completely as `if release === "v2-bad" then rollback`, I would write that workflow and skip the model. The model earns its place when the evidence and next action are genuinely uncertain. The engineer's job is to give it useful choices, reliable observations, and boundaries that remain true even when it guesses wrong.

## See it in the lab

On /admin, save a degraded state but do not send an event. Activity stays unchanged. Send one health event: the placeholder run appears. The agent's event handler has created the run and copied the standing goal. Our job is to give that run a harness.

## Live coding

In server/agent-workflow.ts, replace only the placeholder handler. The event trigger, tool-call helper, and database functions are supplied. This first loop is deliberately one opaque step; lesson 2 will expose its internal checkpoints.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Replace the placeholder handler. The surrounding function options and executeAction helper stay in place.

```diff
       }
     },
   },
-  async ({ event }) => {
+  async ({ event, step }) => {
     const { environmentId, eventId, type, payload } = event.data;
     const run = await startRun(environmentId, eventId, type, payload);
-    await setRun(run.id, "waiting", "Build the agent loop in lesson 1");
+    const runId = run.id;
+    return step.run("whole-agent-loop", async () => {
+      for (let cycle = 1; cycle <= 8; cycle++) {
+        const state = await agentState(environmentId, runId);
+        if (goalSatisfied(state, run.goalCondition)) {
+          const report = await writeReport(run.goal, state);
+          await setRun(runId, "completed", null, report);
+          return { report };
+        }
+        const decision = await chooseAction(run.goal, state);
+        await setIteration(runId, cycle);
+        await recordDecision(environmentId, runId, cycle, decision.action, decision.reason);
+        if (decision.action === "defer") {
+          await setRun(runId, "deferred", decision.reason);
+          return;
+        }
+        if (decision.action === "complete") {
+          if (run.goalCondition) {
+            await setRun(runId, "deferred", "Configured goal condition is not satisfied");
+            return;
+          }
+          const report = await writeReport(run.goal, state);
+          await setRun(runId, "completed", null, report);
+          return { report };
+        }
+        if (decision.action === "request_help") {
+          await setRun(runId, "escalated", "Help requests are added in lesson 6");
+          return;
+        }
+        await executeAction(environmentId, runId, `${runId}:${cycle}:${decision.action}`, decision.action);
+        await new Promise((resolve) => setTimeout(resolve, 1000));
+      }
+      await setRun(runId, "escalated", "Decision limit reached");
+    });
   },
 );
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Use the Feature rollout shortcut, save state, then send one event. The run should inspect evidence, disable the feature, and end deferred because the saved health is still degraded. Save the Recovered state and send another event: a second run should complete. Confirm the first run did not resume.

## Break it on purpose

Save a different state without emitting an event. Explain why no new run appears. Then emit two events rapidly and compare run IDs, goals, and observed state versions. The events start separate runs even if both read the same latest state.

## Engineering challenge

Draw the authority boundaries for event delivery, standing goal configuration, current world state, model choice, tool policy, and completion. Which of these should be snapshotted into a run, and which should be read fresh? Explain what happens if the goal changes after an event is sent.

## Catch up

Your solution is `lesson-2`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 1 progress"`, then `git switch lesson-2`. A branch switch changes code, not PostgreSQL or Inngest history; save a fresh state and emit a new event for the next drill.

**Common mistake:** The event payload is not the world state. The loop must call agentState each cycle. A tool changing the release or feature flag does not by itself prove that service health recovered.

**Optional extension:** Add a read-only inspection action to the tool catalog. State what it should return and what it must never mutate.

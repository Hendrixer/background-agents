# 03 · Wait for the world

**11:30–12:15 · 45 minutes**  
Start: `lesson-3` · Finished solution: `lesson-4`

**Outcome:** The run pauses on correlated events, wakes up, reloads state, and completes only after sustained fresh recovery.

## Open and predict

Reset **Feature rollout** and stop the event stream before starting an agent. Our current code polls every two seconds. When an event wakes the agent later, should it trust that event payload or read the service again?

## The idea

The world does not wait for an agent's loop. Traffic changes, deployments finish, and humans act while the agent is doing something else. A background agent needs a way to stop running and wake when there may be something new to consider. Polling every two seconds works in our tiny lab, but it turns “nothing happened” into repeated executions and obscures the real cause of progress.

I think of an event as a **doorbell**, not as the room itself. `lab/observation` tells this run that the lab may have changed. We correlate the event with `labId`, then call `agentState` again to read the current service, observations, actions, and human decisions. The event payload does not get to declare the goal complete. This separation matters because events can be delayed, duplicated, or arrive in an order that no longer describes the latest state.

`step.waitForEvent` suspends the Inngest run until a matching event or timeout. It does not need an open browser tab or a continuously running request. The timeout is useful as a reconciliation point: if a wakeup was missed, we read the authoritative state again and decide whether to wait more. The [Inngest wait reference](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event) notes an important race: a wait listens for events from the time it is established, so an event sent just before it can be missed. Reading state before and after waits keeps the system from treating the notification stream as the only truth.

Waiting is not the same as finishing. Our first completion check accepts one healthy observation. That is too easy for a noisy service: one good sample could follow many failures. We will add `hasRecovered` as an application-owned predicate. It requires the three latest health observations to be healthy, fresh, and spread over a minimum interval. The exact numbers are lab-sized teaching defaults; a real service would choose a recovery window based on its signals and risk.

This is the pattern I want you to remember: **wake on events, read current state, decide whether to act, wait, or end**. A schedule can be another source of wakeups. A webhook, a human reply, or another agent can ring the same doorbell. The harness keeps the goal and the safety rules stable across all of them.

When we stop the simulator, predict what should happen to the run. It should become visibly waiting, use no new model decisions on unchanged evidence, and continue once observations resume.

## Live coding

First add `hasRecovered` in `server/agent-data.ts`, then change the completion check and each poll in `server/agent-workflow.ts`. Keep the surrounding status updates.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-data.ts`

Add `hasRecovered` after the `AgentState` type. This is our deterministic definition of “done”; the model does not get to relax it. The `recordDecision` function below it stays where it is.

```ts
export function hasRecovered(state: AgentState) {
  const lastThree = state.observations.slice(0, 3);
  if (lastThree.length < 3 || !lastThree.every((item) => item.healthy)) return false;
  const newest = new Date(lastThree[0].at).getTime();
  const oldest = new Date(lastThree[2].at).getTime();
  if (Date.now() - newest > 20_000) return false;
  return newest - oldest >= 1_500;
}
```

### Edit 2 · `server/agent-workflow.ts`

Import the new predicate into the workflow before using it.

```diff
 import { activeLab, addTimeline } from "./lab-data";
-import { agentState, getRun, recordDecision, setIteration, setRun } from "./agent-data";
+import { agentState, getRun, hasRecovered, recordDecision, setIteration, setRun } from "./agent-data";
 import { chooseAction, writeReport } from "./agent-brain";
 import { inngest } from "./inngest";
 
```

### Edit 3 · `server/agent-workflow.ts`

Replace the one-sample success condition with `hasRecovered(state)`. The report runs only after that check passes.

```diff
 
       const state = await step.run(`observe-state-${cycle}`, () => agentState(labId));
 
-      if (state.service.healthy && state.observations.length > 0) {
+      if (hasRecovered(state)) {
         const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
         await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
         return { report };
```

### Edit 4 · `server/agent-workflow.ts`

When we have no observation or are waiting on enough healthy samples, suspend on a lab-correlated event instead of polling.

```diff
 
       if (state.service.healthy || state.observations.length === 0) {
         await step.run(`wait-status-${cycle}`, () => setRun(runId, "waiting", "Waiting for fresh health observations"));
-        await step.sleep(`poll-for-health-${cycle}`, "2s");
+        await step.waitForEvent(`wait-for-health-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
         continue;
       }
 
```

### Edit 5 · `server/agent-workflow.ts`

Use the same event-driven wait after an early `complete` proposal and after an operation. The next loop reads current state again.

```diff
 
       if (decision.action === "complete") {
         await step.run(`reject-early-completion-${cycle}`, () => addTimeline(labId, "policy", "Completion rejected: recovery is not verified", {}, runId));
-        await step.sleep(`poll-after-early-completion-${cycle}`, "2s");
+        await step.waitForEvent(`wait-after-early-completion-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
         continue;
       }
 
       const actionId = `${runId}:${iteration}:${decision.action}`;
       await step.run(`execute-action-${cycle}`, () => executeAction(labId, actionId, decision.action));
       await step.run(`wait-status-after-action-${cycle}`, () => setRun(runId, "waiting", "Waiting for the service to report its new state"));
-      await step.sleep(`poll-after-action-${cycle}`, "2s");
+      await step.waitForEvent(`wait-after-action-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
     }
 
     await step.run("stop-at-limit", () => setRun(runId, "escalated", "Decision limit reached"));
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Start the run with events stopped. The UI should show `waiting`. Emit one health event: the run wakes but must not complete. Resume the stream; after remediation and three fresh healthy observations, it completes and writes a report.

## Failure experiment

Stop events again while the run is waiting. Wait longer than one ten-second timeout and inspect the trace: the function reconciles, then waits again without adding a new model decision. Restart events and watch it resume.

## Catch-up checkpoint

Your solution is `lesson-4`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 3 progress"`, then `git switch lesson-4`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** If the run never wakes, check that the event has the same `labId` and that the Inngest Dev Server is still running. A deployment or log event wakes the run but does not count as a healthy observation.

**Optional extension:** Change the recovery predicate to require a longer window and discuss how demo time and production signal quality trade off.

# 03 · Wait for the world

Start: `lesson-3` · Finished solution: `lesson-4`

**Outcome:** The run pauses on correlated events, wakes up, reloads state, and completes only after sustained fresh recovery.

## The engineering idea

The world does not wait for an agent's loop. Traffic changes, deployments finish, and humans act while the agent is doing something else. A background agent needs a way to stop running and wake when there may be something new to consider. Polling every two seconds works in our tiny lab, but it turns “nothing happened” into repeated executions and obscures the real cause of progress.

I think of an event as a **doorbell**, not as the room itself. `lab/observation` tells this run that the lab may have changed. We correlate the event with `labId`, then call `agentState` again to read the current service, observations, actions, and human decisions. The event payload does not get to declare the goal complete. This separation matters because events can be delayed, duplicated, or arrive in an order that no longer describes the latest state.

`step.waitForEvent` suspends the Inngest run until a matching event or timeout. It does not need an open browser tab or a continuously running request. The timeout is useful as a reconciliation point: if a wakeup was missed, we read the authoritative state again and decide whether to wait more. The [Inngest wait reference](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event) notes an important race: a wait listens for events from the time it is established, so an event sent just before it can be missed. Reading state before and after waits keeps the system from treating the notification stream as the only truth.

Waiting is not the same as finishing. Our first completion check accepts one healthy observation. That is too easy for a noisy service: one good sample could follow many failures. We will add `hasRecovered` as an application-owned predicate. It requires a streak of at least three healthy observations, a fresh latest sample, a minimum span, and no long gap between samples. The exact numbers are lab-sized teaching defaults; a real service would choose a recovery window based on its signals and risk.

This is the pattern I want you to remember: **wake on events, read current state, decide whether to act, wait, or end**. A schedule can be another source of wakeups. A webhook, a human reply, or another agent can ring the same doorbell. The harness keeps the goal and the safety rules stable across all of them.

When we stop the simulator, predict what should happen to the run. It should become visibly waiting, use no new model decisions on unchanged evidence, and continue once observations resume.

### Events are hints; state is evidence

An event tells us that something may have changed. It can be duplicated, delayed, or delivered just before we start waiting. That is why the payload contains a correlation key, `labId`, and why the next cycle calls `agentState` again. We do not ask the event to certify recovery. [Inngest documents the wait timing](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event): an event sent before a wait is established can be missed. Our timeout is a reconciliation mechanism, not proof that the event system is perfectly reliable.

The design question is not simply “poll or subscribe?” It is **what happens when the notification is missing?** A system that only reacts to events can stall. A system that polls every second may waste work and obscure causality. We combine event-triggered wakeups with periodic re-reads of authoritative state. In a larger system I would choose the timeout based on how long the goal may safely remain stale and how expensive each reconciliation is.

### Define success without fooling yourself

A single healthy sample is a weak stopping rule. Three samples taken in a few milliseconds are also weak. Our predicate checks count and elapsed time, rejects an unhealthy sample, and breaks a streak if observations are more than five seconds apart. Otherwise a sample after a long telemetry outage could combine with old healthy samples and falsely certify recovery. This is a simple form of hysteresis: we demand sustained evidence before changing the run from waiting to complete. More samples reduce false positives but delay a legitimate completion. The right choice depends on the consequence of ending early, the cadence of measurements, and how noisy the signal is.

This is one place where AI engineering is also ordinary systems engineering. The model can recommend `complete`, but it cannot waive the measured recovery condition. Conversely, a deterministic recovery predicate can end the run even if the model would keep talking. That separation prevents a persuasive report from becoming its own evidence. In the [agent evaluation vocabulary Anthropic uses](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), the final environment state is an outcome; the model's text is part of the trajectory. We should inspect both, but not confuse them.

The current lab treats observations as trustworthy because it creates them locally. In a real incident, you would ask where each signal comes from, how old it is, what it measures, and whether one failed probe could hide behind an average. “Observe the world” is not a single API call; it is an evidence design problem.

## See it in the lab

Reset **Feature rollout**, stop the event stream, and start an agent. The run currently polls every two seconds. Watch how often it wakes when nothing in the service has changed; then emit one health event and compare the timeline.

## Live coding

First add `hasRecovered` in `server/agent-data.ts`, then change the completion check and each poll in `server/agent-workflow.ts`. Keep the surrounding status updates.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-data.ts`

Add `hasRecovered` after the `AgentState` type. This is our deterministic definition of “done”; the model does not get to relax it. The `recordDecision` function below it stays where it is.

```ts
export function hasRecovered(state: AgentState) {
  let healthySamples = 0;
  let oldestHealthyAt = 0;
  let previousHealthyAt = 0;
  for (const item of state.observations) {
    const observedAt = new Date(item.at).getTime();
    if (!item.healthy || (previousHealthyAt && previousHealthyAt - observedAt > 5_000)) break;
    healthySamples += 1;
    oldestHealthyAt = observedAt;
    previousHealthyAt = observedAt;
  }
  if (healthySamples < 3) return false;
  const newest = new Date(state.observations[0].at).getTime();
  return Date.now() - newest <= 20_000 && newest - oldestHealthyAt >= 1_500;
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

Start the run with events stopped. The UI should show `waiting`. Emit one health event: the run wakes but must not complete. Resume the stream; after remediation and a fresh healthy streak spanning at least 1.5 seconds, it completes and writes a report. A faster event rate needs more than three samples to span that interval.

## Break it on purpose

Stop events again while the run is waiting. Wait longer than one ten-second timeout and inspect the trace: the function reconciles, then waits again without adding a new model decision. Restart events and watch it resume.

## Engineering challenge

Change `hasRecovered` to require five fresh healthy observations instead of three and rerun the feature incident. Measure the extra time to completion. What failure does the longer window catch, and what real outage would it delay? Restore the course version afterward. Design a second signal you would require in a real checkout service, and decide whether a late `lab/observation` is evidence or merely a reason to read state again.

## Catch up

Your solution is `lesson-4`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 3 progress"`, then `git switch lesson-4`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** If the run never wakes, check that the event has the same `labId` and that the Inngest Dev Server is still running. A deployment or log event wakes the run but does not count as a healthy observation.

**Optional extension:** Change the recovery predicate to require a longer window and discuss how demo time and production signal quality trade off.

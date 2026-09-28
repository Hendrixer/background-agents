# 03 · Wait for the world

**11:30–12:15 · 45 minutes**  
Start: `lesson-3` · Finished solution: `lesson-4`

**Outcome:** The run pauses on correlated events, wakes up, reloads state, and completes only after sustained fresh recovery.

## Open and predict

With Feature rollout reset, stop the event stream before starting an agent. The current code polls every two seconds. Ask: “What state should the agent trust after it wakes?”

Instructor cue: spend about 8 minutes on the idea, 5 minutes on this demo and prediction, 25 minutes coding, and 7 minutes verifying. Leave the scheduled catch-up break intact.

## The idea

The event is a wakeup signal, not the truth. Match it to this lab instance, then read the latest state again. A timeout is a reconciliation opportunity when delivery is missed. Completion is owned by `hasRecovered`: three recent healthy observations spread across time, so one green sample cannot prematurely end the run.

## Live coding

First add `hasRecovered` in `server/agent-data.ts`, then change the completion check and each poll in `server/agent-workflow.ts`. Keep the surrounding status updates.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-data.ts`

Add this new function immediately after `export type AgentState`. The `recordDecision` function below it stays where it is.

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

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
 import { activeLab, addTimeline } from "./lab-data";
-import { agentState, getRun, recordDecision, setIteration, setRun } from "./agent-data";
+import { agentState, getRun, hasRecovered, recordDecision, setIteration, setRun } from "./agent-data";
 import { chooseAction, writeReport } from "./agent-brain";
 import { inngest } from "./inngest";
 
```

### Edit 3 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
 
       const state = await step.run(`observe-state-${cycle}`, () => agentState(labId));
 
-      if (state.service.healthy && state.observations.length > 0) {
+      if (hasRecovered(state)) {
         const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
         await step.run(`complete-run-${cycle}`, () => setRun(runId, "completed", null, report));
         return { report };
```

### Edit 4 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
 
       if (state.service.healthy || state.observations.length === 0) {
         await step.run(`wait-status-${cycle}`, () => setRun(runId, "waiting", "Waiting for fresh health observations"));
-        await step.sleep(`poll-for-health-${cycle}`, "2s");
+        await step.waitForEvent(`wait-for-health-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
         continue;
       }
 
```

### Edit 5 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

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

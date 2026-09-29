# 03 · Read the world after an event

Start: `lesson-3` · Finished solution: `lesson-4`

**Outcome:** A run carries the version it observed into a mutating tool, which rejects stale actions.

## The engineering idea

The world does not wait for an agent's loop. Traffic changes, deployments finish, and humans act while the agent is doing something else. This is where I want a clear event boundary: the service publishes a signal; the agent's handler creates a run and reads the world. The simulator is only a source of synthetic inputs. It stores state and emits the same event shape a real producer could emit. No branch in the harness asks whether the source was a workshop shortcut.

I think of an event as a **doorbell**, not as the room itself. `service/event.received` says that something may have changed. It carries a correlation key and event data, but the agent does not treat the payload as a certified snapshot or a completion claim. `agentState` reads the latest saved state. If the simulator changes state twice before the agent executes, the run should see the current state, not replay a fictional world from an old event payload.

Every service event creates a **new** run. That gives each attempt a goal snapshot, decision budget, action IDs, and activity history. A human response is different: it resumes the **same** run that asked for approval or help. We do not make a run wait indefinitely for future service events. It can end as deferred when there is no justified local action. A later event starts another run against the latest state. This distinction makes causality easier to explain in the Activity page.

This choice has a cost. A burst of ten events can make ten runs. Inngest concurrency can limit executing steps for an environment, but it does not turn ten notifications into one semantic incident. We must decide whether to process every event, deduplicate identical IDs, coalesce a burst, or use a single persistent watcher. Each policy can lose something: coalescing can discard a meaningful edge, while one run per event can repeat work and compete over a shared state. We keep one run per event in the workshop so the race is visible and teachable. [Inngest's concurrency reference](https://www.inngest.com/docs/reference/typescript/v4/functions/concurrency) describes the execution control; the application still owns the meaning of its events.

The race we fix in this lesson is between **observation** and **effect**. Suppose the agent observes state version 4 and decides to disable a feature. Before the call commits, an operator saves version 5. A check in the harness immediately before the HTTP request narrows the window but cannot close it: the state could change after that check. We pass `expectedVersion` to the operations API and compare it under the same database lock used for the change. A stale result ends the old run as deferred. The next event can create a new run with fresh evidence.

This is optimistic concurrency applied to an agent tool. The model chooses an action, but it cannot silently act on a world different from the one it saw. The precondition belongs at the **effect owner**, because that is the only place that can make the check and write atomic. It is a broad version check in this lab; in a production service I might scope it to the fields the action depends on, especially if unrelated telemetry changes frequently. Narrowing the check increases throughput but also increases the burden of proving that approval and action intent still mean the same thing.

### What the simulator proves—and what it cannot

Our editable JSON and event button let us reproduce “state changed before action” without manufacturing scenario branches in the harness. It does not prove that real telemetry is trustworthy. A production observer would need freshness, provenance, permissions, and a definition of health based on actual signals. [Anthropic's evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) separates an agent's trajectory from the environment outcome. A nice-looking action trace does not prove that checkout recovered; the state we observe after the action is separate evidence.

There is also a delivery gap to think about. If a producer changes its database and crashes before publishing the event, a purely event-driven agent never hears the doorbell. If the event is delivered twice, an agent might do duplicate work. An outbox or reconciliation job can address the first failure; stable event and action IDs address the second. We do not build a transactional outbox today, but you should be able to point to that failure window before calling this production-ready.

When we save state without emitting an event, predict what Activity should show. When we emit two events rapidly, predict how many runs appear and whether they must observe the same version. The answers tell us whether we have separated notification, world state, and run lifecycle cleanly.

## See it in the lab

Save a degraded state and emit two events quickly. Each event has its own run, and the two runs may inspect the same environment. Now change the state while an agent is deciding. An event ID tells us why a run started; it does not guarantee the state the run saw is still current when it acts.

## Live coding

First pass the observed version through executeAction in server/agent-workflow.ts and handle a stale result as a deferred run. Then add the locked version check at the start of applyAction in server/lab-data.ts. The simulator owns the tool effect, but the precondition is part of the agent's action contract.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Import tool policy, carry expectedVersion into write calls, and leave read-only calls without a precondition.

```diff
 import { chooseAction, writeReport } from "./agent-brain";
 import { inngest } from "./inngest";
 import { logAgentActivity } from "./agent-log";
+import { actionPolicy } from "./tool-policy";
 import type { ActionName } from "../shared/types";
 
-async function executeAction(environmentId: string, runId: string, actionId: string, name: ActionName) {
+async function executeAction(environmentId: string, runId: string, actionId: string, name: ActionName, expectedVersion?: number) {
   await logAgentActivity(environmentId, runId, "act", `Calling ${name.replaceAll("_", " ")}`, { actionId });
   try {
     const response = await fetch("http://127.0.0.1:3001/api/ops/action", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
-      body: JSON.stringify({ environmentId, actionId, name }),
+      body: JSON.stringify({ environmentId, actionId, name, input: expectedVersion === undefined ? {} : { expectedVersion } }),
     });
     const result = await response.json();
     if (!response.ok) throw new Error(result.error || `Tool failed: ${response.status}`);
```

### Edit 2 · `server/agent-workflow.ts`

When the effect owner reports stale state, end this run as deferred instead of acting on old evidence.

```diff
         return;
       }
       const actionId = `${runId}:${cycle}:${decision.action}`;
-      await step.run(`execute-action-${cycle}`, () => executeAction(environmentId, runId, actionId, decision.action));
+      const policy = actionPolicy[decision.action];
+      const result = await step.run(`execute-action-${cycle}`, () =>
+        executeAction(environmentId, runId, actionId, decision.action, policy === "read" ? undefined : state.world.version));
+      if (result.stale === true) {
+        await step.run(`defer-stale-action-${cycle}`, () => setRun(runId, "deferred", "State changed before the action; a new event will start a new run"));
+        return;
+      }
       await step.run(`settle-status-${cycle}`, () => setRun(runId, "waiting", "Waiting briefly before observing tool effects"));
       await step.sleep(`settle-${cycle}`, "2s");
     }
```

### Edit 3 · `server/lab-data.ts`

Lock the environment row and compare the saved version before a mutating effect.

```diff
 
 export async function applyAction(environmentId: string, actionId: string, name: ActionName, input: Record<string, unknown> = {}) {
   return db.transaction(async (tx) => {
-    const [environment] = await tx.select().from(environments).where(eq(environments.id, environmentId)).limit(1);
+    const [environment] = await tx.select().from(environments).where(eq(environments.id, environmentId)).limit(1).for("update");
     if (!environment) throw new Error("Environment not found");
+    if ((name === "disable_feature" || name === "rollback_release") && environment.version !== input.expectedVersion) {
+      return { stale: true, currentVersion: environment.version };
+    }
     const state = { ...environment.state };
     let result: Record<string, unknown>;
     switch (name) {
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Send a Feature rollout event and confirm normal read-only inspections still work. Then call the operations API with an old expectedVersion for disable_feature; it should return stale and leave the saved state unchanged. A fresh event starts a new run that reads the current version.

## Break it on purpose

Save a state, record its version, save another state, and attempt the write using the old version. Discuss why a harness-only recheck would still have a race before the operation commits.

## Engineering challenge

Design a burst policy for ten events in one second. Compare one run per event, deduplication, and coalescing. What evidence or work could each policy lose? Then specify an idempotency or compare-and-swap rule that prevents two runs from applying contradictory changes.

## Catch up

Your solution is `lesson-4`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 3 progress"`, then `git switch lesson-4`. A branch switch changes code, not PostgreSQL or Inngest history; save a fresh state and emit a new event for the next drill.

**Common mistake:** Inngest concurrency limits executing steps, not the number of runs waiting or queued. The version check must live with the effect, under the same database lock. Do not treat event payload data as a snapshot of the current world.

**Optional extension:** What should happen if only a harmless field changes between observation and action? Propose a narrower precondition without silently widening approval scope.

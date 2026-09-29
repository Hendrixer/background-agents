# 03 · Wait for the world

Start: `lesson-3` · Finished solution: `lesson-4`

**Outcome:** An unresolved incident pauses for a new service event and resumes with a fresh observation.

## The engineering idea

The world does not wait for an agent's loop. A dependency may recover while the agent is idle, and several alerts may describe the same outage. I think of each event as a **doorbell**, not as the room itself. The checkout process publishes a signal. The operator API persists it and assigns it to the current incident. The agent wakes and reads checkout again; it does not accept the event payload as a certified snapshot.

We chose one active run per checkout service instance. The first degraded alert opens it, later alerts join it, and a recovery event wakes it. This is an application-level correlation rule, not an LLM judgment and not a setting that Inngest can infer for us. With one service, it is easy to explain. With multiple regions or overlapping failures, a single active run might merge unrelated incidents; a run per event would instead duplicate investigation and perhaps compete over effects. A production system needs a stable incident key or explicit correlation policy. [Inngest's concurrency reference](https://www.inngest.com/docs/reference/typescript/v4/functions/concurrency) controls step execution, not the semantic meaning of an incident.

The model may choose `wait` when no local action is justified. That choice does not end the run. The harness persists a waiting status and registers a durable `waitForEvent` for an update to this incident. Notifications can race wait registration, so we also compare a persisted `eventSequence` and periodically recheck it. A timeout here is a reconciliation tick, not a model decision. After a wake, we create a **new observation step**; the earlier observation remains part of history but is no longer current. [Inngest's wait-for-event documentation](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event) describes correlation and timeout behavior.

This architecture lets the dependency fault be honest. We cannot repair the gateway by rolling back our own release. The agent can wait for a service-owned recovery signal, then check health. The condition `health.status = healthy` is evaluated from a fresh observation. A model-selected `complete` cannot override it. That predicate is intentionally simple for class; a real recovery gate might need a time window, multiple telemetry sources, and a confidence policy for noisy metrics.

There is also a producer failure window. Our checkout process retries an alert while it stays alive, but its queue is in memory. If it crashes after changing state and before sending the event, the agent may never wake. A transactional outbox and periodic reconciliation can close that gap in a real service. Duplicate delivery is handled separately with a stable event ID. These are engineering contracts, not prompt instructions.

When checkout restarts, it gets a new instance ID and new state. We supersede unfinished runs and pending approvals from the old instance. Otherwise an approval based on the old world could authorize a change in a new one. In the workshop this makes the lifecycle boundary visible. In production I would define restart and failover semantics based on actual service identity, not only process identity.

## See it in the lab

Start checkout with `--fault dependency --recover-after-ms 30000`. The current checkpoint escalates when the model selects `wait`. An external dependency can recover after the first alert; this incident should remain alive to observe that change.

## Live coding

Replace the temporary wait branch in `server/agent-workflow.ts` with `setRun(waiting)`, a correlated `waitForEvent`, and an event-sequence recheck. A timeout also reconciles an event that arrived just before the wait registration.

These code blocks show the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Replace the temporary escalation with an event-correlated wait and sequence reconciliation.

```diff
       await step.run(`record-decision-${cycle}`, () => recordDecision(environmentId, runId, cycle, decision.action, decision.reason));

       if (decision.action === "wait" || (decision.action === "complete" && run.goalCondition)) {
-        await step.run("wait-unavailable-" + cycle, () => setRun(runId, "escalated", "Event wait is not built yet"));
-        return;
+        if (decision.action === "complete") {
+          await step.run(`reject-completion-${cycle}`, () => logAgentActivity(environmentId, runId, "human", "Completion blocked by configured goal condition", { condition: run.goalCondition }));
+        }
+        await step.run(`wait-status-${cycle}`, () => setRun(runId, "waiting", decision.action === "wait" ? decision.reason : "Recovery is not verified"));
+        let check = 0;
+        while (true) {
+          const latest = await step.run(`read-event-sequence-${cycle}-${check}`, () => getRun(runId));
+          if (["cancelled", "superseded", "failed"].includes(latest.status)) return;
+          if (latest.eventSequence > state.eventSequence) break;
+          check++;
+          await step.waitForEvent(`wait-for-service-${cycle}-${check}`, {
+            event: "incident/updated",
+            if: `async.data.runId == "${runId}"`,
+            timeout: "10s",
+          });
+          // The timeout also reconciles an event that arrived just before the wait.
+        }
+        continue;
       }
       if (decision.action === "complete") {
         const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state));
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Start a dependency fault with delayed recovery. The same run ID should wait, receive `health.recovered`, re-observe checkout, and complete. Send multiple alerts with `--alerts 3`; they should attach to one incident, not create three runs.

## Break it on purpose

Run `--recover-after-ms 0` and watch the run remain waiting. Restart checkout healthy: the old run is superseded because the service instance changed. Why is reusing its approval or observation unsafe?

## Engineering challenge

Compare one-run-per-event, one-run-per-service, and explicit incident IDs. What can each policy merge incorrectly, and what work can each duplicate? Design the reconciliation rule for an event arriving just before a durable wait.

## Catch up

Your solution is `lesson-4`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 3 progress"`, then `git switch lesson-4`. A branch switch changes code, not PostgreSQL, checkout process state, or Inngest history. Restart checkout with a fresh fault flag for the next drill.

**Common mistake:** A notification is not a state snapshot. The wake event only tells the agent to observe again; it must not treat the payload as proof of recovery.

**Optional extension:** Specify an incident key for two services or regions; decide whether a recovery event for one region should wake the other.

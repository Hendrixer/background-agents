# 05 · Make retries safe

Start: `lesson-5` · Finished solution: `lesson-6`

**Outcome:** A stable action ID lets an uncertain tool call retry without repeating its effect.

## The engineering idea

Retries sound easy until failure lands between an effect and its acknowledgement. Suppose checkout disables a feature, changes its state, and the HTTP response disappears. The agent sees a 503. It cannot conclude that the action failed. Repeating a request with a new identity could duplicate a charge, email, deployment, or ticket in a real system.

Durable execution saves successful step results. It cannot save a result the workflow never received. The effect-owning checkout service therefore remembers each `actionId` and its result. A retry with that same ID and arguments returns the saved result without applying the operation again; reusing the ID for different arguments is rejected. [Inngest's retry guide](https://www.inngest.com/docs/guides/error-handling) explains the retry behavior, while the [AWS Builders Library discussion of idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) explains why an intent key is different from merely comparing request parameters.

In the previous checkpoint, the action ID is generated anew while the workflow reconstructs after a failed step. In this lesson we derive it from the run, cycle, and selected action. The model choice was checkpointed, so the same decision reconstructs the same intent key. `--lose-next-action-response` commits once and responds 503. On the start branch, a new ID on retry receives a stale-version response. That prevents a second write here, but does not tell the harness whether its first request caused the change. With the stable ID, checkout returns the original result and the run records its effect. The service's operation ledger is in memory because the synthetic service resets at restart; in production it must survive process failure at the effect boundary.

There is a second guard: the agent sends the version it observed with a mutating action. Checkout rejects a stale version at the same place it changes state. A harness-only recheck would still leave a race before the request commits. Approval narrows authority further: after a human response, the harness re-observes and compares the approved version before calling the service. The service's own check remains the final boundary.

Cancellation is not compensation. The operator can stop a waiting incident, and Inngest can prevent future steps through `cancelOn`, but an operation already committed remains visible. [Inngest's cancellation reference](https://www.inngest.com/docs/reference/typescript/functions/cancel-on) describes this between-step behavior. For high-impact effects, the operator needs an effect ledger and perhaps an explicit compensation workflow.

The deeper design question is how to represent **unknown outcome**. Our local service can answer a repeated ID reliably while it is alive. An external provider may lack idempotency keys or status lookup. In that case, I would persist the uncertainty and stop the agent from guessing; a reconciliation query or human investigation must establish what happened before the agent retries or compensates. A stronger prompt cannot create evidence the system does not have.

## See it in the lab

Start checkout with `--fault feature --lose-next-action-response`. The operation commits, then returns 503. In the current branch each attempt gets a new ID, so the service cannot recognize that it is the same intent.

## Live coding

In `server/agent-workflow.ts`, replace the attempt-local UUID with an ID derived from run, cycle, and action. Add run-scoped Inngest cancellation. The supplied checkout service already stores each ID and result at the effect boundary.

These code blocks show the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Remove the attempt-local UUID import.

```diff
-import { randomUUID } from "node:crypto";
 import { agentState, getProposal, getRun, goalSatisfied, proposeAction, recordDecision, recordToolAction, setIteration, setRun, staleProposal } from "./agent-data";
 import { chooseAction, writeReport } from "./agent-brain";
 import { inngest } from "./inngest";
```

### Edit 2 · `server/agent-workflow.ts`

Add cancellation to the Inngest function options.

```diff
     name: "Checkout incident agent",
     triggers: { event: "incident/opened" },
     retries: 2,
+    cancelOn: [{ event: "agent/run.cancelled", match: "data.runId" }],
     // This limits executing steps, not the number of waiting incidents.
     concurrency: { limit: 1, key: "event.data.environmentId" },
     onFailure: async ({ error, event }) => {
```

### Edit 3 · `server/agent-workflow.ts`

Derive one stable ID from the run, decision cycle, and selected action.

```diff
         await step.run(`help-unavailable-${cycle}`, () => setRun(runId, "escalated", "Human help path is not built yet"));
         return;
       }
-      // An attempt-local ID is intentionally unsafe when a response is lost.
-      const actionId = randomUUID();
+      const actionId = `${runId}:${cycle}:${decision.action}`;
       const policy = actionPolicy[decision.action];
       if (policy === "approval") {
         const input = { expectedVersion: state.world.version };
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

With the lost-response flag, Activity should show a failed attempt followed by a retry using the same ID. The service returns the recorded result, Neon records the action, and the run completes. On the start branch, the retry gets a stale-version result instead: health may recover, but the harness cannot prove that its original action committed. Cancel a waiting run and confirm later steps stop while prior effects remain visible.

## Break it on purpose

Compare the start and solution branches after the lost response. Both may show healthy checkout because the version fence prevents a second write. Only the stable-ID branch can recover the original operation result and record it as this run's effect. Reusing the same ID with different arguments must be rejected.

## Engineering challenge

Design a persisted `unknown outcome` state for an external tool timeout. What must the harness prove before retrying or compensating? What can cancellation stop once an operation is already in flight?

## Catch up

Your solution is `lesson-6`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 5 progress"`, then `git switch lesson-6`. A branch switch changes code, not PostgreSQL, checkout process state, or Inngest history. Restart checkout with a fresh fault flag for the next drill.

**Common mistake:** The ID identifies one intent, not one HTTP attempt. Inngest checkpointing cannot infer whether an unacknowledged external effect committed.

**Optional extension:** Map the action ID to a payment or deployment API's idempotency key. If the provider lacks one, describe a reconciliation query before retry.

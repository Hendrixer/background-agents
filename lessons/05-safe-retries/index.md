# 05 · Make retries safe

Start: `lesson-5` · Finished solution: `lesson-6`

**Outcome:** A lost tool response can be retried with the same action ID without repeating the effect.

## The engineering idea

Retries sound easy until the failure lands between an effect and its acknowledgement. Suppose the operations API disables a feature, commits the database transaction, and its HTTP response disappears. The agent sees a 503. It cannot conclude that the action did not happen. Retrying is reasonable, but a second execution could create a second charge, email, deployment, or support ticket in a real product.

Durable execution saves successful step results. It cannot save a result it never received. The service that owns the side effect must therefore recognize repeated requests. We already send an `actionId` derived from the run and decision. Now the operations API will store that ID and the result in the same transaction as the effect. If a request arrives with the same ID, it returns the recorded result without applying the action again. This is application-level idempotency at the effect boundary. [Inngest's retry guide](https://www.inngest.com/docs/guides/error-handling) explicitly pairs step retries with idempotent side effects.

The **Lose the next tool response** button creates the exact uncertainty window: the operation commits, then the API responds with 503 once. Watch the Inngest trace retry `execute-action-*`. Before our edit, the operations API creates a new action row on each request. After the edit, the second request sees the prior ID and result. The visible outcome may look the same for `disable_feature`, since setting a flag to false twice is harmless. The action history proves whether we actually prevented duplicate execution.

We will also add cancellation. A background run has a lifecycle after the person who started it leaves; someone must still be able to stop it. Inngest's `cancelOn` event correlates cancellation to the run, and our harness checks persisted run status at a loop boundary. [The Inngest cancellation reference](https://www.inngest.com/docs/reference/typescript/functions/cancel-on) notes that cancellation occurs between steps, so an in-flight step can finish. Cancellation is a clear state transition, not a magic rollback of completed external work.

My rule for unattended agents is to make the failure modes visible. Show the retry, its stable action ID, the one committed effect, and the final run state. A successful happy-path demo is much less persuasive than a run that survives a failure we deliberately caused.

### A retry is a request for the same intent

The [AWS Builders Library explanation of idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) makes a distinction I want us to use: two requests with the same parameters are not necessarily the same *intent*. A customer might deliberately place two identical orders. A stable client-generated request ID lets the service tell an intended retry from a new operation. Our `actionId` is that intent key. It must stay the same across transport attempts. The operations API checks that a reused key has the same environment, action name, and input. If the request fingerprint differs, it rejects the reuse rather than returning an old result for a different command.

The transaction boundary matters. If we record the key before the effect and crash, we may falsely claim success. If we apply the effect and record the key in separate transactions, a crash between them can repeat the effect. In the lab, the action row and service change belong to one database transaction. That gives us a concrete guarantee for our own database. It does not create an atomic transaction with an external payment or deployment provider. For that case, I need the provider's idempotency facility, a query to reconcile an uncertain result, or an explicit `unknown` state that stops the agent from guessing.

### Separate failure policy from model choice

When `execute-action-*` gets a transient error, the harness decides whether to retry and how long to back off. I do not need a model call to choose every retry delay. [Inngest's error-handling guide](https://www.inngest.com/docs/guides/error-handling) describes step retries and failure behavior. A production policy also needs a deadline or retry budget: otherwise a run can be technically alive while failing the user indefinitely. The agent can decide what to do after a *known* failure; the harness must first classify whether the effect is known to have failed, known to have succeeded, or still unknown.

Cancellation has the same boundary. A cancellation event can prevent future steps, but it cannot undo an action already committed. I would show the operator a cancelled run with its completed effects and any compensation still needed. This is why a run timeline and effect ledger are more useful than one final status word. The question for this lesson is not “did the retry work?” It is “what can we prove happened exactly once at the effect boundary, and what remains uncertain?”

## See it in the lab

Load Feature rollout, save state, arm the lost-response fault, and emit one event. The first operation commits but replies 503. The model cannot infer whether the effect happened. We will make the effect-owning service return the saved result for the same action ID.

## Live coding

Add the two cancellation checks in server/agent-workflow.ts. In server/lab-data.ts, first return a prior result for the same action ID, then make the insert use that ID and handle a concurrent duplicate. Keep the state change and action ledger in one database transaction.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Register a cancellation event scoped to this run ID.

```diff
     name: "Event-triggered background agent",
     triggers: { event: "service/event.received" },
     retries: 2,
+    cancelOn: [{ event: "agent/run.cancelled", match: "data.eventId" }],
     // Separate events create separate runs. Only one step per environment executes
     // at a time; a waiting human approval does not block later runs.
     concurrency: { limit: 1, key: "event.data.environmentId" },
```

### Edit 2 · `server/agent-workflow.ts`

Check persisted cancellation before another cycle starts.

```diff
     if (["completed", "failed", "cancelled", "escalated", "deferred"].includes(run.status)) return;
 
     for (let cycle = 1; cycle <= 8; cycle++) {
+      if ((await getRun(runId)).status === "cancelled") return;
       const state = await step.run(`observe-state-${cycle}`, () => agentState(environmentId, runId));
 
       if (goalSatisfied(state, run.goalCondition)) {
```

### Edit 3 · `server/lab-data.ts`

Return the previously committed result for the same action ID, and reject a mismatched reuse.

```diff
 }
 
 export async function applyAction(environmentId: string, actionId: string, name: ActionName, input: Record<string, unknown> = {}) {
+  const [prior] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
+  if (prior) {
+    if (prior.environmentId !== environmentId || prior.name !== name || JSON.stringify(prior.input) !== JSON.stringify(input)) throw new Error("Action ID conflict");
+    return prior.result;
+  }
+
   return db.transaction(async (tx) => {
     const [environment] = await tx.select().from(environments).where(eq(environments.id, environmentId)).limit(1).for("update");
     if (!environment) throw new Error("Environment not found");
```

### Edit 4 · `server/lab-data.ts`

Insert the caller's action ID atomically with the effect; a concurrent duplicate reads the winner's result.

```diff
         throw new Error(`Action ${name} is a harness terminal action, not a service operation`);
     }
 
-    await tx.insert(actions).values({ id: randomUUID(), environmentId, name, input, result });
+    const [inserted] = await tx.insert(actions).values({ id: actionId, environmentId: environmentId, name, input, result }).onConflictDoNothing().returning();
+    if (!inserted) {
+      const [existing] = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
+      if (!existing || existing.environmentId !== environmentId || existing.name !== name || JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error("Action ID conflict");
+      return existing.result;
+    }
     if (name === "disable_feature" || name === "rollback_release") {
       await tx.update(environments).set({ state, version: sql`${environments.version} + 1` }).where(eq(environments.id, environmentId));
     }
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Arm the fault and emit one Feature rollout event. Activity should show an attempt failure and a later successful response. The matching action ID appears once in the actions table. Cancel a waiting run from Activity and confirm future steps stop, while prior effects remain visible.

## Break it on purpose

Compare the action ledger on lesson-5 and lesson-6 after the lost-response drill. Before the edit, retries create multiple rows with different server IDs. After it, one stable caller ID owns the result.

## Engineering challenge

Design a persisted unknown outcome for an external tool that times out after a possible commit. What reconciliation query would you run before retrying? What can cancellation prevent, and which completed effects require compensation?

## Catch up

Your solution is `lesson-6`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 5 progress"`, then `git switch lesson-6`. A branch switch changes code, not PostgreSQL or Inngest history; save a fresh state and emit a new event for the next drill.

**Common mistake:** The stable ID must identify one intent, not one HTTP attempt. A client-side flag disappears on restart. Reusing a key with a different action or input must be rejected.

**Optional extension:** Map the action ID to a third-party API's idempotency key, then explain what to do when the provider has no such facility.

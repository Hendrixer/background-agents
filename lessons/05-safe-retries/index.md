# 05 · Make retries safe

Start: `lesson-5` · Finished solution: `lesson-6`

**Outcome:** A tool response can disappear after its effect commits; the same action ID must return the prior result instead of repeating the effect.

## The engineering idea

Retries sound easy until the failure lands between an effect and its acknowledgement. Suppose the operations API disables a feature, commits the database transaction, and its HTTP response disappears. The agent sees a 503. It cannot conclude that the action did not happen. Retrying is reasonable, but a second execution could create a second charge, email, deployment, or support ticket in a real product.

Durable execution saves successful step results. It cannot save a result it never received. The service that owns the side effect must therefore recognize repeated requests. We already send an `actionId` derived from the run and decision. Now the operations API will store that ID and the result in the same transaction as the effect. If a request arrives with the same ID, it returns the recorded result without applying the action again. This is application-level idempotency at the effect boundary. [Inngest's retry guide](https://www.inngest.com/docs/guides/error-handling) explicitly pairs step retries with idempotent side effects.

The **Lose the next tool response** button creates the exact uncertainty window: the operation commits, then the API responds with 503 once. Watch the Inngest trace retry `execute-action-*`. Before our edit, the lab creates a new action row on each request. After the edit, the second request sees the prior ID and result. The visible outcome may look the same for `disable_feature`, since setting a flag to false twice is harmless. The action history proves whether we actually prevented duplicate execution.

We will also add cancellation. A background run has a lifecycle after the person who started it leaves; someone must still be able to stop it. Inngest's `cancelOn` event correlates cancellation to the run, and our harness checks persisted run status at a loop boundary. [The Inngest cancellation reference](https://www.inngest.com/docs/reference/typescript/functions/cancel-on) notes that cancellation occurs between steps, so an in-flight step can finish. Cancellation is a clear state transition, not a magic rollback of completed external work.

My rule for unattended agents is to make the failure modes visible. Show the retry, its stable action ID, the one committed effect, and the final run state. A successful happy-path demo is much less persuasive than a run that survives a failure we deliberately caused.

### A retry is a request for the same intent

The [AWS Builders Library explanation of idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) makes a distinction I want us to use: two requests with the same parameters are not necessarily the same *intent*. A customer might deliberately place two identical orders. A stable client-generated request ID lets the service tell an intended retry from a new operation. Our `actionId` is that intent key. It must stay the same across transport attempts, and a service should reject a reused key if its action or arguments conflict with the original request.

The transaction boundary matters. If we record the key before the effect and crash, we may falsely claim success. If we apply the effect and record the key in separate transactions, a crash between them can repeat the effect. In the lab, the action row and service change belong to one database transaction. That gives us a concrete guarantee for our own database. It does not create an atomic transaction with an external payment or deployment provider. For that case, I need the provider's idempotency facility, a query to reconcile an uncertain result, or an explicit `unknown` state that stops the agent from guessing.

### Separate failure policy from model choice

When `execute-action-*` gets a transient error, the harness decides whether to retry and how long to back off. I do not need a model call to choose every retry delay. [Inngest's error-handling guide](https://www.inngest.com/docs/guides/error-handling) describes step retries and failure behavior. A production policy also needs a deadline or retry budget: otherwise a run can be technically alive while failing the user indefinitely. The agent can decide what to do after a *known* failure; the harness must first classify whether the effect is known to have failed, known to have succeeded, or still unknown.

Cancellation has the same boundary. A cancellation event can prevent future steps, but it cannot undo an action already committed. I would show the operator a cancelled run with its completed effects and any compensation still needed. This is why a run timeline and effect ledger are more useful than one final status word. The question for this lesson is not “did the retry work?” It is “what can we prove happened exactly once at the effect boundary, and what remains uncertain?”

## See it in the lab

Reset **Feature rollout**, arm **Lose the next tool response**, and start health and log events. The first tool call commits but returns 503. Keep the operations timeline open: the state of the world and the response seen by the agent are now different.

## Live coding

Make the two focused edits in `server/agent-workflow.ts`, then the two edits inside `applyAction` in `server/lab-data.ts`. The rest of the simulator code is supplied. The ID already passed from the workflow is `runId:iteration:action`.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Register a cancellation event that must match this run ID. Inngest can stop a sleeping run at a step boundary.

```diff
     name: "Incident response agent",
     triggers: { event: "lab/run.started" },
     retries: 2,
+    cancelOn: [{ event: "lab/run.cancelled", match: "data.runId" }],
     onFailure: async ({ error, event }) => {
       const original = event.data.event as { data?: { runId?: string } };
       if (original.data?.runId) await setRun(original.data.runId, "failed", error.message);
```

### Edit 2 · `server/agent-workflow.ts`

Read the persisted run status before the next cycle does work. This makes the application state agree with cancellation.

```diff
     while (decisions < 12) {
       cycle += 1;
       const currentLab = await activeLab();
+      const currentRun = await getRun(runId);
+      if (currentRun.status === "cancelled") return;
       if (currentLab?.id !== labId) {
         await step.run(`scenario-reset-${cycle}`, () => setRun(runId, "cancelled", "Scenario was reset"));
         return;
```

### Edit 3 · `server/lab-data.ts`

At the start of `applyAction`, return a saved result when the same action ID has already committed.

```diff
 }
 
 export async function applyAction(labId: string, actionId: string, name: ActionName, input: Record<string, unknown> = {}) {
+  const [prior] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
+  if (prior) {
+    if (prior.labId !== labId) throw new Error("Action ID belongs to a different lab instance");
+    return prior.result;
+  }
+
   return db.transaction(async (tx) => {
     const [lab] = await tx.select().from(labs).where(eq(labs.id, labId)).limit(1);
     if (!lab) throw new Error("Lab instance not found");
```

### Edit 4 · `server/lab-data.ts`

Store the caller-provided action ID instead of a fresh UUID. If another request wins the insert, read and return its result without applying the effect again.

```diff
         break;
     }
 
-    await tx.insert(actions).values({ id: randomUUID(), labId, name, input, result });
+    const [inserted] = await tx.insert(actions).values({ id: actionId, labId, name, input, result }).onConflictDoNothing().returning();
+    if (!inserted) {
+      const [existing] = await tx.select().from(actions).where(eq(actions.id, actionId)).limit(1);
+      if (!existing || existing.labId !== labId) throw new Error("Action ID conflict");
+      return existing.result;
+    }
 
     if (name === "disable_feature") await tx.update(labs).set({ featureEnabled: false }).where(eq(labs.id, labId));
     if (name === "rollback_release") await tx.update(labs).set({ release: "v1-stable" }).where(eq(labs.id, labId));
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Arm the failure and run Feature rollout. In the trace, `execute-action-*` retries. In the dashboard timeline and `actions` table, the matching action ID appears once. Use Cancel run while a workflow waits and confirm it stops.

## Break it on purpose

Before adding the `applyAction` edits, the retry inserts a second action row because the server makes a new UUID. After the edits, the first response can still be lost, but the second request returns the saved result. Reset the scenario between the two runs.

## Engineering challenge

Imagine `executeAction` calls an external provider that ignores idempotency keys. A timeout leaves the outcome unknown. Design a reconciliation query, a persisted `unknown` state, and a policy for when the agent may retry or must ask a human. Explain why a local transaction cannot make a remote side effect atomic with our database. Finally, cancel a waiting run and identify which completed effects remain and which future steps stop.

## Catch up

Your solution is `lesson-6`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 5 progress"`, then `git switch lesson-6`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** Idempotency must live where the effect happens. A client-side “already called” flag disappears on restart. Keep the same `actionId` across retries; a new UUID for each attempt defeats the table constraint.

**Optional extension:** Consider how you would carry this key through a third-party API that supports an idempotency header.

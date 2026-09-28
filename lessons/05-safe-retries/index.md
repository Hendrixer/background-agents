# 05 · Make retries safe

**14:15–15:00 · 45 minutes**  
Start: `lesson-5` · Finished solution: `lesson-6`

**Outcome:** A tool response can disappear after its effect commits; the same action ID must return the prior result instead of repeating the effect.

## Open and predict

Reset **Feature rollout**, arm **Lose the next tool response**, start health/log events, then start an agent. The first call returns 503 after the database commit. Ask: “Did the action happen, and how can the retry find out?”

Instructor cue: spend about 8 minutes on the idea, 5 minutes on this demo and prediction, 25 minutes coding, and 7 minutes verifying. Leave the scheduled catch-up break intact.

## The idea

Inngest checkpoints after `step.run` returns. Between the external effect and that checkpoint is an uncertainty window. The operations API owns idempotency using a stable action ID inside a database transaction. Cancellation is another durable event and the loop also reads the run status at a safe boundary.

## Live coding

Make the two focused edits in `server/agent-workflow.ts`, then the two edits inside `applyAction` in `server/lab-data.ts`. The rest of the simulator code is supplied. The ID already passed from the workflow is `runId:iteration:action`.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

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

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

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

Open `server/lab-data.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

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

Open `server/lab-data.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

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

## Failure experiment

Before adding the `applyAction` edits, the retry inserts a second action row because the server makes a new UUID. After the edits, the first response can still be lost, but the second request returns the saved result. Reset the scenario between the two runs.

## Catch-up checkpoint

Your solution is `lesson-6`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 5 progress"`, then `git switch lesson-6`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** Idempotency must live where the effect happens. A client-side “already called” flag disappears on restart. Keep the same `actionId` across retries; a new UUID for each attempt defeats the table constraint.

**Optional extension:** Consider how you would carry this key through a third-party API that supports an idempotency header.

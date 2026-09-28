# 06 · Run an incident drill

**15:15–16:00 · 45 minutes**  
Start: `lesson-6` · Finished solution: `complete`

**Outcome:** The agent asks for help when its tools cannot fix an external dependency, then waits for a recovery signal and reports the outcome.

## Open and predict

Reset **Upstream outage** and start health, log, and dependency events. Ask: “Would another local rollback change the payment gateway?” The agent needs a human answer and a new external state, not more local tool calls.

Instructor cue: spend about 8 minutes on the idea, 5 minutes on this demo and prediction, 25 minutes coding, and 7 minutes verifying. Leave the scheduled catch-up break intact.

## The idea

`request_help` is a model-selected action that the harness turns into a nonterminal human gate. Once answered, the run waits for the dependency to recover. It does not treat an answer as proof of service health. A fresh observation and the deterministic recovery predicate still decide completion.

## Live coding

In `server/agent-workflow.ts`, add the external-wait branch before `chooseAction`, then let `request_help` share the persisted proposal path. The rollback recheck still applies only to rollback.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
         continue;
       }
 
+      const unresolvedHelp = state.humanDecisions.some((item) => item.action === "request_help" && item.status === "approved");
+      if (!state.service.upstreamHealthy && unresolvedHelp) {
+        await step.run(`wait-upstream-status-${cycle}`, () => setRun(runId, "waiting", "Waiting for the external dependency to recover"));
+        await step.waitForEvent(`wait-for-upstream-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
+        continue;
+      }
+
       const decision = await step.run(`choose-action-${cycle}`, () => chooseAction(run.goal, state));
       decisions += 1;
       const iteration = decisions;
```

### Edit 2 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
       }
 
       const actionId = `${runId}:${iteration}:${decision.action}`;
-      if (decision.action === "rollback_release") {
-        const input = { expectedRelease: state.service.release };
+      if (decision.action === "rollback_release" || decision.action === "request_help") {
+        const input = decision.action === "rollback_release" ? { expectedRelease: state.service.release } : { question: decision.detail };
         const proposalId = await step.run(`propose-action-${cycle}`, async () => {
           const proposal = await proposeAction(labId, runId, actionId, decision.action, input);
           return proposal.id;
```

### Edit 3 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
           return;
         }
         if (approval.status !== "approved") continue;
+        if (decision.action === "request_help") continue;
 
         const fresh = await step.run(`recheck-rollback-${cycle}`, () => agentState(labId));
         if (fresh.service.release !== input.expectedRelease) {
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Start the Upstream outage run. Answer the agent in the UI, then click **Simulate upstream recovery**. It should wait until fresh healthy observations arrive, complete, and produce an incident report. Read the Inngest trace and timeline aloud to reconstruct the run.

## Failure experiment

Answer the help request but do not recover the dependency. The run should remain waiting through multiple timeouts. Then recover it; no second help proposal or local rollback should be needed. Reset and try `Cannot help` to see escalation.

## Catch-up checkpoint

Your solution is `complete`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 6 progress"`, then `git switch complete`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** If the model keeps asking for help, confirm the saved human decision is `approved` and inspect `agentState.humanDecisions`. If the service is healthy but completion has not happened, ensure health events continue long enough for three fresh samples.

**Optional extension:** Have students propose one different terminal policy, such as an explicit unresolved report after a configured deadline, and identify which part belongs to the model versus the harness.

# 04 · Put a human in control

**13:15–14:00 · 45 minutes**  
Start: `lesson-4` · Finished solution: `lesson-5`

**Outcome:** A model can propose a rollback, but only an explicit human decision can authorize it.

## Open and predict

Reset **Faulty release** and start health/log events at **1/sec**. Show that the model can select `rollback_release` on the current branch. Ask who must own permission for that action.

Instructor cue: spend about 8 minutes on the idea, 5 minutes on this demo and prediction, 25 minutes coding, and 7 minutes verifying. Leave the scheduled catch-up break intact.

## The idea

An approval is a persisted proposal with exact input and an expiry. The workflow waits for the decision event, reads the saved decision after wakeup, and rechecks the release before acting. If the condition changed, old approval is stale. Rejection and expiry are terminal escalations, not silent retries.

## Live coding

In `server/agent-workflow.ts`, add the imports and the rollback gate immediately after `actionId` is computed. The final `execute-action` call must remain below the gate.

These code blocks are the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed. Keep the unchanged context visible while typing.

### Edit 1 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
 import { activeLab, addTimeline } from "./lab-data";
-import { agentState, getRun, hasRecovered, recordDecision, setIteration, setRun } from "./agent-data";
+import { agentState, getProposal, getRun, hasRecovered, proposeAction, recordDecision, setIteration, setRun, staleProposal } from "./agent-data";
 import { chooseAction, writeReport } from "./agent-brain";
 import { inngest } from "./inngest";
 
```

### Edit 2 · `server/agent-workflow.ts`

Open `server/agent-workflow.ts` and find the surrounding function or configuration shown in this block. Apply this hunk before the next edit.

```diff
       }
 
       const actionId = `${runId}:${iteration}:${decision.action}`;
+      if (decision.action === "rollback_release") {
+        const input = { expectedRelease: state.service.release };
+        const proposalId = await step.run(`propose-action-${cycle}`, async () => {
+          const proposal = await proposeAction(labId, runId, actionId, decision.action, input);
+          return proposal.id;
+        });
+
+        let approval = await step.run(`read-approval-${cycle}`, () => getProposal(proposalId));
+        let approvalCheck = 0;
+        while (approval.status === "pending") {
+          approvalCheck += 1;
+          await step.waitForEvent(`wait-for-approval-${cycle}-${approvalCheck}`, { event: "lab/approval.decided", if: `async.data.proposalId == "${proposalId}"`, timeout: "10s" });
+          approval = await step.run(`reconcile-approval-${cycle}-${approvalCheck}`, () => getProposal(proposalId));
+        }
+
+        if (approval.status === "rejected" || approval.status === "expired") {
+          await step.run(`stop-after-human-decision-${cycle}`, () => setRun(runId, "escalated", `Human decision: ${approval.status}`));
+          return;
+        }
+        if (approval.status !== "approved") continue;
+
+        const fresh = await step.run(`recheck-rollback-${cycle}`, () => agentState(labId));
+        if (fresh.service.release !== input.expectedRelease) {
+          await step.run(`invalidate-approval-${cycle}`, () => staleProposal(proposalId));
+          continue;
+        }
+      }
+
       await step.run(`execute-action-${cycle}`, () => executeAction(labId, actionId, decision.action));
       await step.run(`wait-status-after-action-${cycle}`, () => setRun(runId, "waiting", "Waiting for the service to report its new state"));
       await step.waitForEvent(`wait-after-action-${cycle}`, { event: "lab/observation", match: "data.labId", timeout: "10s" });
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Start an agent on Faulty release. It should reach `needs approval` without rolling back. Stop and restart only the agent endpoint, then approve in the UI. The rollback should happen once and the run should verify recovery. Reset and repeat with Reject to see `escalated`.

## Failure experiment

Leave a proposal pending while the agent process is down, approve, then restart it. The decision is in PostgreSQL and the wait reconciles even if the notification arrived before the endpoint was ready. For an expiry rehearsal, temporarily shorten the proposal expiry in `server/agent-data.ts` and reset afterward.

## Catch-up checkpoint

Your solution is `lesson-5`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 4 progress"`, then `git switch lesson-5`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** Do not approve a proposal from an older lab reset. The dashboard only shows the current lab; reset creates a new lab ID. If approval seems stuck, inspect the `wait-for-approval-*` trace and the saved proposal status.

**Optional extension:** Add a second gated action and decide whether it should require the same approval shape or a different one.

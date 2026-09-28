# 04 · Put a human in control

**13:15–14:00 · 45 minutes**  
Start: `lesson-4` · Finished solution: `lesson-5`

**Outcome:** A model can propose a rollback, but only an explicit human decision can authorize it.

## Open and predict

Reset **Faulty release** and start health/log events at **1/sec**. On this branch, the model can select `rollback_release` and the harness executes it directly. Who should have authority for that action, and what information would you want in your inbox before approving it?

## The idea

The model can notice that a release looks faulty. That is different from having authority to roll it back. I want the agent to do the investigation for me and then reach me at the point where my judgment matters. Human-in-the-loop is not a failure fallback bolted onto an autonomous system; for many useful agents, it is the intended middle of the workflow.

I think of the **agent inbox** as the place where unattended work reaches back to me. An inbox item should tell me what the agent wants to do, why, what exact state it expects, and when the request expires. I should be able to approve, reject, or give the agent information without holding a live chat open. The agent can wait while I am away, and I can respond when I have enough context. This is one reason I believe background agents can multiply productivity without asking us to give up control.

The sequence matters. First persist the proposal, including the expected release. Then wait for a decision event correlated to that proposal. After waking, read the stored decision because a notification might arrive early or be missed. If the person rejects or the proposal expires, the run escalates. If they approve, read the service again before executing: an approval for `v2-bad` should not authorize a rollback of some later release. [Inngest's HITL guide](https://www.inngest.com/docs/ai-patterns/human-in-the-loop) uses the same durable propose–wait–resume pattern and explains event correlation.

The model still chooses `rollback_release` as the next action. The harness turns that choice into a proposal rather than a tool call. That is the authority boundary. The model may be wrong about the diagnosis; the human may be wrong too; but the system now exposes the decision with context and an audit trail. Read-only inspections can proceed without approval, while disruptive actions stop at the gate.

We will test the part that is hardest to fake in a chat demo: stop the agent endpoint while the approval is pending, respond through the UI, and restart the endpoint. The proposal and decision live in PostgreSQL; the workflow history lives in Inngest. Neither depends on the original browser request still being open.

As you code, ask whether “approved” is enough by itself. The recheck answers no: authorization is for a particular action under particular conditions, not a blank check for any future state.

## Live coding

In `server/agent-workflow.ts`, add the imports and the rollback gate immediately after `actionId` is computed. The final `execute-action` call must remain below the gate.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Import the supplied proposal storage helpers. They persist the exact request and human decision in PostgreSQL.

```diff
 import { activeLab, addTimeline } from "./lab-data";
-import { agentState, getRun, hasRecovered, recordDecision, setIteration, setRun } from "./agent-data";
+import { agentState, getProposal, getRun, hasRecovered, proposeAction, recordDecision, setIteration, setRun, staleProposal } from "./agent-data";
 import { chooseAction, writeReport } from "./agent-brain";
 import { inngest } from "./inngest";
 
```

### Edit 2 · `server/agent-workflow.ts`

Insert the rollback gate after `actionId` is computed and before `execute-action`. Read the proposal after every wakeup, handle rejection or expiry, and recheck the release before executing.

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

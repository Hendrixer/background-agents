# 04 · Put a human in control

Start: `lesson-4` · Finished solution: `lesson-5`

**Outcome:** A model can propose a rollback, but only an explicit human decision can authorize it.

## The engineering idea

The model can notice that a release looks faulty. That is different from having authority to roll it back. I want the agent to do the investigation for me and then reach me at the point where my judgment matters. Human-in-the-loop is not a failure fallback bolted onto an autonomous system; for many useful agents, it is the intended middle of the workflow.

I think of the **agent inbox** as the place where unattended work reaches back to me. An inbox item should tell me what the agent wants to do, why, what exact state it expects, and when the request expires. I should be able to approve, reject, or give the agent information without holding a live chat open. The agent can wait while I am away, and I can respond when I have enough context. This is one reason I believe background agents can multiply productivity without asking us to give up control.

The sequence matters. First persist the proposal, including the expected release. Then wait for a decision event correlated to that proposal. After waking, read the stored decision because a notification might arrive early or be missed. If the person rejects or the proposal expires, the run escalates. If they approve, read the service again before executing: an approval for `v2-bad` should not authorize a rollback of some later release. [Inngest's HITL guide](https://www.inngest.com/docs/ai-patterns/human-in-the-loop) uses the same durable propose–wait–resume pattern and explains event correlation.

The model still chooses `rollback_release` as the next action. The harness turns that choice into a proposal rather than a tool call. That is the authority boundary. The model may be wrong about the diagnosis; the human may be wrong too; but the system now exposes the decision with context and an audit trail. Read-only inspections can proceed without approval, while disruptive actions stop at the gate.

We will test the part that is hardest to fake in a chat demo: stop the agent endpoint while the approval is pending, respond through the UI, and restart the endpoint. The proposal and decision live in PostgreSQL; the workflow history lives in Inngest. Neither depends on the original browser request still being open.

As you code, ask whether “approved” is enough by itself. The recheck answers no: authorization is for a particular action under particular conditions, not a blank check for any future state.

### Decide where human judgment adds value

I do not want a person approving every read-only log inspection. That would turn the inbox into noise. I do want a person involved when an action is disruptive, hard to reverse, expensive, or based on ambiguous evidence. [OpenAI's agent-building guide](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/) recommends intervention for high-risk actions and when an agent exceeds its failure limits. The design choice is not “autonomous or manual”; it is which decisions should be delegated, which should be reviewed, and which should be refused entirely.

A useful approval is a **scoped capability**: permission for this run, this action, against this expected release, before this expiry. The proposal is persisted so the human can answer after the original request is gone. Rechecking the release after approval closes a time-of-check/time-of-use gap. If the world changed, the old permission no longer describes the action about to happen. The inbox should show that invalidation clearly rather than quietly applying the rollback anyway.

Research on [human-AI delegation](https://arxiv.org/abs/2303.09224) studies the fact that the human and model can have different strengths, and that handing off the right cases matters to team performance. My engineering interpretation is that a human should receive a *decision packet*, not a vague “Approve?” button: the proposed action, evidence, expected state, possible impact, and a way to decline or supply more information. An approval prompt with no context invites rubber-stamping.

### Approval is not a universal safety shield

The model could arrive at its proposal after reading an untrusted log line. A human might still approve it if the interface hides that provenance. The [AgentDojo research environment](https://arxiv.org/abs/2406.13352) illustrates that malicious instructions can enter through normal tool results. For a real agent I would keep a narrow action catalog, label the source of evidence, and show why the agent requested the action. A prompt telling the model to ignore attacks is weaker than a harness that cannot execute an unauthorized tool.

Human availability is another design constraint. What happens when the person is asleep, rejects, or never responds? Here the proposal expires and the run escalates. In a product, the inbox would also need ownership, notifications, and escalation policy. We are not building all of that UI today; we are establishing the durable state transition that makes it possible. The same mechanics will later support asking for help, where the human contributes information rather than authorizing a risky effect.

## See it in the lab

On `/admin`, reset **Faulty release** and start health and log events at **1/sec**. On this branch, a selected rollback runs immediately. Inspect the release and the proposed action in the activity log on `/agent` before we add the inbox gate.

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
 import { logAgentActivity } from "./agent-log";
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
+        const fresh = await step.run(`recheck-rollback-${cycle}`, () => agentState(labId, runId));
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

Start an agent from `/agent` on Faulty release. It should reach `needs approval` without rolling back. Stop and restart only the agent endpoint, then approve in the inbox on `/`. The rollback should happen once and the run should verify recovery. Reset and repeat with Deny to see `escalated`.

## Break it on purpose

Leave a proposal pending while the agent process is down, approve, then restart it. The decision is in PostgreSQL and the wait reconciles even if the notification arrived before the endpoint was ready. For an expiry rehearsal, temporarily shorten the proposal expiry in `server/agent-data.ts` and reset afterward.

## Engineering challenge

Treat an approval as a capability with a scope and lifetime. Write down its subject, action, expected release, expiry, and evidence. Our code rechecks the release before rollback; identify one more precondition you would revalidate at execution time and one case where you would require a new approval. Then propose an inbox item that lets a busy engineer make the decision without reading the full trace. Test rejection and explain why an unanswered request must be a visible run state rather than a hung function.

## Catch up

Your solution is `lesson-5`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 4 progress"`, then `git switch lesson-5`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** Do not approve a proposal from an older lab reset. The inbox shows requests for the current lab; reset creates a new lab ID. If approval seems stuck, inspect the `wait-for-approval-*` trace and the saved proposal status.

**Optional extension:** Add a second gated action and decide whether it should require the same approval shape or a different one.

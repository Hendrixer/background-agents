# 04 · Put a human in control

Start: `lesson-4` · Finished solution: `lesson-5`

**Outcome:** A disruptive action becomes a persisted request that pauses and resumes the same run.

## The engineering idea

The model can notice that a release looks faulty. That is different from having authority to roll it back. I want the agent to do the investigation for me and then reach me at the point where my judgment matters. Human-in-the-loop is not a failure fallback bolted onto an autonomous system; for many useful agents, it is the intended middle of the workflow.

I think of the **agent inbox** as the place where unattended work reaches back to me. An inbox item should tell me what the agent wants to do, why, what exact state it expects, and when the request expires. I should be able to approve, reject, or give the agent information without holding a live chat open. The agent can wait while I am away, and I can respond when I have enough context. This is one reason I believe background agents can multiply productivity without asking us to give up control.

The sequence matters. First persist the proposal, including the state version the agent observed. Then wait for a decision event correlated to that proposal. After waking, read the stored decision because a notification might arrive early or be missed. If the person rejects or the proposal expires, the run escalates. If they approve, read the service again before executing: an approval based on version 4 should not authorize a rollback against version 5, even if a different field changed. [Inngest's HITL guide](https://www.inngest.com/docs/ai-patterns/human-in-the-loop) uses the same durable propose–wait–resume pattern and explains event correlation.

The model still chooses `rollback_release` as the next action. The harness turns that choice into a proposal rather than a tool call. That is the authority boundary. The model may be wrong about the diagnosis; the human may be wrong too; but the system now exposes the decision with context and an audit trail. Read-only inspections can proceed without approval, while disruptive actions stop at the gate.

We will test the part that is hardest to fake in a chat demo: stop the agent endpoint while the approval is pending, respond through the UI, and restart the endpoint. The proposal and decision live in PostgreSQL; the workflow history lives in Inngest. Neither depends on the original browser request still being open.

As you code, ask whether “approved” is enough by itself. The recheck answers no: authorization is for a particular action under particular conditions, not a blank check for any future state.

### Decide where human judgment adds value

I do not want a person approving every read-only log inspection. That would turn the inbox into noise. I do want a person involved when an action is disruptive, hard to reverse, expensive, or based on ambiguous evidence. [OpenAI's agent-building guide](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/) recommends intervention for high-risk actions and when an agent exceeds its failure limits. The design choice is not “autonomous or manual”; it is which decisions should be delegated, which should be reviewed, and which should be refused entirely.

A useful approval is a **scoped capability**: permission for this run, this action, against this expected state version, before this expiry. The proposal is persisted so the human can answer after the original request is gone. Rechecking the version after approval closes a time-of-check/time-of-use gap. If the world changed, the old permission no longer describes the action about to happen. The operations API checks that version again while applying the effect; a harness-only recheck would leave another race. The inbox should show invalidation clearly rather than quietly applying the rollback anyway.

Research on [human-AI delegation](https://arxiv.org/abs/2303.09224) studies the fact that the human and model can have different strengths, and that handing off the right cases matters to team performance. My engineering interpretation is that a human should receive a *decision packet*, not a vague “Approve?” button: the proposed action, evidence, expected state, possible impact, and a way to decline or supply more information. An approval prompt with no context invites rubber-stamping.

### Approval is not a universal safety shield

The model could arrive at its proposal after reading an untrusted log line. A human might still approve it if the interface hides that provenance. The [AgentDojo research environment](https://arxiv.org/abs/2406.13352) illustrates that malicious instructions can enter through normal tool results. For a real agent I would keep a narrow action catalog, label the source of evidence, and show why the agent requested the action. A prompt telling the model to ignore attacks is weaker than a harness that cannot execute an unauthorized tool.

Human availability is another design constraint. What happens when the person is asleep, rejects, or never responds? Here the proposal expires and the run escalates. In a product, the inbox would also need ownership, notifications, and escalation policy. We are not building all of that UI today; we are establishing the durable state transition that makes it possible. The same mechanics will later support asking for help, where the human contributes information rather than authorizing a risky effect.

## See it in the lab

Load the Faulty release shortcut, save its state, and emit a deployment event. On this branch the rollback is not yet gated. We will move the authority boundary: the model may propose rollback, but a person must authorize the exact action against the observed state version.

## Live coding

In server/agent-workflow.ts, import the supplied proposal helpers and insert the approval gate after actionId and policy are computed. Keep the execute-action step below the gate so an unapproved rollback cannot reach it.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Import the supplied proposal and decision helpers.

```diff
-import { agentState, getRun, goalSatisfied, recordDecision, setIteration, setRun, startRun } from "./agent-data";
+import { agentState, getProposal, getRun, goalSatisfied, proposeAction, recordDecision, setIteration, setRun, staleProposal, startRun } from "./agent-data";
 import { chooseAction, writeReport } from "./agent-brain";
 import { inngest } from "./inngest";
 import { logAgentActivity } from "./agent-log";
```

### Edit 2 · `server/agent-workflow.ts`

Insert the approval gate between the action choice and the execute-action step. A human reply resumes this run.

```diff
       }
       const actionId = `${runId}:${cycle}:${decision.action}`;
       const policy = actionPolicy[decision.action];
+      if (policy === "approval") {
+        const input = { expectedVersion: state.world.version };
+        const proposalId = await step.run(`propose-action-${cycle}`, async () => {
+          const proposal = await proposeAction(environmentId, runId, actionId, decision.action, input);
+          return proposal.id;
+        });
+
+        let proposal = await step.run(`read-approval-${cycle}`, () => getProposal(proposalId));
+        let check = 0;
+        while (proposal.status === "pending") {
+          check++;
+          await step.waitForEvent(`wait-for-human-${cycle}-${check}`, {
+            event: "agent/approval.decided",
+            if: `async.data.proposalId == "${proposalId}"`,
+            timeout: "10s",
+          });
+          proposal = await step.run(`reconcile-human-${cycle}-${check}`, () => getProposal(proposalId));
+        }
+        if (proposal.status !== "approved") {
+          await step.run(`stop-after-human-${cycle}`, () => setRun(runId, "escalated", `Human decision: ${proposal.status}`));
+          return;
+        }
+        const fresh = await step.run(`recheck-approved-state-${cycle}`, () => agentState(environmentId, runId));
+        if (fresh.world.version !== input.expectedVersion) {
+          await step.run(`invalidate-approval-${cycle}`, () => staleProposal(proposalId));
+          await step.run(`defer-stale-${cycle}`, () => setRun(runId, "deferred", "State changed; a new event can start a new run"));
+          return;
+        }
+      }
+
       const result = await step.run(`execute-action-${cycle}`, () =>
         executeAction(environmentId, runId, actionId, decision.action, policy === "read" ? undefined : state.world.version));
       if (result.stale === true) {
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

With Faulty release, emit one event. The run should pause in needs approval without changing the release. Approve from the inbox; the same run resumes and rolls back. It then defers until the simulator saves healthy state and emits a new event. Repeat with Deny to see escalation.

## Break it on purpose

Stop only dev:agent while a proposal is pending, answer in the inbox, and restart it. Then repeat but change the state version before approving. The original approval must become stale rather than authorizing an action against new state.

## Engineering challenge

Treat approval as a capability. Define subject, action, expected state, expiry, and audit record. What should happen if the request expires while the operator is away? Design an inbox item that lets someone decide without reading the full trace.

## Catch up

Your solution is `lesson-5`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 4 progress"`, then `git switch lesson-5`. A branch switch changes code, not PostgreSQL or Inngest history; save a fresh state and emit a new event for the next drill.

**Common mistake:** A human reply resumes the existing run; a service event starts another run. The approval is scoped to one proposed action and one observed version, not a standing permission.

**Optional extension:** Add a second action that needs approval, and state what evidence its inbox item should include.

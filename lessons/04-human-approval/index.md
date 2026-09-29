# 04 · Put a human in control

Start: `lesson-4` · Finished solution: `lesson-5`

**Outcome:** A release rollback becomes a persisted inbox proposal and a durable human decision.

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

Start checkout with `--fault release`. The agent finds a likely bad deployment but currently escalates instead of rolling back. A person should see the exact proposed action and expected service version in the inbox.

## Live coding

Replace the temporary approval branch in `server/agent-workflow.ts`. Persist the proposal, wait for a correlated decision, reread it after wake, and re-observe checkout before acting. Keep the operations API's own version check as the final precondition.

These code blocks show the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Import the supplied proposal helpers.

```diff
 import { randomUUID } from 'node:crypto'
 import {
   agentState,
+  getProposal,
   getRun,
   goalSatisfied,
+  proposeAction,
   recordDecision,
   recordToolAction,
   setIteration,
   setRun,
+  staleProposal,
 } from './agent-data'
 import { chooseAction, writeReport } from './agent-brain'
 import { inngest } from './inngest'
```

### Edit 2 · `server/agent-workflow.ts`

Replace the temporary approval escalation with a persisted proposal, durable decision wait, and fresh-state recheck.

```diff
       const actionId = randomUUID()
       const policy = actionPolicy[decision.action]
       if (policy === 'approval') {
-        await step.run('approval-unavailable-' + cycle, () =>
-          setRun(runId, 'escalated', 'Approval gate is not built yet'),
+        const input = { expectedVersion: state.world.version }
+        const proposalId = await step.run(`propose-action-${cycle}`, async () => {
+          const proposal = await proposeAction(
+            environmentId,
+            runId,
+            actionId,
+            decision.action,
+            input,
+          )
+          return proposal.id
+        })
+        let proposal = await step.run(`read-human-${cycle}`, () => getProposal(proposalId))
+        let check = 0
+        while (proposal.status === 'pending') {
+          check++
+          await step.waitForEvent(`wait-for-human-${cycle}-${check}`, {
+            event: 'agent/approval.decided',
+            if: `async.data.proposalId == "${proposalId}"`,
+            timeout: '10s',
+          })
+          proposal = await step.run(`reconcile-human-${cycle}-${check}`, () =>
+            getProposal(proposalId),
+          )
+        }
+        if (proposal.status !== 'approved') {
+          await step.run(`stop-after-human-${cycle}`, () =>
+            setRun(runId, 'escalated', `Human decision: ${proposal.status}`),
+          )
+          return
+        }
+        const fresh = await step.run(`recheck-approved-state-${cycle}`, () =>
+          agentState(environmentId, runId),
         )
-        return
+        if (fresh.world.version !== input.expectedVersion) {
+          await step.run(`invalidate-approval-${cycle}`, () => staleProposal(proposalId))
+          continue
+        }
       }

       const result = await step.run(`execute-action-${cycle}`, () =>
```

Run `npm run format`, `npm run lint`, and `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Start a release fault and approve rollback in the inbox. The same incident should resume, roll back, observe healthy state, and complete. Repeat with Deny; the run should escalate without changing the release.

## Break it on purpose

Leave an approval pending, restart only `dev:agent`, then decide. Restart checkout instead and confirm the old proposal becomes stale. Why are these restarts different?

## Engineering challenge

Define an approval as a scoped capability: subject, run, action, state precondition, expiry, and audit record. Identify what the operator should see before approving.

## Catch up

Your solution is `lesson-5`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 4 progress"`, then `git switch lesson-5`. A branch switch changes code, not PostgreSQL, checkout process state, or Inngest history. Restart checkout with a fresh fault flag for the next drill.

**Common mistake:** The model selects `rollback_release`; the harness turns it into a request. Approval for version 1 is not a blanket permission for a later version.

**Optional extension:** Improve the inbox decision packet with evidence and an impact estimate, without exposing untrusted log text as instruction.

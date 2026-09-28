# 06 · Run an incident drill

Start: `lesson-6` · Finished solution: `complete`

**Outcome:** The agent asks for help when its tools cannot fix an external dependency, then waits for a recovery signal and reports the outcome.

## The engineering idea

The upstream outage is the incident our local tools cannot fix. Disabling our feature or rolling back our release will not repair the payment gateway. A useful agent needs to recognize that limit, reach out to a person, and keep ownership of the goal while the outside world changes. This is the moment when the agent inbox becomes more than an approval queue: it is a place for the agent to ask a question and receive new information.

`request_help` is still a model-selected next action. The harness interprets it as a persisted proposal with a question, puts it in the inbox, and pauses. A human answer is an input to the run, but it is **not** evidence that checkout recovered. After an answer, the workflow waits for an observation about the external dependency. On wakeup it reads current state again. Only the recovery predicate can mark the incident complete.

This separation is my central design preference. Let the model choose what to try next from a constrained action set. Let the harness own permissions, waiting, fresh observation, retries, cancellation, and terminal states. It makes the agent flexible without making its promises unverifiable. [Anthropic's agent guidance](https://www.anthropic.com/engineering/building-effective-agents) describes agents as loops that use ground truth from the environment and pause for human feedback; [Inngest's durable-agent guide](https://www.inngest.com/docs/learn/durable-agents) shows how those pauses fit into a recoverable run.

Now read the trace as a story rather than a list of log lines: the run began with a goal, inspected evidence, asked for help, waited, received an answer, waited again, observed external recovery, and wrote a report. At each point the UI should tell us whether the agent is working, waiting, needs a person, completed, failed, cancelled, or escalated. Observability is part of the user experience. If an agent works in the background, people need to know what it did while they were gone.

I think this is where agents become a product feature instead of a chat demo. They can watch a changing world, make progress when they have enough information, and contact us when they need judgment. The point is not that they run forever. The point is that they can responsibly hold a goal across time, with an explicit and inspectable end.

For the drill, answer the help request but do not recover the dependency yet. Predict the state you expect to see. Then simulate recovery and explain why a human answer alone was insufficient to complete the goal.

### Evaluate the work, not just the final sentence

A polished report can hide an unsafe path. An agent might disable an unrelated feature, ask for approval too late, or claim recovery after one lucky probe and still write a convincing summary. [Anthropic's agent-evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) distinguishes an end result from the trajectory that produced it. [The τ-bench research](https://arxiv.org/abs/2406.12045) tests agents against tool use and policy constraints across complete interactions. My takeaway is to evaluate the **environment state**, the **action sequence**, and the **human boundary** separately.

For each scenario, write an outcome check before running your model: what must be true of the service, what must never have happened, and what status is acceptable if the service cannot be recovered? Then inspect the run timeline for prohibited actions, repeated effects, stale approvals, and loops that spend decisions without new evidence. A correct escalation is a valid outcome for an upstream outage the local tools cannot repair. Calling it a failure merely because the service is still down would reward the agent for pretending it had more control than it does.

### Context is a budget, not a transcript

Our `agentState` returns a bounded slice of observations, events, actions, and human decisions. That is enough for this lab, but it raises a real design question: which past facts must survive after they fall out of the window? [Anthropic's context-engineering work](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) frames context selection as choosing the smallest useful set of information, with compaction and external artifacts for longer tasks. I would preserve stable goals, unresolved commitments, approval scopes, action IDs, and links to evidence. I would summarize old narrative detail instead of replaying every log line into every model call. The database and artifacts carry durable facts; the prompt is a temporary working view.

### The advanced question: what can we delegate?

More autonomy is not automatically more value. If the model picks a risky action, I need to know whether the defect was in its evidence, its tool description, its available actions, or the harness policy. Changing the prompt alone is a weak fix when the system still permits the same unsafe effect. Start with the failure you observed, name the boundary that should have caught it, and design a measurable change. For the final exercise, compare one normal run, one lost-response run, and one human-decision run. The architecture should explain all three without special stories for each trace.

My opinion is that the product is the *continuing relationship* between a person, an agent, and a changing world: the agent holds the goal, pauses when it should, wakes when there is news, and reaches out through an inbox with a concrete decision. The code in this workshop is small so we can see that contract clearly. The hard part of AI engineering is deciding what evidence and authority make the contract trustworthy.

## See it in the lab

Reset **Upstream outage** and start health, log, and dependency events. The local controls cannot repair the payment gateway. Follow the run through the agent inbox, then leave the dependency unavailable after answering so you can see the difference between receiving information and reaching the goal.

## Live coding

In `server/agent-workflow.ts`, add the external-wait branch before `chooseAction`, then let `request_help` share the persisted proposal path. The rollback recheck still applies only to rollback.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

After an answered help request, wait for the external dependency to change. Re-read state on the next cycle rather than spending another model decision.

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

Route `request_help` into the persisted human proposal path. The question comes from the model decision; rollback carries an expected release.

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

An approved help answer is not a rollback. Continue the loop without running the rollback-specific recheck or executing a local tool.

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

## Break it on purpose

Answer the help request but do not recover the dependency. The run should remain waiting through multiple timeouts. Then recover it; no second help proposal or local rollback should be needed. Reset and try `Cannot help` to see escalation.

## Engineering challenge

Build an evaluation card for each incident: the required final service state, forbidden actions, allowed human requests, maximum model decisions, and a check on the final report. Run at least one trial per scenario with your model; reset the lab between trials. Compare the **outcome** with the **trajectory**: a correct report with an unsafe action is a failure, and a safe escalation can be correct even without recovery. Choose one failure you observed and propose a change to the harness, tool contract, or context—not merely a stronger prompt.

## Catch up

Your solution is `complete`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 6 progress"`, then `git switch complete`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** If the model keeps asking for help, confirm the saved human decision is `approved` and inspect `agentState.humanDecisions`. If the service is healthy but completion has not happened, ensure health events continue long enough for the recovery window.

**Optional extension:** Propose one different terminal policy, such as an explicit unresolved report after a configured deadline. Identify which part belongs to the model versus the harness.

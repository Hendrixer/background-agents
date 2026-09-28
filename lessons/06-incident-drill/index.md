# 06 · Run an incident drill

**15:15–16:00 · 45 minutes**  
Start: `lesson-6` · Finished solution: `complete`

**Outcome:** The agent asks for help when its tools cannot fix an external dependency, then waits for a recovery signal and reports the outcome.

## Open and predict

Reset **Upstream outage** and start health, log, and dependency events. Would another local rollback repair the payment gateway? If the agent asks for help, what should happen after we answer but before the dependency actually recovers?

## The idea

The upstream outage is the incident our local tools cannot fix. Disabling our feature or rolling back our release will not repair the payment gateway. A useful agent needs to recognize that limit, reach out to a person, and keep ownership of the goal while the outside world changes. This is the moment when the agent inbox becomes more than an approval queue: it is a place for the agent to ask a question and receive new information.

`request_help` is still a model-selected next action. The harness interprets it as a persisted proposal with a question, puts it in the inbox, and pauses. A human answer is an input to the run, but it is **not** evidence that checkout recovered. After an answer, the workflow waits for an observation about the external dependency. On wakeup it reads current state again. Only the recovery predicate can mark the incident complete.

This separation is my central design preference. Let the model choose what to try next from a constrained action set. Let the harness own permissions, waiting, fresh observation, retries, cancellation, and terminal states. It makes the agent flexible without making its promises unverifiable. [Anthropic's agent guidance](https://www.anthropic.com/engineering/building-effective-agents) describes agents as loops that use ground truth from the environment and pause for human feedback; [Inngest's durable-agent guide](https://www.inngest.com/docs/learn/durable-agents) shows how those pauses fit into a recoverable run.

Now read the trace as a story rather than a list of log lines: the run began with a goal, inspected evidence, asked for help, waited, received an answer, waited again, observed external recovery, and wrote a report. At each point the UI should tell us whether the agent is working, waiting, needs a person, completed, failed, cancelled, or escalated. Observability is part of the user experience. If an agent works in the background, people need to know what it did while they were gone.

I think this is where agents become a product feature instead of a chat demo. They can watch a changing world, make progress when they have enough information, and contact us when they need judgment. The point is not that they run forever. The point is that they can responsibly hold a goal across time, with an explicit and inspectable end.

For the drill, answer the help request but do not recover the dependency yet. Predict the state you expect to see. Then simulate recovery and explain why a human answer alone was insufficient to complete the goal.

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

## Failure experiment

Answer the help request but do not recover the dependency. The run should remain waiting through multiple timeouts. Then recover it; no second help proposal or local rollback should be needed. Reset and try `Cannot help` to see escalation.

## Catch-up checkpoint

Your solution is `complete`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 6 progress"`, then `git switch complete`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.

**Common mistake:** If the model keeps asking for help, confirm the saved human decision is `approved` and inspect `agentState.humanDecisions`. If the service is healthy but completion has not happened, ensure health events continue long enough for three fresh samples.

**Optional extension:** Propose one different terminal policy, such as an explicit unresolved report after a configured deadline. Identify which part belongs to the model versus the harness.

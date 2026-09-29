# 06 · Ask for help and hand off

Start: `lesson-6` · Finished solution: `complete`

**Outcome:** The agent can ask a person a question, resume that run with the answer, and defer until a later event reports external recovery.

## The engineering idea

The upstream outage is the incident our local tools cannot fix. Disabling our feature or rolling back our release will not repair the dependency. A useful agent needs to recognize that limit, reach out to a person, and report what remains unresolved. This is when the agent inbox becomes more than an approval queue: it is a place for the agent to ask a specific question and receive new information after the original browser session has ended.

`request_help` is a model-selected next action. The harness turns it into a persisted inbox item and a durable wait. The answer resumes **that run** and becomes part of its next observation. An answer is not evidence that checkout recovered. If the dependency is still down and no local action is justified, that run ends as deferred. Later, the simulator can save recovered state and publish another service event. The agent's event handler creates a **new run**; that run reads the fresh state and may complete. We are deliberately distinguishing a human reply from a world-change notification.

This separation is my central design preference. Let the model choose a next action from a constrained catalog. Let the harness own permissions, fresh observation, retries, cancellation, decision limits, and terminal states. Let a person provide judgment or missing information. It makes the agent flexible without making its promises unverifiable. [Anthropic's agent guidance](https://www.anthropic.com/engineering/building-effective-agents) emphasizes environmental feedback and bounded autonomy; [Inngest's durable-agent guide](https://www.inngest.com/docs/learn/durable-agents) shows how a run can pause and resume around external input.

Read the two traces as a story. The first event starts a run that inspects evidence, asks for help, waits, receives an answer, observes again, and defers because the world is still degraded. The later recovery event starts a second run that sees the healthy world and writes a report. The Activity page should show both run IDs and each run's observe, predict, act, pause, and terminal entries. The inbox should show the question and the human response. Observability is part of the product: if an agent works while people are away, people need to know what it did and why it stopped.

This pattern does not mean every agent should spawn a run for every webhook forever. An alerting product might coalesce noisy events into one active incident. A research agent might use a schedule to revisit a goal. A coding agent might retain a task until a human reviews a patch. The product question is how long a run owns work, what new information resumes it, and what starts a new unit of work. We chose event-triggered runs and a human wait because they make those boundaries concrete.

### Evaluate the work, not just the final sentence

A polished report can hide an unsafe path. An agent might disable an unrelated feature, ask for approval too late, or claim recovery based on stale state and still write a convincing summary. [Anthropic's agent-evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) distinguishes an end result from the trajectory that produced it. [The τ-bench research](https://arxiv.org/abs/2406.12045) tests tool use and policy constraints across complete interactions. I would evaluate **environment state**, **action sequence**, and **human boundary** separately.

Before running your model, write a card for each preset: what state would satisfy the goal, which actions are forbidden without approval, which questions a person can answer, what budget is acceptable, and whether deferred or escalated is an honest outcome. Then inspect the run timeline for prohibited actions, repeated effects, stale approvals, and loops that spend decisions without new evidence. An honest deferral can be better than a confident but false completion when our tools cannot repair an upstream service.

### Context is a budget, not a transcript

`agentState` returns a bounded slice of recent events, actions, and human decisions alongside the latest world state. That is enough for this exercise, but it raises a real design question: which facts must survive when they fall out of the window? [Anthropic's context-engineering work](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) argues for selecting useful context and keeping durable artifacts outside the prompt. I would preserve the standing goal snapshot, unresolved commitments, approval scopes, action IDs, and links to evidence. I would summarize old narrative detail instead of replaying every log line into every model call. The database carries durable facts; the prompt is a temporary working view.

### The advanced question: what can we delegate?

If the model picks a risky action, ask whether the defect was in its evidence, tool description, available actions, or harness policy. Changing the prompt alone is a weak fix when the system still permits the same unsafe effect. Compare one normal run, one lost-response run, one stale-state run, and one human-decision run. For each, describe **trigger → observation → model choice → harness response → world state → user-visible outcome**. The architecture should explain all four without a special case for “demo mode.”

My opinion is that the product is the continuing relationship between a person, an agent, and a changing world. The agent holds a goal for a bounded piece of work, pauses when it needs a person, and gives control back with a clear record. A later signal can start the next piece of work. The code here is small so we can see that contract clearly. The hard part of AI engineering is deciding what evidence and authority make the contract trustworthy.

## See it in the lab

Load Dependency outage, save state, and emit one dependency event. On this branch the agent escalates because it has no help path. We will turn request_help into an inbox question and a durable human wait. An answer gives context to this run; it does not certify recovery.

## Live coding

In server/agent-workflow.ts, remove the temporary request_help escalation, let help share the persisted proposal and wait path, and continue the loop after an approved answer. Skip the rollback-specific state recheck for a help answer.

These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Remove the temporary escalation and let request_help reach the proposal path.

```diff
         return { report };
       }
 
-      if (decision.action === "request_help") {
-        await step.run(`help-not-implemented-${cycle}`, () => setRun(runId, "escalated", "Help requests are added in lesson 6"));
-        return;
-      }
       const actionId = `${runId}:${cycle}:${decision.action}`;
       const policy = actionPolicy[decision.action];
-      if (policy === "approval") {
-        const input = { expectedVersion: state.world.version };
+      if (policy === "approval" || policy === "help") {
+        const input = policy === "help" ? { question: decision.detail } : { expectedVersion: state.world.version };
         const proposalId = await step.run(`propose-action-${cycle}`, async () => {
           const proposal = await proposeAction(environmentId, runId, actionId, decision.action, input);
           return proposal.id;
```

### Edit 2 · `server/agent-workflow.ts`

After an approved help answer, continue with fresh observation. Only a later service event creates a new run after this one defers.

```diff
           await step.run(`stop-after-human-${cycle}`, () => setRun(runId, "escalated", `Human decision: ${proposal.status}`));
           return;
         }
+        if (policy === "help") continue;
         const fresh = await step.run(`recheck-approved-state-${cycle}`, () => agentState(environmentId, runId));
         if (fresh.world.version !== input.expectedVersion) {
           await step.run(`invalidate-approval-${cycle}`, () => staleProposal(proposalId));
```

Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.

## Verify

Send one Dependency outage event. Answer the request in the inbox. The same run resumes, sees that the dependency is still down, and ends deferred. Load Recovered, save state, and send a new health event; a second run should complete and report the observed state.

## Break it on purpose

Answer help but leave state degraded. Confirm the answer did not make the first run complete. Then change state without an event; no new run appears. Send the event and inspect both run histories side by side.

## Engineering challenge

Write an evaluation card for each preset: target world state, forbidden actions, allowed human requests, maximum decisions, and acceptable terminal states. Run normal, approval, stale-state, and lost-response trials. Score the outcome and the trajectory separately; identify one failure that requires a policy or tool-contract change rather than a stronger prompt.

## Catch up

Your solution is `complete`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 6 progress"`, then `git switch complete`. A branch switch changes code, not PostgreSQL or Inngest history; save a fresh state and emit a new event for the next drill.

**Common mistake:** Do not wait for a service event inside the old run; under this architecture it starts a new run. A help answer resumes the old run, but external recovery is a later observation for a separate run.

**Optional extension:** Add an explicit unresolved report to deferred runs so an operator can see what remains to be done.

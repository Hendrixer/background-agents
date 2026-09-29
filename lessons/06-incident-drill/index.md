# 06 · Ask for help and hand off

Start: `lesson-6` · Finished solution: `complete`

**Outcome:** The agent can ask a person a question, resume the same incident, and wait for independent recovery evidence.

## The engineering idea

The dependency outage is the incident our local tools cannot fix. Disabling our feature or rolling back our release will not repair a payment gateway. A useful background agent should recognize that limit and reach a person with a specific question. The inbox is where unattended work returns to me, not just an approval queue.

`request_help` is a model-selected next action. The harness persists a question and waits for a correlated answer. The answer resumes **the same incident run** and becomes part of the next bounded context view. It is not evidence that checkout recovered. If the dependency remains down, the agent can choose `wait`; a later `health.recovered` event wakes that run, and a fresh observation checks the goal. [Inngest's human-in-the-loop guidance](https://www.inngest.com/docs/ai-patterns/human-in-the-loop) shows the durable propose–wait–resume pattern.

Read the Activity trace as a story: alert, observation, evidence gathering, question, pause, answer, observation, wait, recovery event, observation, report. The agent is free to choose among tools at new decision points, but the harness is responsible for permissions, durable suspension, limits, and completion. [Anthropic's agent guidance](https://www.anthropic.com/engineering/building-effective-agents) emphasizes environmental feedback and bounded autonomy. I want the person to see both what the agent did and why it stopped.

### Evaluate the work, not just its final sentence

A polished report can hide an unsafe path. An agent might disable an unrelated feature, ask for approval too late, or claim recovery from stale evidence and still write a convincing summary. [Anthropic's agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) distinguishes the environment outcome from the trajectory; [τ-bench](https://arxiv.org/abs/2406.12045) studies tool use under policy constraints over complete interactions. I would score **world state**, **action sequence**, and **human boundary** separately. A run that safely asks for help and waits can be better than a confident false completion.

`agentState` returns a bounded slice of recent events, actions, and human decisions alongside current checkout state. That is enough for this exercise, but long-running incidents need a context policy. [Anthropic's context-engineering work](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) argues for selecting useful context and keeping durable artifacts outside the prompt. I would preserve the goal snapshot, unresolved commitments, approval scopes, action IDs, and evidence links; summarize old narrative detail instead of replaying every log line.

If the model picks a bad action, ask whether the problem was evidence, tool design, available actions, or harness policy. Changing the prompt alone is weak when the effect owner still permits the same unsafe operation. The real product is the continuing relationship among a person, an agent, and a changing world, with a clear record of what was observed, authorized, attempted, and verified.

## See it in the lab

Start checkout with `--fault dependency --recover-after-ms 30000`. Local tools cannot fix an upstream gateway. The current checkpoint escalates on `request_help`; we will let the agent reach a person and keep the incident alive.

## Live coding

In `server/agent-workflow.ts`, remove the temporary help escalation. Reuse the persisted proposal and durable wait for `request_help`, but continue with fresh observation after an answer instead of treating it as authorization for a tool effect.

These code blocks show the exact changes between the start and solution branches. Unprefixed context stays, green `+` lines are added, and red `-` lines are removed.

### Edit 1 · `server/agent-workflow.ts`

Remove the temporary help escalation.

```diff
         return { report };
       }

-      if (decision.action === "request_help") {
-        await step.run(`help-unavailable-${cycle}`, () => setRun(runId, "escalated", "Human help path is not built yet"));
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

Let help use the persisted proposal and wait, then continue with a new observation.

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

Answer the help request from the inbox. The same run resumes. If checkout is still degraded, it waits for the service's recovery event; only a fresh healthy observation completes it. The Activity feed should show the question, answer, pause, wake, and report.

## Break it on purpose

Answer the person but leave `--recover-after-ms 0`: the answer alone must not mark checkout healthy. Restart the service healthy and explain why the old incident is superseded rather than completed.

## Engineering challenge

Evaluate outcome, trajectory, and human boundary for feature, release, dependency, and lost-response runs. Which failure requires a policy or tool-contract change rather than a prompt change?

## Catch up

Your solution is `complete`. Check your work with `git status --short`. If you need to switch with unfinished edits, save them first with `git stash push -u -m "lesson 6 progress"`, then `git switch complete`. A branch switch changes code, not PostgreSQL, checkout process state, or Inngest history. Restart checkout with a fresh fault flag for the next drill.

**Common mistake:** A human answer is new context, not evidence of recovery. The model can ask for help, but the harness owns the inbox request and resumption.

**Optional extension:** Add a concise unresolved status in the operator app for a dependency that never recovers.

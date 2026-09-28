# Advanced lab · Make the agent earn your trust

You now have a working background agent. I want you to treat it as a system you might put in front of an on-call engineer, not as a demo that gets credit for producing a plausible report. The question is: **which claims can the system prove from its state and history, and which claims are still guesses?**

This lab is for teams that finish a lesson early or want a deeper capstone after the incident drill. Use the supplied simulator and your own LLM key. Work in pairs if that makes it easier to compare model behavior. Reset the lab between trials. Keep the Inngest trace, the per-run log on `/activity`, and the server event log on `/events` open.

## 1. Write the contract before running anything

For each scenario—Feature rollout, Faulty release, and Upstream outage—make a small evaluation card:

| Check | Question to answer |
| --- | --- |
| Outcome | What service state or explicit unresolved status counts as success? |
| Safety | Which action must never happen without a fresh human approval? |
| Evidence | What observation proves recovery, and how fresh must it be? |
| Trajectory | Which action sequence would be wrong even if the final report sounds right? |
| Budget | How many model decisions and human interruptions are acceptable? |

Do this **before** you see the model's choices. Otherwise it is too easy to move the goalposts to fit a good-looking trace. [Anthropic's evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) separates outcomes and trajectories; the [τ-bench paper](https://arxiv.org/abs/2406.12045) is a useful example of testing both tool behavior and policy compliance over an interaction.

## 2. Collect three different traces

Run Feature rollout normally. Then reset and run it with **Lose the next tool response** armed. Finally, run Faulty release and leave the approval pending while you restart only the agent endpoint. For each run, record the run ID, final status, model decision count, action IDs, and whether a human had to act. Identify which state is held by PostgreSQL and which step results are held by Inngest.

Now run Upstream outage. Answer the help request while the dependency is still down. Pause before clicking **Simulate upstream recovery**. Explain why the answer belongs in the agent's context but cannot satisfy its completion predicate. Then recover the dependency and inspect the final report.

If a model takes a different path than mine, keep the trace. The variability is evidence for your evaluation, not a reason to quietly rerun until you like the result.

## 3. Attack one assumption

Choose one of these extensions and implement or specify it precisely:

1. **Recovery evidence:** Change `hasRecovered` to require a second independent signal, such as the dependency being healthy as well as sustained health samples. State how that changes false-positive and delayed-completion risk. Test health-only event rates at both **1/sec** and **5/sec**.
2. **Approval scope:** Add one new precondition that is checked *after* approval and immediately before rollback. Show a stale approval that is rejected rather than applied. Decide what the inbox should say when the proposal becomes stale.
3. **Unknown effect:** Imagine the operations API calls a provider that cannot deduplicate requests. Design persisted `unknown`, reconciliation, and escalation states for a response lost after a possible commit. Show why neither Inngest's saved steps nor our local `actions` table can prove what the remote provider did.
4. **Run deadline:** Choose a maximum age for an unresolved incident and make the run end with a visible unresolved report or escalation. Specify whether a pending approval gets a different deadline and what an operator sees before and after expiry.

For any code change, run `npm run typecheck`, repeat the relevant scenario, and show the trace that demonstrates the new rule. A design-only choice needs a state diagram, a failure window, and a proposed test that could disprove your claim.

## 4. Defend a design change

Present one observed or plausible failure as **trigger → evidence available → model choice → harness response → world state → user-visible outcome**. Point to the weakest boundary. Is the fix better observation, a clearer tool contract, a deterministic policy, a human decision, or a new terminal state? Explain what you would measure after shipping it.

I would not accept “make the prompt stronger” as the whole answer when the harness still permits the harmful action. [Anthropic's agent-design guidance](https://www.anthropic.com/engineering/building-effective-agents) argues for simple, composable patterns, while its [context-engineering work](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) shows why the evidence supplied to the model matters. We are using those ideas as engineering inputs, not as a substitute for measuring this agent in this lab.

The goal is not to get every incident to `completed`. The goal is a run that acts within its authority, reports uncertainty honestly, and leaves a person with enough evidence to take over.

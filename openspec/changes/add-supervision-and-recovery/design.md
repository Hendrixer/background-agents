## Context

The agent can identify a bad release or an unavailable external dependency. A model choice alone is insufficient authority for a rollback, and a network failure cannot prove an operation did not happen.

## Decisions

1. Persist an approval proposal before waiting. The workflow correlates the decision event by proposal ID and reads saved status after wakeup; timeout also reconciles.
2. Reject or expire a proposal into an escalated run. Before an approved rollback, read service state again and discard an approval whose expected release is stale.
3. Give each action a stable ID derived from run, decision number, and action. The operations API stores its result and effect in one transaction; duplicate IDs return that result.
4. The simulator can commit the next action and then return 503 once. This makes the acknowledgement gap visible without a destructive external integration.
5. A request for help is nonterminal. After a human answer, the run waits for an external recovery event and still requires healthy observations to complete.
6. Inngest cancellation and a run-state check stop work at a durable boundary; a bounded decision count prevents endless action loops.

## Trade-offs

Approval expires after ten minutes, while waits reconcile every ten seconds for a live demonstration. The lab serializes only a single active scenario; the course does not teach distributed lock management.

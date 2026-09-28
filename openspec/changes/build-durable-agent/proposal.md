## Why

The incident lab needs an agent that owns a goal beyond one browser request. Students must see how model decisions become durable, inspectable steps and how a run waits for new evidence.

## What Changes

- Add a one-action-at-a-time model decision adapter and a bounded harness loop.
- Persist run status, decisions, observations, actions, and final reports.
- Use Inngest steps for state reads, model calls, tool calls, and reporting.
- Replace polling with correlated event waits and a deterministic recovery predicate.

## Capabilities

### New Capabilities

- `durable-incident-agent`: Goal-driven incident execution with step checkpoints, event waits, and verified completion.

### Modified Capabilities

None.

## Impact

Adds the agent endpoint and harness modules under `server/`. The lab UI displays the resulting run and timeline. The local Inngest Dev Server owns workflow checkpoints during a workshop run.

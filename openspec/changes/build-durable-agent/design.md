## Context

The supplied lab owns service state and emits events. The agent receives a goal and must continue after the browser is closed or its endpoint process restarts.

## Decisions

1. The model selects exactly one action in a structured output. The harness retrieves state, records the choice, enforces bounds, and executes the tool.
2. Model calls and tool calls live in named Inngest steps. Each loop cycle has a unique deterministic step ID so reconstruction can reuse prior results.
3. The workflow uses `step.waitForEvent` matched by `labId`; a timeout causes a fresh state read. Events wake the run but do not replace authoritative state.
4. Completion uses three fresh healthy observations over a minimum window. A model-selected `complete` cannot bypass that predicate.
5. Reports are generated only after verified recovery. They are persisted with the terminal run state.

## Trade-offs

The workshop runs one active lab incident at a time and uses short timeouts for visible demos. The local Inngest Dev Server must remain running during an agent endpoint restart demonstration.

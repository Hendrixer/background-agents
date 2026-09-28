## 1. Harness and state

- [x] 1.1 Implement bounded state hydration, action selection, action execution, and run history; typecheck all lesson variants.
- [x] 1.2 Add explicit run states and final report persistence; verify a feature incident completes locally.

## 2. Durability and waiting

- [x] 2.1 Checkpoint model calls and tool calls with unique Inngest step IDs; verify a full run after an agent endpoint restart.
- [x] 2.2 Correlate event waits to the active lab and re-read state after waking or timeout; verify a completed event batch leaves the run waiting.
- [x] 2.3 Enforce three fresh healthy observations before completion; verify the full feature and upstream drills.

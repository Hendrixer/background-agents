## Context

Scott live codes on a mirrored main screen and reads notes from a smaller podium display. Students need code to catch up after every lesson without losing unfinished work.

## Decisions

1. Branch `lesson-N` is the start of lesson N; the next branch contains that lesson's solution. `complete` holds the sixth solution.
2. UI, simulator, schema, and routine wiring are present in the starter. The live edits focus on the harness and selected safety policy.
3. Notes use complete TypeScript blocks for new functions and contextual `diff` blocks for edits. The code is rendered from the exact adjacent-branch diff, and a local checker detects drift.
4. The notes site uses VitePress on a separate port. Diff lines wrap on narrow displays, and copying a diff yields context plus additions without removed lines or prefixes.
5. Every lesson includes a prediction, code, verification, failure experiment, and a catch-up path. Branch-switch guidance saves unfinished changes first and reminds students that persisted lab history is separate from Git.

## Trade-offs

All six notes pages are present on every branch so the local docs site always has valid navigation. A student can read ahead; the instructor's course flow still names the current starting and solution branch.

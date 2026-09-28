## 1. Human control

- [x] 1.1 Persist rollback proposals, correlate human decisions, and reconcile missed wakeups; verify approval after an agent endpoint restart.
- [x] 1.2 Handle rejection, expiry, and changed release before applying rollback; typecheck and inspect the gate in the faulty-release drill.
- [x] 1.3 Add a help-answer path and wait for external recovery; verify the upstream incident reaches a report.

## 2. Safe execution

- [x] 2.1 Add stable action IDs and transactional deduplication; verify one effect after a simulated lost response and retry.
- [x] 2.2 Add the UI fault control, cancellation event, and decision cap; verify the UI and workflow compile.

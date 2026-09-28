## Why

Background agents act without a person watching each step. The workshop must show exactly where risky action requires human authority and why durable retries still need application-level idempotency.

## What Changes

- Persist exact rollback and help proposals and pause until a human decides.
- Reconcile decisions after missed notifications, handle rejection and expiry, and recheck state before rollback.
- Add cancellation, decision bounds, action-ID deduplication, and a lost-response simulator control.
- Support an upstream incident that needs help and later external recovery.

## Capabilities

### New Capabilities

- `supervised-recovery`: Human gates, safe retries, cancellation, and external recovery handling.

### Modified Capabilities

None.

## Impact

Extends the lab operations API, agent workflow, approval storage, and dashboard controls. The fault injector is intentionally local and affects only the next tool response.

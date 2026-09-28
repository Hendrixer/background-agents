# Incident lab and simulator contract

The lab is supplied workshop infrastructure. Students build the agent and harness that operate against it. It is a **simulated** checkout service: scenario rules determine whether it is healthy, and health events create timestamped synthetic observations. The UI never presents those values as real traffic measurements.

## Operator app

| Route | Job |
| --- | --- |
| `/` | Inbox with approval and help requests, answers, denials, and a pending-count nav badge |
| `/activity` | Scrollable run list and a connected per-run observe, predict, act, wait, human, and terminal feed |
| `/events` | Events saved by the lab and sent toward Inngest as wakeup hints |
| `/admin` | Workshop-only scenario and event controls |

The Activity feed describes the agent's decisions and effects. The Events page describes what the simulated service emitted. Inngest's Dev Server shows durable step and retry traces. These are three different views of one run.

## Simulator sequence

1. Create a Feature rollout, Faulty release, or Upstream outage scenario. Reset gives it a new `labId`; the dashboard then focuses on that instance.
2. Start **one** agent run with a goal. A service event does not start another run.
3. Compose a finite batch: 1–100 events, an interval from 100 ms to 10 seconds, and either one event type or a mix whose percentages sum to 100.
4. Send the batch. The lab saves a plan and emits on the server even if the browser closes. The UI shows sent/total progress and can stop an unfinished batch.

One health event is a good wakeup probe. It is not sufficient evidence of sustained recovery. Several spaced health observations are needed for the course completion predicate. The plan interval changes when evidence arrives; it does not shorten the recovery window.

The lab persists every event before trying to notify Inngest. `lab/observation` is a doorbell for a waiting run, correlated by `labId`. A run reads current service state after waking. Events sent before a wait is established may not wake that wait, so the harness also re-reads on start and timeout. Notification delivery and durable state are distinct concerns.

## Lifecycle and safety controls

- **Stop batch** halts future event production. It does not repair the service or cancel the run.
- **Cancel run** stops future workflow steps once cancellation is observed. It does not undo a committed effect.
- **Create scenario** makes a new `labId`, preserving old database history while focusing the UI on the new scenario.
- **Restart agent** means restarting only `npm run dev:agent`, leaving the lab server and Inngest Dev Server running.
- **Lose the next tool response** commits an operation and returns a one-time 503, demonstrating the acknowledgement gap and need for idempotency at the effect boundary.
- **Simulate upstream recovery** changes the external dependency state; the agent still needs fresh health observations before completing.

Approvals bind to a saved proposal and its scenario/run. The human's decision is stored before a wakeup notification. After approval, the harness reads current state and rechecks the release before rollback. A help answer provides information; it cannot by itself prove the service recovered.

## Repeatable drills

| Lesson | Scenario and events | Expected evidence |
| --- | --- | --- |
| Goal and harness | Feature rollout, 12 health events at 1 second | Model chooses an action; harness observes and completes |
| Durability | Feature rollout, 12 health events at 1 second | Separate Inngest step checkpoints; restart only agent endpoint |
| Waiting | Feature rollout, start with no batch; send 1, then 12 health events | Visible wait, correlated wake, sustained recovery check |
| Approval | Faulty release, health events at 1 second | Inbox gate, explicit decision, recheck, one rollback |
| Safe retries | Feature rollout, response-loss fault, health events | One committed action ID despite retry attempts |
| Incident drill | Upstream outage, mixed batch then post-recovery health batch | Help request, external recovery, fresh evidence, report |

The seed makes the simulated world repeatable; it does not make model output deterministic. Judge both the final state and the trajectory. A safe escalation can be correct when local tools cannot fix the dependency. A good-looking report after an unauthorized effect is a failure.

The core lab has one active scenario and a small fixed tool and event catalog. It does not demonstrate multi-tenant admission, production webhooks, distributed tracing, or remote deployment. The event log, action log, and run history remain in PostgreSQL; the dashboard returns bounded recent slices. A production implementation should also define retention, compaction, and behavior when notification delivery fails for longer than the wait timeout.

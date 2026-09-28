# Incident lab and simulator contract

Status: proposed starter application specification. These controls are not implemented yet.

## Purpose

Make background execution visible and repeatable. Scott and students should be able to cause an incident, control incoming events, inspect a run, act on an approval, and demonstrate failure recovery without editing fixture JSON during the lesson.

The simulator is starter infrastructure. Students build the agent and harness that operate against it.

## Main screen

1. **Service:** current health, recent observations, release, feature flags, and recent changes.
2. **Run:** goal, status, elapsed time, decision/action count, current wait reason, and report.
3. **Timeline:** events, model-selected actions, policy outcomes, tool results, and run transitions, with IDs visible on expansion.
4. **Approvals/help:** exact pending proposal, approval or rejection controls, expiry, and any requested input.
5. **Simulator controls:** scenario, event controls, and expandable failure controls.

Use Inngest's own UI for durable step traces and retry inspection. The lab timeline should explain domain behavior without attempting to recreate the entire Inngest dashboard.

Clearly show that this is a simulated service. Instructor-visible scenario configuration and hidden root-cause information must not be included in the model's observation payload merely because the UI can display them.

## Event controls

| Control | Meaning |
| --- | --- |
| Scenario preset | Load a documented incident configuration with a known baseline |
| Seed | Reproduce generated telemetry and event order; does not make LLM output deterministic |
| Event types | Choose the permitted telemetry/change event categories |
| Event rate | Set aggregate events per second with a bounded range and a clear unit |
| Start | Start the selected background event producer |
| Stop | Stop future generated events; keep the current run and domain state intact |
| Emit one | Send one selected event using the normal event ingestion path |
| Burst | Send a bounded number of events to exercise admission and wakeup behavior |
| Feed counters | Show emitted and processed counts plus last-event time |

Keep emission rate separate from simulated service health and timeouts. Increasing the event rate must not silently change a 30-second health window into three seconds or start a new LLM call for every observation.

The normal admission rule should allow one active incident run per service/scenario instance. Further telemetry updates the authoritative state and may wake the active run; it does not create a new incident agent each time. Define the actual concurrency/correlation mechanism in the reference implementation and test it under a burst.

Stopping event generation should never make the service appear recovered. The goal predicate must reject stale observations and require enough evidence over the configured window.

## Distinct lifecycle controls

- **Stop events:** stop the producer only.
- **Cancel run:** request a harness lifecycle transition; prevent subsequent actions after cancellation is observed. An already committed side effect is not undone.
- **Reset scenario:** create a fresh scenario instance and baseline, with new correlation identifiers. Clearly disclose any active-run cancellation required by the reset. Preserve old run history for inspection.
- **Restart agent:** use the documented process command/terminal to stop and restart only the student's agent endpoint. Do not implement unrestricted shell execution behind a UI button.

The simulator runs server-side. Browser refresh and closing the tab must not stop it. Keep its process independent of the agent process so crash demonstrations have a meaningful external world to resume into.

## Failure controls

Prioritize a small set that supports the six lessons:

| Fault | Demonstrates |
| --- | --- |
| Fail the next tool attempt before its effect | A transient failure and retry |
| Apply an effect, then fail before acknowledgement/checkpoint | Why retries need operation idempotency |
| Duplicate a selected event | Delivery duplication versus starting duplicate work |
| Change the service while approval is pending | Revalidation of an approved proposal |
| Stop health observations | Durable waiting, timeout behavior, and stale state |
| Approve, reject, or let approval expire | Distinct human decision outcomes |

Failure switches should target a selected operation or consume a single persisted fault token. A “fail next attempt” switch must not reset itself on every retry and accidentally fail forever.

Keep malformed/stale approval injection under explicit test controls if included. The normal UI must send valid, correlated decisions.

## Approval semantics

Persist an immutable proposal containing its action ID, run/scenario association, tool name, arguments, and relevant preconditions. The UI approves that proposal, not an unspecified future action the model might choose.

Persist the decision before emitting its notification. Treat notifications as wakeups, not the sole record of the decision. The reference build must cover an approval arriving before wait registration, duplicate decisions, old approvals, expiry, and changed state.

A state read followed by a wait still has a race. Choose and test an explicit reconciliation/wait-registration strategy in the implementation; do not claim that the database alone eliminates this race.

After a wakeup, the harness retrieves the decision and current domain state, verifies applicability, and either executes the approved action or requests a new decision/proposal. A changed action requires new approval.

## Repeatable demonstration recipes

Each lesson's notes should contain its exact scenario ID, seed, event rate, injected fault, goal, expected transitions, and reset steps.

1. **Ordinary investigation:** unhealthy service → useful investigation → safe change → fresh recovery observations → report → completed.
2. **App restart:** complete at least one durable step → stop agent process → continue simulator events → restart agent → recover without re-running checkpointed work.
3. **Waiting:** stop health events → run waits → emit new observations → run reassesses current state.
4. **Approval:** proposed disruptive action → waiting for approval → restart app → approve the same proposal → revalidate → act.
5. **Ambiguous result:** operation commits → simulated acknowledgement failure → retry with the same action identity → one domain effect.
6. **New information:** change state while approval is pending → approve old proposal → harness detects changed preconditions and reassesses.

A seeded scenario fixes the external evidence, not the model's exact tool sequence or wording. Assertions should target state transitions, permission enforcement, and final domain outcomes. Notes should describe acceptable decision variation.

Before a model call, show a short evidence summary and the allowed action list in the inspector. Show the selected action and relevant results afterward. Do not depend on exposing hidden chain-of-thought to explain a run.

## Implementation scope limits

- One service and one active incident per scenario instance in the core workshop.
- A small fixed catalog of tools, scenarios, and event types.
- Bounded event rates, burst sizes, action count, and run duration.
- Prebuilt local persistence and reset utilities; no database migration lesson.
- Configure shorter demo waits explicitly and show their units. Do not alter global clocks or imply that LLM response times are deterministic.
- No external messages, cloud deployments, real production operations, or extra third-party accounts in required exercises.

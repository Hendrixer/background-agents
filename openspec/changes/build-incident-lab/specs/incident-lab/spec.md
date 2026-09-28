## Purpose

Provide a repeatable local incident environment with visible events, service state, and controls that students can use while building a background agent.

## ADDED Requirements

### Requirement: Scenario selection and reset
The lab SHALL offer feature rollout, faulty release, and upstream outage scenarios. Reset SHALL create a fresh scenario instance with its baseline state and preserve prior run history for inspection.

#### Scenario: Reset a feature rollout
- **WHEN** the operator chooses the feature rollout preset and resets the lab
- **THEN** a new instance begins with an unhealthy service, the problematic feature enabled, and a distinct instance identifier

### Requirement: Event generation controls
The lab SHALL let an operator select event types and a bounded emission rate, start and stop the server-side producer, emit one event, and emit a bounded burst. The UI SHALL show whether production is running and when the last event was emitted.

#### Scenario: Stop generation
- **WHEN** the operator stops the generator
- **THEN** no further automatic events are emitted and the service and agent run state remain unchanged

#### Scenario: Browser closes
- **WHEN** the operator closes the browser while generation is running
- **THEN** the server continues producing events until stopped

### Requirement: Authoritative observations
The lab SHALL expose current service state and recent observations to its agent API. Observations SHALL reflect applied operations and SHALL identify their collection time, so an agent can reject stale evidence.

#### Scenario: Feature disabled
- **WHEN** a disable-feature operation succeeds in the feature rollout scenario
- **THEN** subsequent health observations reflect the improved service state

### Requirement: Correlated operations
The lab SHALL accept operations with a stable action identifier and associate each effect with the active scenario instance. Repeating the same action identifier SHALL return the recorded effect without applying it again.

#### Scenario: Duplicate operation
- **WHEN** an operation request with an existing action identifier is repeated
- **THEN** the lab returns its prior result and records no second effect

### Requirement: Operator dashboard
The UI SHALL put the agent inbox on its home route. It SHALL offer separate routes for the simulated service condition, server event log, per-run agent activity and reports, and simulator administration. The inbox SHALL let an operator approve or deny an action and answer or decline a help request. The service page SHALL identify its health and error signals as simulator-generated values.

#### Scenario: Inspect an incident
- **WHEN** the operator opens the dashboard during an active scenario
- **THEN** the operator can open the relevant route to inspect the service state, server events, or current run and wait reason without reading server logs

### Requirement: Local course setup
The course SHALL start locally with documented npm commands, PostgreSQL configuration, a separate agent process endpoint, and a local Markdown notes site. Credentials SHALL come from ignored environment files.

#### Scenario: Agent restart
- **WHEN** the agent endpoint process restarts while the lab remains running
- **THEN** the lab state and event generation continue independently

## Purpose

Run a goal-driven incident agent durably while keeping state, action authorization, and completion in the harness.

## ADDED Requirements

### Requirement: Goal-driven run
The system SHALL accept a goal for the active lab and persist the run independently of the browser connection. Each model decision SHALL select one action from the available catalog.

#### Scenario: Browser closes
- **WHEN** an operator starts a run and closes the dashboard
- **THEN** the run continues or waits in the background and remains inspectable when the dashboard reopens

### Requirement: Durable step boundaries
The agent SHALL checkpoint state reads, model choices, tool effects, and reporting with stable, unique Inngest step IDs.

#### Scenario: Agent endpoint restart
- **WHEN** the agent process restarts while the local Inngest Dev Server stays running
- **THEN** the run resumes from persisted workflow history without redoing completed steps

### Requirement: Event-based waiting
The agent SHALL wait for lab-correlated observations and re-read current state after a wakeup or timeout.

#### Scenario: Events paused
- **WHEN** the operator stops event generation before recovery is verified
- **THEN** the run stays waiting and does not spend new model decisions on unchanged state

### Requirement: Harness-controlled completion
The harness SHALL require three recent healthy observations over a minimum time window before storing a completed report. A model-selected complete action SHALL not override this rule.

#### Scenario: One healthy sample
- **WHEN** only one healthy observation is available
- **THEN** the agent waits for more evidence instead of marking the run complete

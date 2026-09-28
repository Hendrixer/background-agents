## Purpose

Keep unattended incident remediation under human control and make retries safe after uncertain tool responses.

## ADDED Requirements

### Requirement: Approval before rollback
The harness SHALL persist a proposal and wait for a human decision before executing a release rollback. It SHALL recheck the expected release before applying an approved action.

#### Scenario: Human approves after restart
- **WHEN** the agent endpoint stops with a pending rollback and a human approves while it is down
- **THEN** the saved decision is reconciled after restart and the rollback runs once if its expected release still matches

#### Scenario: Human rejects
- **WHEN** the human rejects a pending rollback
- **THEN** the run ends as escalated without applying the rollback

### Requirement: Idempotent effects
The operations API SHALL use the caller's stable action ID to return a prior result without repeating an effect.

#### Scenario: Response lost after commit
- **WHEN** the next tool response fails after its effect commits and the same request retries
- **THEN** the caller receives the stored result and only one action effect is recorded

### Requirement: Help and external recovery
The harness SHALL treat a help request as a nonterminal human gate and wait for authoritative external recovery before completion.

#### Scenario: Answer without recovery
- **WHEN** a human answers a help request while the upstream dependency remains unavailable
- **THEN** the run remains waiting instead of reporting success

### Requirement: Bounded and cancellable run
The workflow SHALL accept cancellation and SHALL stop after its configured decision limit.

#### Scenario: Operator cancels a waiting run
- **WHEN** the operator cancels a run that is waiting for an observation
- **THEN** the run becomes cancelled and does not perform later operations

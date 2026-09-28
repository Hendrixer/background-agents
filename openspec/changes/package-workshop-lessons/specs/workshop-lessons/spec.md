## Purpose

Package the reference app as a one-day live workshop with reproducible lesson starts, exact presenter notes, and safe catch-up points.

## ADDED Requirements

### Requirement: Ordered lesson checkpoints
The repository SHALL provide `lesson-1` through `lesson-6` and `complete`. Branch `lesson-N+1` SHALL contain lesson N's solution.

#### Scenario: Student catches up
- **WHEN** a student cannot finish lesson 4 during the live segment
- **THEN** the documented path saves unfinished work and switches to `lesson-5`, which contains lesson 4's solution

### Requirement: Exact edit notes
Each lesson SHALL name the source file and location for every live edit, show new functions as complete TypeScript, and show modifications as contextual red/green diffs derived from the neighboring checkpoints.

#### Scenario: Instructor follows a diff
- **WHEN** the instructor opens a lesson page on a small monitor
- **THEN** unchanged code, removed lines, and added lines are visible in one code block at the edit location

### Requirement: Local notes and rehearsal
The course SHALL serve Markdown notes locally and SHALL provide a command to detect drift between displayed code and adjacent Git branches.

#### Scenario: Code changes after notes are written
- **WHEN** a teaching checkpoint changes without regenerating its notes
- **THEN** the notes checker reports the affected lesson as out of sync

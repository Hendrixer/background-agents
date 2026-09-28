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

### Requirement: Shared teaching voice
Each lesson SHALL explain its conceptual model and design tradeoffs before the code in language addressed to students, so the same notes support live teaching and later self-study.

Each lesson SHALL connect at least one architectural claim to a primary research or technical source, identify the instructor's design judgment, and include an engineering challenge that tests reasoning beyond the required code.

#### Scenario: Student revisits a recorded lesson
- **WHEN** a student reads the notes after the workshop
- **THEN** the reasoning behind the code and the instructor's position are understandable without private presenter notes

### Requirement: Local notes and rehearsal
The course SHALL serve Markdown notes locally and SHALL provide a command to detect drift between displayed code and adjacent Git branches.

The notes generator SHALL run with Node.js. The lesson header SHALL omit time blocks, and the lesson shall introduce the lab with a concrete setup rather than a generic prediction prompt.

#### Scenario: Code changes after notes are written
- **WHEN** a teaching checkpoint changes without regenerating its notes
- **THEN** the notes checker reports the affected lesson as out of sync

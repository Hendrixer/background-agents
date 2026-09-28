## Context

The project currently contains course planning documents and an environment file with Inngest keys. The workshop uses a free temporary Neon Postgres database, Drizzle, a separate local agent process, and a visually polished dark UI. See `proposal.md` and `specs/incident-lab/spec.md` for behavior.

## Goals / Non-Goals

**Goals:** Keep the simulator simple enough to inspect in class, deterministic enough to reset, and independent of the agent endpoint so a process restart is visible. Give later proposals stable service, event, action, and approval contracts.

**Non-Goals:** Multi-tenant operation, deployment, arbitrary external webhooks, realistic distributed tracing, and load testing.

## Decisions

1. Use a small Express lab server and a separate Express agent endpoint. The lab owns the simulator and database writes; the agent will later expose Inngest functions. Restarting one process will not restart the other. A monolithic server would undermine the restart demo.
2. Use a no-account Neon PostgreSQL database through `postgres` and Drizzle. A compact schema holds scenario instances, observations, events, actions, decisions, and reports. Schema setup remains in the starter; students do not write it. An unclaimed database expires after 72 hours, so longer-lived practice requires claiming it or creating a new one. In-memory state would be lost during process demonstrations.
3. Use one active scenario instance at a time. Reset creates a new ID and retains old records. This avoids complex tenancy while making stale events and approvals easy to distinguish.
4. Use server-side timer generation for a persisted, finite plan. A plan records its count, interval, type percentages, progress, and status. Generation resumes after a lab-server restart, and browser refresh does not affect it. A dedicated queue would add infrastructure without helping the workshop.
5. Make simulated remediation change domain state. Health generation derives from the active scenario and current release/flag/dependency settings. The agent can verify recovery from fresh evidence.
6. Build a React/Vite operator app with four routes: Inbox, Activity, Events, and Simulator. Activity has a scrollable run list and a connected, phase-coded feed. Persist the per-run activity log in PostgreSQL so the operator can inspect the harness loop; use Inngest separately for execution traces. Label health observations as synthetic signals derived from scenario state. VitePress serves Markdown lesson notes separately.
7. Give each operation a caller-provided action ID. The lab stores the result before responding, so later retry lessons can demonstrate an acknowledgement failure without duplicating the effect.

## Risks / Trade-offs

- [Reset while a run is active] → use a fresh scenario ID; later harness logic rejects mismatched actions and exposes the prior run separately.
- [Too many events flood the UI] → bound plan count and interval, return limited recent history, and persist the full event record locally.
- [Student environment differs] → include a preflight command that checks the Neon connection, schema, and required environment variables with actionable errors.
- [External model output varies] → keep scenario evidence reproducible and assert domain outcomes rather than exact tool order.

## Migration Plan

This is a new local app with a hosted workshop database. Add the package, schema, and startup commands; apply the schema to a fresh Neon database; verify each preset and operation. No existing user data needs migration.

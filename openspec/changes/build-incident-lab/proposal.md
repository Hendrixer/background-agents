## Why

Students need a believable, repeatable incident to investigate without spending the workshop building UI or external integrations. The lab must keep producing events while the separate agent process is restarted, so the course can demonstrate background execution.

## What Changes

- Create a local TypeScript operator app with four routes: an inbox home page, per-run activity, service events, and simulator administration. The simulator creates a scenario, starts one goal-driven run, and sends a finite event batch with count, interval, and event type or weighted mix controls.
- Persist service state, events, actions, approvals, and reports in local PostgreSQL through Drizzle.
- Provide three incident presets with real state changes behind simulated operations: feature rollout, faulty release, and upstream outage.
- Expose small, typed HTTP endpoints for service observations and operations; the later agent changes will consume these contracts.
- Add a separate Node agent endpoint scaffold for Inngest and a local Markdown notes site.
- Add one-command startup and sample environment configuration without including credentials in Git.

## Capabilities

### New Capabilities

- `incident-lab`: Local scenario simulator, incident state, event controls, observation and operation APIs, and operator dashboard.

### Modified Capabilities

None.

## Impact

Creates the project under `background-agents/`, including `package.json`, server and web source, Drizzle schema and setup, VitePress notes, and local scripts. Uses Node.js, Inngest, PostgreSQL, Drizzle, and React/Vite. The lab is starter code; later changes implement the agent harness and lesson checkpoints.

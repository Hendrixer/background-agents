## 1. Project setup

- [x] 1.1 Add npm scripts, dependencies, TypeScript and Vite configuration, and ignored environment examples; verify install and typecheck succeed.
- [x] 1.2 Create a dedicated local PostgreSQL database and Drizzle schema/setup command; verify the schema exists and setup can run twice.

## 2. Incident domain

- [x] 2.1 Implement three resettable incident presets and authoritative service state; verify each preset begins with the expected fault and receives a fresh instance ID.
- [x] 2.2 Implement timestamped observations and persisted finite event plans with count/interval/type mix and stop controls; verify events flow without browser requests and stop when requested.
- [x] 2.3 Implement operations and action-ID deduplication; verify a repeated action has one effect and later observations reflect the change.
- [x] 2.4 Add run, approval, and report data contracts for later agent lessons; verify lab endpoints can read/write representative records.

## 3. Teaching UI and setup

- [x] 3.1 Build the four-route operator app with inbox, run activity, server events, and simulator; verify the request reading pane, response controls, and per-run activity log in a browser.
- [x] 3.2 Add a separate Inngest endpoint process scaffold and local VitePress notes site; verify lab stays up when only the agent process restarts and notes serve locally.
- [x] 3.3 Document startup, local database, environment keys, and simulator reset; verify a clean checkout can follow the documented commands.

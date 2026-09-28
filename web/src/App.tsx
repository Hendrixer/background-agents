import { useEffect, useState } from "react";
import { Activity, ArrowRight, Check, ChevronDown, CircleAlert, Clock3, Inbox, Play, Pause, RotateCcw, Send, Settings2, Square, StepForward, Zap } from "lucide-react";
import { EVENT_TYPES, SCENARIOS, type EventType, type LabSnapshot, type Scenario } from "../../shared/types";

type ServiceEvent = { id: string; type: string; data: Record<string, unknown>; createdAt: string };
type Observation = { id: string; healthy: boolean; errorRate: number; createdAt: string };
type Run = { id: string; goal: string; status: string; iteration: number; waitReason: string | null; report: string | null; startedAt: string };
type Approval = { id: string; runId: string; action: string; input: Record<string, unknown>; status: string; reason: string | null; createdAt: string; expiresAt: string; decidedAt: string | null };
type ActivityEntry = { id: string; kind: string; message: string; detail: Record<string, unknown> | null; createdAt: string };
type Dashboard = { lab: LabSnapshot; events: ServiceEvent[]; observations: Observation[]; runs: Run[]; approvals: Approval[] };

const SCENARIO_LABELS: Record<Scenario, string> = { "feature-rollout": "Feature rollout", "faulty-release": "Faulty release", "upstream-outage": "Upstream outage" };
const DEFAULT_GOAL = "Restore checkout service health. Investigate the incident, request approval for disruptive actions, verify recovery from fresh observations, and write an incident report.";
const NAV = [
  { path: "/", label: "Inbox", icon: Inbox },
  { path: "/service", label: "Service", icon: Activity },
  { path: "/agent", label: "Agent runs", icon: Zap },
  { path: "/events", label: "Server events", icon: Clock3 },
] as const;

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data as T;
}
const time = (value?: string | null) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const label = (value: string) => value.replaceAll("agent:", "").replaceAll("_", " ").replaceAll("-", " ");
const terminal = (status: string) => ["completed", "cancelled", "failed", "escalated"].includes(status);

function Link({ to, children, className = "" }: { to: string; children: React.ReactNode; className?: string }) {
  return <a href={to} className={className} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); window.history.pushState(null, "", to); window.dispatchEvent(new PopStateEvent("popstate"));
  }}>{children}</a>;
}

function LogRows({ rows, kind }: { rows: ActivityEntry[] | ServiceEvent[]; kind: "agent" | "service" }) {
  if (!rows.length) return <div className="empty-state">No {kind === "agent" ? "agent activity for this run" : "server events for this incident"} yet.</div>;
  return <div className="log-rows">{rows.map((row) => {
    const agent = kind === "agent" ? row as ActivityEntry : null;
    const event = kind === "service" ? row as ServiceEvent : null;
    return <details className="log-row" key={row.id}><summary><span className={`log-tag ${agent?.kind.replace(":", "-") ?? ""}`}>{label(agent?.kind ?? event?.type ?? "")}</span><span className="log-message">{agent?.message ?? `${label(event?.type ?? "")} emitted`}</span><time>{time(row.createdAt)}</time><ChevronDown size={14} /></summary><pre>{JSON.stringify(agent?.detail ?? event?.data ?? {}, null, 2)}</pre></details>;
  })}</div>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [data, setData] = useState<Dashboard | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [inboxFilter, setInboxFilter] = useState<"pending" | "resolved">("pending");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("feature-rollout");
  const [rate, setRate] = useState(1);
  const [types, setTypes] = useState<EventType[]>(["health", "log"]);
  const [singleType, setSingleType] = useState<EventType>("health");
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const route = path === "/inbox" ? "/" : ["/", "/service", "/agent", "/events", "/admin"].includes(path) ? path : "/";

  useEffect(() => { const update = () => setPath(window.location.pathname); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, []);
  async function refresh() {
    try {
      const next = await request<Dashboard>("/api/dashboard");
      setData(next);
      if (route === "/agent") {
        const runId = next.runs.find((item) => item.id === selectedRunId)?.id ?? next.runs[0]?.id;
        setActivity(runId ? await request<ActivityEntry[]>(`/api/runs/${runId}/activity`) : []);
      }
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load dashboard"); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 1500); return () => clearInterval(timer); }, [route, selectedRunId]);
  useEffect(() => { if (!data) return; setRate(data.lab.rate); setTypes(data.lab.eventTypes); setScenario(data.lab.scenario); }, [data?.lab.id]);
  async function act(actionPath: string, body: unknown) {
    setBusy(true); setError("");
    try { await request(actionPath, body); await refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed"); return false; }
    finally { setBusy(false); }
  }
  function toggleType(type: EventType) { setTypes((current) => current.includes(type) ? current.length > 1 ? current.filter((item) => item !== type) : current : [...current, type]); }

  const lab = data?.lab;
  const runs = data?.runs ?? [];
  const run = runs.find((item) => item.id === selectedRunId) ?? runs[0];
  const activeRun = runs.find((item) => !terminal(item.status));
  const approvals = data?.approvals ?? [];
  const pending = approvals.filter((item) => item.status === "pending");
  const filteredMessages = approvals.filter((item) => inboxFilter === "pending" ? item.status === "pending" : item.status !== "pending");
  const message = filteredMessages.find((item) => item.id === selectedMessageId) ?? filteredMessages[0];
  const title = route === "/" ? "Inbox" : route === "/service" ? "Checkout service" : route === "/agent" ? "Agent runs" : route === "/events" ? "Server events" : "Simulator admin";
  const condition = lab?.scenario === "feature-rollout" && lab.featureEnabled ? "The feature flag is enabled" : lab?.scenario === "faulty-release" && lab.release === "v2-bad" ? "The faulty release is deployed" : lab?.scenario === "upstream-outage" && !lab.upstreamHealthy ? "The upstream dependency is unavailable" : "No scenario fault remains";

  return <div className="app-shell">
    <aside className="sidebar">
      <Link to="/" className="brand"><span className="brand-mark"><Activity size={17} /></span>checkout<span className="brand-dim">ops</span></Link>
      <div className="workspace-name">BACKGROUND AGENTS <span>·</span> LOCAL LAB</div>
      <nav className="side-nav" aria-label="Operations">{NAV.map(({ path: itemPath, label: name, icon: Icon }) => <Link key={itemPath} to={itemPath} className={route === itemPath ? "selected" : ""}><Icon size={17} />{name}{itemPath === "/" && pending.length > 0 && <span className="nav-count">{pending.length}</span>}</Link>)}</nav>
      <div className="sidebar-divider" />
      <Link to="/admin" className={`admin-link ${route === "/admin" ? "selected" : ""}`}><Settings2 size={17} /> Simulator admin</Link>
      <div className="sidebar-bottom"><span className="live-dot" /> Local workshop environment</div>
    </aside>
    <main className="main-content">
      <header className="topbar"><span>CHECKOUT OPERATIONS <span className="topbar-slash">/</span> {title.toUpperCase()}</span><div className="topbar-links"><a href="http://127.0.0.1:8288" target="_blank" rel="noreferrer">Inngest traces ↗</a><a href="http://127.0.0.1:5174" target="_blank" rel="noreferrer">Lesson notes ↗</a></div></header>
      <div className="page-content">
        {error && <div className="error-banner"><CircleAlert size={16} />{error}<button onClick={() => setError("")}>Dismiss</button></div>}

        {route === "/" && <div className="inbox-layout">
          <div className="mailbox"><div className="mailbox-heading"><h1>Inbox</h1><span>{pending.length === 0 ? "No requests need a response" : `${pending.length} request${pending.length === 1 ? " needs" : "s need"} a response`}</span></div><div className="mailbox-filters"><button className={inboxFilter === "pending" ? "active" : ""} onClick={() => { setInboxFilter("pending"); setSelectedMessageId(null); }}>Needs response <span>{pending.length}</span></button><button className={inboxFilter === "resolved" ? "active" : ""} onClick={() => { setInboxFilter("resolved"); setSelectedMessageId(null); }}>Resolved <span>{approvals.length - pending.length}</span></button></div><div className="message-list">{filteredMessages.length ? filteredMessages.map((item) => <button key={item.id} className={`message-row ${message?.id === item.id ? "selected" : ""}`} onClick={() => setSelectedMessageId(item.id)}><span className="message-avatar"><Zap size={14} /></span><span className="message-copy"><span className="message-row-top"><strong>Background agent</strong><time>{time(item.createdAt)}</time></span><b>{item.action === "request_help" ? "Needs your answer" : `Approve ${label(item.action)}?`}</b><small>{item.action === "request_help" ? String(item.input.question || "The agent has a question") : `Run ${item.runId.slice(0, 8)} · ${label(item.action)}`}</small></span></button>) : <div className="mailbox-empty">{inboxFilter === "pending" ? "Nothing needs your response. New requests appear here when an agent pauses." : "No past responses for this incident."}</div>}</div></div>
          <div className="reading-pane">{message ? <><div className="reading-header"><span className="overline">{message.status === "pending" ? "NEEDS RESPONSE" : "RESOLVED"} · RUN {message.runId.slice(0, 8)}</span><h2>{message.action === "request_help" ? "The agent needs information" : `Approval: ${label(message.action)}`}</h2><p>Background agent <span>·</span> {message.status === "pending" ? `Expires ${new Date(message.expiresAt).toLocaleString()}` : `${label(message.status)} at ${time(message.decidedAt)}`}</p></div><div className="conversation"><div className="conversation-entry"><span className="message-avatar"><Zap size={14} /></span><div><div className="conversation-author">Background agent <span>· Request</span></div><p>{message.action === "request_help" ? String(message.input.question || "What should I do next?") : `I propose ${label(message.action)} to continue restoring checkout. Please review the exact action before I proceed.`}</p>{message.action !== "request_help" && <div className="action-detail"><span>PROPOSED TOOL INPUT</span><pre>{JSON.stringify(message.input, null, 2)}</pre></div>}</div></div>{message.status !== "pending" && <div className="conversation-entry human-entry"><span className="message-avatar"><Check size={14} /></span><div><div className="conversation-author">You <span>· {label(message.status)}</span></div><p>{message.reason || (message.status === "approved" ? "Approved this action." : "Denied this action.")}</p></div></div>}</div>{message.status === "pending" && <div className="reply-composer"><label htmlFor="reply-input">{message.action === "request_help" ? "Reply to the agent" : "Decision note (optional)"}</label><textarea id="reply-input" value={answers[message.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [message.id]: event.target.value }))} placeholder={message.action === "request_help" ? "Share what you know about the incident…" : "Add context for the run history…"} rows={4} /><div className="composer-actions"><button className="button button-secondary" disabled={busy} onClick={() => void act("/api/approvals/decide", { approvalId: message.id, decision: "rejected", reason: (answers[message.id] ?? "").trim() || undefined })}>{message.action === "request_help" ? "Cannot help" : "Deny"}</button><button className="button button-primary" disabled={busy || (message.action === "request_help" && !(answers[message.id] ?? "").trim())} onClick={() => void act("/api/approvals/decide", { approvalId: message.id, decision: "approved", reason: (answers[message.id] ?? "").trim() || undefined })}><Send size={14} />{message.action === "request_help" ? "Send answer" : "Approve action"}</button></div></div>}<div className="reading-footer"><Link to="/agent">View run activity <ArrowRight size={14} /></Link></div></> : <div className="reading-empty"><Inbox size={30} /><h2>{inboxFilter === "pending" ? "All caught up" : "No resolved requests"}</h2><p>{inboxFilter === "pending" ? "When the agent needs approval or information, its message will appear here. You can leave this page while it works." : "Past decisions and answers appear here for the current incident."}</p><Link to="/agent">View agent runs <ArrowRight size={14} /></Link></div>}</div>
        </div>}

        {route === "/service" && <div className="single-page"><div className="page-heading"><div><span className="overline">SIMULATED CHECKOUT</span><h1>Service condition</h1><p>This lab uses scripted state transitions to teach how an agent observes and reacts.</p></div><span className={`status-label ${lab?.healthy ? "good" : "bad"}`}>{lab?.healthy ? "Healthy" : "Degraded"}</span></div><div className="truth-banner"><strong>{condition}</strong><p>The displayed condition is derived from scenario state, not live customer traffic. Health events carry a generated error signal of {lab?.errorRate ?? "—"}%; each observation below is a sample emitted by the simulator.</p></div><div className="section-heading"><h2>Scenario state</h2><span>{lab ? SCENARIO_LABELS[lab.scenario] : "Loading"}</span></div><div className="fact-list"><div><span>Release</span><strong>{lab?.release ?? "—"}</strong></div><div><span>Feature flag</span><strong>{lab?.featureEnabled ? "Enabled" : "Disabled"}</strong></div><div><span>Upstream dependency</span><strong>{lab?.upstreamHealthy ? "Available" : "Unavailable"}</strong></div><div><span>Event stream</span><strong>{lab?.running ? "Running" : "Stopped"}</strong></div></div><div className="section-heading"><h2>Health observations</h2><span>Generated samples · newest first</span></div><div className="data-list">{data?.observations.length ? data.observations.map((item) => <div className="data-row" key={item.id}><time>{time(item.createdAt)}</time><span>{item.healthy ? "Healthy sample" : "Degraded sample"}</span><strong>{item.errorRate}% generated errors</strong></div>) : <div className="empty-state">No health event has produced an observation yet. Emit one on the simulator admin page.</div>}</div></div>}

        {route === "/agent" && <div className="single-page"><div className="page-heading"><div><span className="overline">DURABLE WORK</span><h1>Agent runs</h1><p>Choose a run to inspect its goal, decisions, waits, tool calls, and result.</p></div>{run && <span className={`status-label ${run.status === "completed" ? "good" : ""}`}>{label(run.status)}</span>}</div><div className="run-toolbar"><label>Inspect run <select value={run?.id ?? ""} onChange={(event) => setSelectedRunId(event.target.value)}>{runs.length ? runs.map((item) => <option value={item.id} key={item.id}>{time(item.startedAt)} · {label(item.status)} · {item.id.slice(0, 8)}</option>) : <option value="">No runs yet</option>}</select></label>{run && !terminal(run.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act("/api/runs/cancel", { runId: run.id })}><Square size={13} /> Cancel run</button>}</div>{run && <div className="run-summary"><div><span>GOAL</span><p>{run.goal}</p></div><div><span>CURRENT STATE</span><p>{label(run.status)} · Decision {run.iteration}{run.waitReason ? ` · ${run.waitReason}` : ""}</p></div></div>}{!activeRun && <div className="new-run-form"><div><h2>Start a new run</h2><p>Give the agent an outcome. It can work after you leave this page.</p></div><textarea aria-label="Agent goal" value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} /><button className="button button-primary" disabled={!lab || busy || !goal.trim()} onClick={() => lab && void act("/api/runs/start", { labId: lab.id, goal })}><Play size={14} /> Start agent</button></div>}<div className="section-heading"><h2>Activity log</h2><span>{run ? `Run ${run.id.slice(0, 8)} · saved in PostgreSQL` : "Per-run history"}</span></div><p className="section-note">Each row records one part of the harness loop. Open a row for its saved detail; use Inngest for step replay and execution traces.</p><LogRows rows={activity} kind="agent" />{run?.report && <><div className="section-heading"><h2>Incident report</h2></div><div className="report-text">{run.report}</div></>}</div>}

        {route === "/events" && <div className="single-page"><div className="page-heading"><div><span className="overline">SERVICE → AGENT</span><h1>Server events</h1><p>Signals emitted by the simulator. An event can wake a run; the agent then reads current state.</p></div><span className="quiet-count">{data?.events.length ?? 0} recent</span></div><LogRows rows={data?.events ?? []} kind="service" /></div>}

        {route === "/admin" && <div className="single-page admin-page"><div className="page-heading"><div><span className="overline">WORKSHOP CONTROLS</span><h1>Simulator admin</h1><p>Create the conditions the background agent observes. These controls are not part of the operator inbox.</p></div></div><div className="section-heading"><h2>Incident scenario</h2><span>{lab ? `Loaded: ${SCENARIO_LABELS[lab.scenario]}` : "Loading"}</span></div><div className="admin-form-row"><label>Scenario<select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>{SCENARIOS.map((item) => <option key={item} value={item}>{SCENARIO_LABELS[item]}</option>)}</select></label><button className="button button-secondary" disabled={busy} onClick={() => { setSelectedRunId(null); setSelectedMessageId(null); void act("/api/lab/reset", { scenario, seed: 1 }); }}><RotateCcw size={14} /> Load scenario</button></div><div className="section-heading"><h2>Event producer</h2><span>{lab?.running ? "Running" : "Stopped"} · {lab?.rate ?? 1}/sec</span></div><p className="section-note">Events are generated by the lab server, even when you close this browser tab.</p><div className="admin-form-row"><div className="admin-field"><span>Stream event types</span><div className="chip-row">{EVENT_TYPES.map((item) => <button key={item} className={`chip ${types.includes(item) ? "chip-selected" : ""}`} onClick={() => toggleType(item)}>{types.includes(item) && <Check size={12} />}{label(item)}</button>)}</div></div><label>Rate <strong>{rate}/sec</strong><input aria-label="Events per second" type="range" min="1" max="5" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></label></div><div className="button-row"><button className="button button-primary" disabled={!lab || busy} onClick={() => lab && void act("/api/lab/config", { labId: lab.id, rate, eventTypes: types, running: !lab.running })}>{lab?.running ? <Pause size={14} /> : <Play size={14} />}{lab?.running ? "Stop events" : "Start events"}</button><button className="button button-secondary" disabled={!lab || busy} onClick={() => lab && void act("/api/lab/config", { labId: lab.id, rate, eventTypes: types, running: lab.running })}>Apply settings</button></div><div className="section-heading"><h2>Emit manually</h2></div><div className="button-row"><select aria-label="Single event type" value={singleType} onChange={(event) => setSingleType(event.target.value as EventType)}>{EVENT_TYPES.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select><button className="button button-secondary" disabled={!lab || busy} onClick={() => lab && void act("/api/lab/emit", { labId: lab.id, type: singleType })}><StepForward size={14} /> Emit one</button><button className="button button-secondary" disabled={!lab || busy} onClick={() => lab && void act("/api/lab/emit", { labId: lab.id, type: singleType, count: 8 })}>Burst ×8</button></div><div className="section-heading"><h2>Failure drill</h2></div><p className="section-note">Commit the next tool effect, then lose its response. Inspect the retry in the agent log.</p><button className="button button-secondary" disabled={!lab || busy || lab.failNextAction} onClick={() => lab && void act("/api/lab/fault", { labId: lab.id, enabled: true })}>{lab?.failNextAction ? "Failure armed" : "Arm next response failure"}</button>{lab?.scenario === "upstream-outage" && <><div className="section-heading"><h2>External dependency</h2></div><p className="section-note">The agent cannot fix this with a local action. Simulate recovery after you answer its question.</p><button className="button button-secondary" disabled={busy || lab.upstreamHealthy} onClick={() => void act("/api/lab/recover", { labId: lab.id })}>Simulate upstream recovery <ArrowRight size={13} /></button></>}</div>}
      </div>
    </main>
  </div>;
}

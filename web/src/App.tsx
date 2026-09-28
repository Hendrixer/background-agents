import { useEffect, useState } from "react";
import {
  Activity, ArrowRight, Bell, BrainCircuit, Check, CheckCircle2, ChevronDown,
  CircleAlert, Clock3, Eye, Inbox, MessageCircle, Pause, Play, RotateCcw,
  Send, Settings2, ShieldAlert, Square, Target, Wrench, Zap,
} from "lucide-react";
import { EVENT_TYPES, SCENARIOS, type EventType, type LabSnapshot, type Scenario } from "../../shared/types";

type ServiceEvent = { id: string; type: EventType; data: Record<string, unknown>; createdAt: string };
type Run = { id: string; goal: string; status: string; iteration: number; waitReason: string | null; report: string | null; startedAt: string };
type Approval = { id: string; runId: string; action: string; input: Record<string, unknown>; status: string; reason: string | null; createdAt: string; expiresAt: string; decidedAt: string | null };
type ActivityEntry = { id: string; kind: string; message: string; detail: Record<string, unknown> | null; createdAt: string };
type EventPlan = { id: string; total: number; sent: number; intervalMs: number; weights: Record<EventType, number>; status: string };
type Dashboard = { lab: LabSnapshot; events: ServiceEvent[]; runs: Run[]; approvals: Approval[]; plan: EventPlan | null };

const SCENARIO_LABELS: Record<Scenario, string> = {
  "feature-rollout": "Feature rollout",
  "faulty-release": "Faulty release",
  "upstream-outage": "Upstream outage",
};
const DEFAULT_GOAL = "Restore checkout service health. Investigate the incident, request approval for disruptive actions, verify recovery from fresh observations, and write an incident report.";
const DEFAULT_WEIGHTS: Record<EventType, number> = { health: 70, log: 30, deployment: 0, dependency: 0 };
const NAV = [
  { path: "/", label: "Inbox", icon: Inbox },
  { path: "/activity", label: "Activity", icon: Activity },
  { path: "/events", label: "Events", icon: Bell },
  { path: "/admin", label: "Simulator", icon: Settings2 },
] as const;

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Cannot reach the lab API. Start npm run dev:lab and try again.");
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(response.status === 502 || response.status === 503
      ? "The lab API is offline. Start npm run dev:lab and try again."
      : `The lab API returned an unexpected response (${response.status}).`);
  }
  let data: { error?: string };
  try { data = await response.json(); }
  catch { throw new Error("The lab API returned an incomplete response. Try again."); }
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data as T;
}
const time = (value?: string | null) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
const label = (value: string) => value.replaceAll("agent:", "").replaceAll("_", " ").replaceAll("-", " ");
const terminal = (status: string) => ["completed", "cancelled", "failed", "escalated"].includes(status);

function Link({ to, children, className = "", title }: { to: string; children: React.ReactNode; className?: string; title?: string }) {
  return <a href={to} className={className} title={title} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }}>{children}</a>;
}

function phaseOf(entry: ActivityEntry) {
  if (entry.kind.startsWith("agent:")) return entry.kind.slice(6);
  if (entry.kind === "approval") return "human";
  if (entry.kind === "decision") return "predict";
  if (entry.kind === "action") return "act";
  if (entry.kind === "run") {
    if (/completed|cancelled|failed|escalated/.test(entry.message)) return "terminal";
    if (/waiting|needs/.test(entry.message)) return "pause";
    return "start";
  }
  return entry.kind;
}
function activityDetail(entry: ActivityEntry) {
  const detail = entry.detail ?? {};
  const phase = phaseOf(entry);
  if (phase === "observe") return `Release ${detail.release ?? "—"} · ${detail.errorRate ?? "—"}% generated errors · feature ${detail.featureEnabled ? "on" : "off"}`;
  if (phase === "predict") return String(detail.reason ?? "The model chose the next action from current state.");
  if (phase === "act") return detail.error ? String(detail.error) : detail.actionId ? `Action ${String(detail.actionId).slice(0, 24)}…` : "Tool effect recorded by the lab.";
  if (phase === "pause" || phase === "terminal") return String(detail.waitReason ?? (phase === "terminal" ? "The run reached a terminal state." : "The run suspended until new evidence arrives."));
  if (phase === "human") return String(detail.question ?? detail.reason ?? (detail.proposalId ? `Request ${String(detail.proposalId).slice(0, 8)}` : "Human decision recorded."));
  if (phase === "start") return String(detail.goal ?? "Goal accepted.");
  if (phase === "resume") return "The harness is reading current state again after a wakeup.";
  if (phase === "loop") return `Decision cycle ${detail.iteration ?? "—"}`;
  return Object.keys(detail).length ? "Open the payload for the saved details." : "";
}
function activityTitle(entry: ActivityEntry) {
  return entry.message === "Requested request help" ? "Asked a human for help" : entry.message;
}
const PHASE_ICONS = {
  start: Target, observe: Eye, loop: RotateCcw, predict: BrainCircuit,
  act: Wrench, pause: Pause, resume: Play, human: MessageCircle,
  terminal: CheckCircle2, policy: ShieldAlert,
} as const;
function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (!entries.length) return <div className="empty-state">No activity has been recorded for this run yet.</div>;
  return <div className="activity-feed">{entries.map((entry) => {
    const phase = phaseOf(entry);
    const Icon = PHASE_ICONS[phase as keyof typeof PHASE_ICONS] ?? Zap;
    const detail = activityDetail(entry);
    return <article className={`activity-entry phase-${phase}`} key={entry.id}>
      <div className="activity-rail"><span className="activity-icon"><Icon size={15} strokeWidth={1.8} /></span></div>
      <div className="activity-body"><div className="activity-meta"><span>{label(phase)}</span><time>{time(entry.createdAt)}</time></div><h3>{activityTitle(entry)}</h3>{detail && <p>{detail}</p>}{entry.detail && Object.keys(entry.detail).length > 0 && <details className="payload"><summary>View payload <ChevronDown size={12} /></summary><pre>{JSON.stringify(entry.detail, null, 2)}</pre></details>}</div>
    </article>;
  })}</div>;
}
function EventFeed({ events }: { events: ServiceEvent[] }) {
  if (!events.length) return <div className="empty-state">No server events have been emitted for this scenario.</div>;
  return <div className="event-feed">{events.map((event) => <details className="event-entry" key={event.id}>
    <summary><span className={`event-type event-${event.type}`}><Bell size={14} /></span><span className="event-name"><strong>{label(event.type)}</strong><small>{event.id.slice(0, 8)} · saved by the lab</small></span><time>{time(event.createdAt)}</time><ChevronDown size={14} /></summary>
    <pre>{JSON.stringify(event.data, null, 2)}</pre>
  </details>)}</div>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const route = path === "/agent" ? "/activity" : path === "/inbox" ? "/" : path === "/service" ? "/admin" : NAV.some((item) => item.path === path) ? path : "/";
  const [data, setData] = useState<Dashboard | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [inboxFilter, setInboxFilter] = useState<"pending" | "resolved">("pending");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("feature-rollout");
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [total, setTotal] = useState(1);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [mixMode, setMixMode] = useState(false);
  const [singleType, setSingleType] = useState<EventType>("health");
  const [weights, setWeights] = useState<Record<EventType, number>>(DEFAULT_WEIGHTS);

  useEffect(() => { const update = () => setPath(window.location.pathname); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, []);
  async function refresh() {
    try {
      const next = await request<Dashboard>("/api/dashboard");
      setData(next);
      if (route === "/activity") {
        const runId = next.runs.find((item) => item.id === selectedRunId)?.id ?? next.runs[0]?.id;
        setActivity(runId ? await request<ActivityEntry[]>(`/api/runs/${runId}/activity`) : []);
      }
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load dashboard"); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 1500); return () => clearInterval(timer); }, [route, selectedRunId]);
  useEffect(() => { if (data?.lab.id) setScenario(data.lab.scenario); }, [data?.lab.id]);
  async function act(actionPath: string, body: unknown) {
    setBusy(true); setError("");
    try { await request(actionPath, body); await refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed"); return false; }
    finally { setBusy(false); }
  }

  const lab = data?.lab;
  const runs = data?.runs ?? [];
  const run = runs.find((item) => item.id === selectedRunId) ?? runs[0];
  const activeRun = runs.find((item) => !terminal(item.status));
  const approvals = data?.approvals ?? [];
  const pending = approvals.filter((item) => item.status === "pending");
  const filteredMessages = approvals.filter((item) => inboxFilter === "pending" ? item.status === "pending" : item.status !== "pending");
  const message = filteredMessages.find((item) => item.id === selectedMessageId) ?? filteredMessages[0];
  const plan = data?.plan;
  const effectiveWeights: Record<EventType, number> = mixMode ? weights : Object.fromEntries(EVENT_TYPES.map((type) => [type, type === singleType ? 100 : 0])) as Record<EventType, number>;
  const weightTotal = EVENT_TYPES.reduce((sum, type) => sum + effectiveWeights[type], 0);
  const canSend = !!lab && !busy && plan?.status !== "running" && Number.isInteger(total) && total >= 1 && total <= 100 && weightTotal === 100;
  const title = route === "/" ? "Inbox" : route === "/activity" ? "Activity" : route === "/events" ? "Events" : "Simulator";

  return <div className="app-shell">
    <aside className="sidebar"><Link to="/" className="brand-mark" title="Checkout operations"><Activity size={20} /></Link><nav className="side-nav" aria-label="Operations">{NAV.map(({ path: itemPath, label: name, icon: Icon }) => <Link key={itemPath} to={itemPath} title={name} className={route === itemPath ? "selected" : ""}><Icon size={20} strokeWidth={1.7} /><span className="sr-only">{name}</span>{itemPath === "/" && pending.length > 0 && <span className="nav-count">{pending.length}</span>}</Link>)}</nav><div className="sidebar-bottom" title="Local workshop environment"><span className="live-dot" /></div></aside>
    <main className="main-content"><header className="topbar"><span>CHECKOUT OPS <span className="topbar-slash">/</span> {title.toUpperCase()}</span><div className="topbar-links"><a href="http://127.0.0.1:8288" target="_blank" rel="noreferrer">Inngest traces ↗</a><a href="http://127.0.0.1:5174" target="_blank" rel="noreferrer">Lesson notes ↗</a></div></header><div className="page-content">
      {error && <div className="error-banner"><CircleAlert size={16} />{error}<button onClick={() => setError("")}>Dismiss</button></div>}

      {route === "/" && <div className="inbox-layout"><div className="mailbox"><div className="mailbox-heading"><h1>Inbox</h1><span>{pending.length === 0 ? "No requests need a response" : `${pending.length} request${pending.length === 1 ? " needs" : "s need"} a response`}</span></div><div className="mailbox-filters"><button className={inboxFilter === "pending" ? "active" : ""} onClick={() => { setInboxFilter("pending"); setSelectedMessageId(null); }}>Needs response <span>{pending.length}</span></button><button className={inboxFilter === "resolved" ? "active" : ""} onClick={() => { setInboxFilter("resolved"); setSelectedMessageId(null); }}>Resolved <span>{approvals.length - pending.length}</span></button></div><div className="message-list">{filteredMessages.length ? filteredMessages.map((item) => <button key={item.id} className={`message-row ${message?.id === item.id ? "selected" : ""}`} onClick={() => setSelectedMessageId(item.id)}><span className="message-avatar"><Zap size={14} /></span><span className="message-copy"><span className="message-row-top"><strong>Background agent</strong><time>{time(item.createdAt)}</time></span><b>{item.action === "request_help" ? "Needs your answer" : `Approve ${label(item.action)}?`}</b><small>{item.action === "request_help" ? String(item.input.question || "The agent has a question") : `Run ${item.runId.slice(0, 8)} · ${label(item.action)}`}</small></span></button>) : <div className="mailbox-empty">{inboxFilter === "pending" ? "Nothing needs your response. New requests appear here when an agent pauses." : "No past responses for this scenario."}</div>}</div></div><div className="reading-pane">{message ? <><div className="reading-header"><span className="overline">{message.status === "pending" ? "NEEDS RESPONSE" : "RESOLVED"} · RUN {message.runId.slice(0, 8)}</span><h2>{message.action === "request_help" ? "The agent needs information" : `Approval: ${label(message.action)}`}</h2><p>Background agent <span>·</span> {message.status === "pending" ? `Expires ${new Date(message.expiresAt).toLocaleString()}` : `${label(message.status)} at ${time(message.decidedAt)}`}</p></div><div className="conversation"><div className="conversation-entry"><span className="message-avatar"><Zap size={14} /></span><div><div className="conversation-author">Background agent <span>· Request</span></div><p>{message.action === "request_help" ? String(message.input.question || "What should I do next?") : `I propose ${label(message.action)} to continue restoring checkout. Please review the exact action before I proceed.`}</p>{message.action !== "request_help" && <div className="action-detail"><span>PROPOSED TOOL INPUT</span><pre>{JSON.stringify(message.input, null, 2)}</pre></div>}</div></div>{message.status !== "pending" && <div className="conversation-entry human-entry"><span className="message-avatar"><Check size={14} /></span><div><div className="conversation-author">You <span>· {label(message.status)}</span></div><p>{message.reason || (message.status === "approved" ? "Approved this action." : "Denied this action.")}</p></div></div>}</div>{message.status === "pending" && <div className="reply-composer"><label htmlFor="reply-input">{message.action === "request_help" ? "Reply to the agent" : "Decision note (optional)"}</label><textarea id="reply-input" value={answers[message.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [message.id]: event.target.value }))} placeholder={message.action === "request_help" ? "Share what you know about the incident…" : "Add context for the run history…"} rows={4} /><div className="composer-actions"><button className="button button-secondary" disabled={busy} onClick={() => void act("/api/approvals/decide", { approvalId: message.id, decision: "rejected", reason: (answers[message.id] ?? "").trim() || undefined })}>{message.action === "request_help" ? "Cannot help" : "Deny"}</button><button className="button button-primary" disabled={busy || (message.action === "request_help" && !(answers[message.id] ?? "").trim())} onClick={() => void act("/api/approvals/decide", { approvalId: message.id, decision: "approved", reason: (answers[message.id] ?? "").trim() || undefined })}><Send size={14} />{message.action === "request_help" ? "Send answer" : "Approve action"}</button></div></div>}<div className="reading-footer"><Link to="/activity">View run activity <ArrowRight size={14} /></Link></div></> : <div className="reading-empty"><Inbox size={30} /><h2>{inboxFilter === "pending" ? "All caught up" : "No resolved requests"}</h2><p>{inboxFilter === "pending" ? "When the agent needs approval or information, its message will appear here." : "Past decisions and answers appear here for the current scenario."}</p><Link to="/activity">View activity <ArrowRight size={14} /></Link></div>}</div></div>}

      {route === "/activity" && <div className="activity-layout"><div className="run-list-pane"><div className="list-heading"><span className="overline">BACKGROUND WORK</span><h1>Activity</h1><p>{runs.length} run{runs.length === 1 ? "" : "s"} in this scenario</p></div><div className="run-list">{runs.length ? runs.map((item) => <button key={item.id} className={`run-list-item ${run?.id === item.id ? "selected" : ""}`} onClick={() => setSelectedRunId(item.id)}><span className={`run-dot ${terminal(item.status) ? item.status : "active"}`} /><span><strong>{item.goal}</strong><small>{time(item.startedAt)} · {label(item.status)} · {item.id.slice(0, 8)}</small></span></button>) : <div className="mailbox-empty">No runs yet. Load a scenario and start an agent in the Simulator.</div>}</div><Link to="/admin" className="list-footer">Open simulator <ArrowRight size={13} /></Link></div><div className="run-detail-pane">{run ? <><div className="run-detail-header"><div><span className="overline">RUN {run.id.slice(0, 8)}</span><h2>{label(run.status)}</h2><p>{run.goal}</p><div className="run-subline">Started {time(run.startedAt)} · Decision {run.iteration}{run.waitReason ? ` · ${run.waitReason}` : ""}</div></div>{!terminal(run.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act("/api/runs/cancel", { runId: run.id })}><Square size={13} /> Cancel run</button>}</div><div className="feed-heading"><h3>Run activity</h3><span>Persisted per run · newest first</span></div><ActivityFeed entries={activity} />{run.report && <section className="report-section"><h3>Incident report</h3><div>{run.report}</div></section>}</> : <div className="reading-empty"><Activity size={28} /><h2>No runs yet</h2><p>Create a scenario and start an agent in the Simulator. Its activity will appear here.</p><Link to="/admin">Open simulator <ArrowRight size={14} /></Link></div>}</div></div>}

      {route === "/events" && <div className="events-page"><div className="page-heading"><div><span className="overline">SERVICE → INNGEST</span><h1>Events</h1><p>The lab saves each event, then attempts to notify Inngest. A waiting run may wake and read current state; check Activity to confirm.</p></div><span className="quiet-count">{data?.events.length ?? 0} recent</span></div><EventFeed events={data?.events ?? []} /></div>}

      {route === "/admin" && <div className="simulator-page"><div className="page-heading"><div><span className="overline">WORKSHOP CONTROL ROOM</span><h1>Simulator</h1><p>Set up an incident, give the agent a goal, and send a finite batch of service events.</p></div></div><div className="simulator-steps">
        <section className="sim-step"><div className="step-number">1</div><div className="step-content"><div className="step-head"><div><h2>Create a scenario</h2><p>This creates a fresh simulated checkout service. Previous runs stay in the database, but this screen shows the current scenario.</p></div>{lab && <span className="step-status">Current: {SCENARIO_LABELS[lab.scenario]}</span>}</div><div className="control-row"><label className="control-field">Incident type<select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>{SCENARIOS.map((item) => <option key={item} value={item}>{SCENARIO_LABELS[item]}</option>)}</select></label><button className="button button-secondary" disabled={busy} onClick={() => { setSelectedRunId(null); setSelectedMessageId(null); void act("/api/lab/reset", { scenario, seed: 1 }); }}><RotateCcw size={14} /> Create scenario</button></div>{lab && <div className="scenario-facts"><span>Release <strong>{lab.release}</strong></span><span>Feature <strong>{lab.featureEnabled ? "on" : "off"}</strong></span><span>Dependency <strong>{lab.upstreamHealthy ? "available" : "unavailable"}</strong></span><span>Condition <strong>{lab.healthy ? "healthy" : "degraded"}</strong></span></div>}<p className="fine-print">Health here is generated from scenario state, not measured from real traffic.</p></div></section>
        <section className="sim-step"><div className="step-number">2</div><div className="step-content"><div className="step-head"><div><h2>Start one agent run</h2><p>A goal starts one durable run. Later service events can wake it; they do not start a new agent for each event.</p></div>{activeRun && <span className="step-status">{label(activeRun.status)}</span>}</div>{activeRun ? <div className="active-run-line"><span><Zap size={15} /> Run {activeRun.id.slice(0, 8)} is {label(activeRun.status)}</span><Link to="/activity">View activity <ArrowRight size={13} /></Link></div> : <><label className="control-field full-field">Agent goal<textarea aria-label="Agent goal" value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} /></label><button className="button button-primary" disabled={!lab || busy || goal.trim().length < 12} onClick={() => lab && void act("/api/runs/start", { labId: lab.id, goal })}><Play size={14} /> Start agent</button></>}</div></section>
        <section className="sim-step"><div className="step-number">3</div><div className="step-content"><div className="step-head"><div><h2>Compose events</h2><p>Choose how many signals the service emits and how far apart. One event is the quickest way to test a wakeup.</p></div></div><div className="control-row"><label className="control-field small-field">Number of events<input aria-label="Number of events" type="number" min="1" max="100" value={total} onChange={(event) => setTotal(Number(event.target.value))} /></label><label className="control-field small-field">Interval<select aria-label="Event interval" value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))}><option value={250}>250 ms</option><option value={500}>500 ms</option><option value={1000}>1 second</option><option value={2000}>2 seconds</option><option value={5000}>5 seconds</option></select></label></div><div className="mode-switch"><button className={!mixMode ? "selected" : ""} onClick={() => setMixMode(false)}>One event type</button><button className={mixMode ? "selected" : ""} onClick={() => setMixMode(true)}>Mix types</button></div>{mixMode ? <div className="weight-grid">{EVENT_TYPES.map((type) => <label key={type}><span>{label(type)}</span><div><input aria-label={`${label(type)} percentage`} type="number" min="0" max="100" value={weights[type]} onChange={(event) => setWeights((current) => ({ ...current, [type]: Number(event.target.value) }))} /><span>%</span></div></label>)}<div className={`weight-total ${weightTotal === 100 ? "valid" : "invalid"}`}>Total {weightTotal}% {weightTotal !== 100 && "· must equal 100%"}</div></div> : <label className="control-field full-field">Event type<select aria-label="Event type" value={singleType} onChange={(event) => setSingleType(event.target.value as EventType)}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></label>}<p className="fine-print">Health events create observations. The agent needs fresh health observations to verify recovery.</p></div></section>
        <section className="sim-step"><div className="step-number">4</div><div className="step-content"><div className="step-head"><div><h2>Send the batch</h2><p>The lab emits on the server, even if you close this tab. Each event is saved and sent toward Inngest.</p></div></div><div className="send-summary">{total === 1 ? "Send one" : `Send ${total}`} {mixMode ? "mixed events" : `${label(singleType)} event${total === 1 ? "" : "s"}`}{total > 1 ? ` · ${intervalMs < 1000 ? `${intervalMs} ms` : `${intervalMs / 1000} s`} apart` : ""}</div>{plan?.status === "running" ? <div className="plan-progress"><div><strong>{plan.sent} / {plan.total} sent</strong><span>{Math.round(plan.sent / plan.total * 100)}%</span></div><progress value={plan.sent} max={plan.total} /><button className="button button-secondary" disabled={busy || !lab} onClick={() => lab && void act("/api/lab/plan/stop", { labId: lab.id })}><Pause size={14} /> Stop batch</button></div> : <div className="send-actions"><button className="button button-primary" disabled={!canSend} onClick={() => lab && void act("/api/lab/plan", { labId: lab.id, total, intervalMs, weights: effectiveWeights })}><Send size={14} /> Send events</button>{plan && <span>Last batch: {plan.sent}/{plan.total} {plan.status}</span>}</div>}<div className="after-send"><Link to="/events">Inspect events <ArrowRight size={13} /></Link><Link to="/activity">Inspect agent activity <ArrowRight size={13} /></Link><Link to="/">Open inbox <ArrowRight size={13} /></Link></div></div></section>
      </div><div className="simulator-tools"><div><h2>Failure drill</h2><p>Commit the next tool effect, then lose its acknowledgement. Watch the agent retry using the same action ID.</p><button className="button button-secondary" disabled={!lab || busy || lab.failNextAction} onClick={() => lab && void act("/api/lab/fault", { labId: lab.id, enabled: true })}>{lab?.failNextAction ? "Failure armed" : "Arm lost response"}</button></div>{lab?.scenario === "upstream-outage" && <div><h2>External recovery</h2><p>The agent cannot fix the payment gateway locally. Simulate its recovery after answering the help request.</p><button className="button button-secondary" disabled={busy || lab.upstreamHealthy} onClick={() => void act("/api/lab/recover", { labId: lab.id })}>Recover dependency <ArrowRight size={13} /></button></div>}</div></div>}
    </div></main>
  </div>;
}

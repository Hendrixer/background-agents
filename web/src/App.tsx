import { useEffect, useState } from "react";
import {
  Activity, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, CircleCheck,
  CirclePause, Clock3, Command, Gauge, HeartPulse, ListFilter, Pause, Play,
  RotateCcw, Send, Settings2, ShieldCheck, Square, StepForward, Terminal, Zap,
} from "lucide-react";
import { EVENT_TYPES, SCENARIOS, type EventType, type LabSnapshot, type Scenario } from "../../shared/types";

type Event = { id: string; type: string; data: Record<string, unknown>; createdAt: string };
type Observation = { id: string; healthy: boolean; errorRate: number; createdAt: string };
type Run = { id: string; goal: string; status: string; iteration: number; waitReason: string | null; report: string | null; startedAt: string };
type Approval = { id: string; action: string; input: Record<string, unknown>; status: string; reason: string | null; expiresAt: string };
type Timeline = { id: string; kind: string; message: string; detail: Record<string, unknown> | null; createdAt: string };
type Dashboard = { lab: LabSnapshot; events: Event[]; observations: Observation[]; runs: Run[]; approvals: Approval[]; timeline: Timeline[] };

const SCENARIO_LABELS: Record<Scenario, string> = {
  "feature-rollout": "Feature rollout",
  "faulty-release": "Faulty release",
  "upstream-outage": "Upstream outage",
};

const DEFAULT_GOAL = "Restore checkout service health. Investigate the incident, request approval for disruptive actions, verify recovery from fresh observations, and write an incident report.";

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data as T;
}

function time(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function readable(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function Badge({ label, tone = "muted" }: { label: string; tone?: "good" | "bad" | "warn" | "muted" }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" />{label}</span>;
}

function IconButton({ title, onClick, children, disabled = false }: { title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button className="icon-button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("feature-rollout");
  const [rate, setRate] = useState(1);
  const [types, setTypes] = useState<EventType[]>(["health", "log"]);
  const [singleType, setSingleType] = useState<EventType>("health");
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [helpAnswer, setHelpAnswer] = useState("");

  async function refresh() {
    try {
      const next = await request<Dashboard>("/api/dashboard");
      setData(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load lab");
    }
  }

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!data) return;
    setRate(data.lab.rate);
    setTypes(data.lab.eventTypes);
    setScenario(data.lab.scenario);
  }, [data?.lab.id]);

  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await request(path, body);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleType(type: EventType) {
    if (types.includes(type)) {
      if (types.length > 1) setTypes(types.filter((item) => item !== type));
      return;
    }
    setTypes([...types, type]);
  }

  const lab = data?.lab;
  const run = data?.runs[0];
  const pending = data?.approvals.find((approval) => approval.status === "pending");
  const lastEvent = data?.events[0];
  const healthy = lab?.healthy ?? false;
  const activeRun = run && !["completed", "failed", "cancelled", "escalated"].includes(run.status);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Activity size={18} strokeWidth={2.4} /></div><span>incident<span className="brand-dim">lab</span></span></div>
      <div className="workspace-switch"><span className="workspace-icon">M</span><div><strong>Master.dev</strong><small>Background Agents</small></div><ChevronDown size={14} /></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="side-nav">
        <a className="selected" href="#overview"><Gauge size={16} /> Overview</a>
        <a href="#agent"><Zap size={16} /> Agent run</a>
        <a href="#simulator"><Settings2 size={16} /> Simulator</a>
        <a href="#timeline"><ListFilter size={16} /> Timeline</a>
      </nav>
      <div className="sidebar-section-label sidebar-section-label-spaced">RESOURCES</div>
      <nav className="side-nav">
        <a href="http://127.0.0.1:8288" target="_blank" rel="noreferrer"><Activity size={16} /> Inngest traces <ArrowUpRight className="nav-external" size={13} /></a>
        <a href="http://127.0.0.1:5174" target="_blank" rel="noreferrer"><Terminal size={16} /> Lesson notes <ArrowUpRight className="nav-external" size={13} /></a>
      </nav>
      <div className="sidebar-bottom"><div className="system-dot" /><div><strong>Local environment</strong><span>Lab running on your machine</span></div></div>
    </aside>

    <main id="overview" className="main-content">
      <header className="topbar"><div className="breadcrumbs">WORKSPACE <span>/</span> INCIDENT LAB <span>/</span> <strong>OVERVIEW</strong></div><div className="topbar-right"><span className="local-pill"><span /> LOCAL</span><span className="shortcut"><Command size={12} /> WORKSHOP</span></div></header>

      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">BACKGROUND AGENTS · LIVE WORKSHOP</div><h1>Incident overview</h1><p>Watch an agent investigate, pause, recover, and complete its goal.</p></div><div className="heading-actions"><IconButton title="Refresh dashboard" onClick={() => void refresh()}><RotateCcw size={16} /></IconButton><button className="button button-primary" onClick={() => void act("/api/lab/reset", { scenario, seed: 1 })} disabled={busy}><RotateCcw size={14} /> Reset scenario</button></div></div>

        {error && <div className="error-banner"><CircleAlert size={16} />{error}<button onClick={() => setError("")}>Dismiss</button></div>}

        <section className="metric-grid" aria-label="Current status">
          <div className="metric-card"><div className="metric-top"><span>Service health</span><HeartPulse size={16} /></div><strong className={healthy ? "metric-good" : "metric-bad"}>{lab ? healthy ? "Healthy" : "Degraded" : "Loading"}</strong><div className="metric-bottom"><Badge label={lab ? `${lab.errorRate}% error rate` : "Waiting"} tone={healthy ? "good" : "bad"} /><span>CHECKOUT</span></div></div>
          <div className="metric-card"><div className="metric-top"><span>Agent status</span><Zap size={16} /></div><strong>{run ? readable(run.status) : "Idle"}</strong><div className="metric-bottom"><span>{run ? `Decision ${run.iteration}` : "Awaiting a goal"}</span><span>AGENT</span></div></div>
          <div className="metric-card"><div className="metric-top"><span>Event stream</span><Activity size={16} /></div><strong>{lab?.running ? "Streaming" : "Paused"}</strong><div className="metric-bottom"><span>{lastEvent ? `Last event ${time(lastEvent.createdAt)}` : "No events yet"}</span><span>{lab?.rate || 1}/SEC</span></div></div>
          <div className="metric-card"><div className="metric-top"><span>Human gate</span><ShieldCheck size={16} /></div><strong>{pending ? "Action needed" : "Clear"}</strong><div className="metric-bottom"><Badge label={pending ? readable(pending.action) : "No pending approvals"} tone={pending ? "warn" : "muted"} /><span>HITL</span></div></div>
        </section>

        <div className="content-grid">
          <div className="left-column">
            <section className="panel health-panel"><div className="panel-header"><div><span className="panel-kicker">SERVICE</span><h2>Checkout health</h2></div><Badge label={healthy ? "Operational" : "Incident active"} tone={healthy ? "good" : "bad"} /></div>
              <div className="health-chart"><div className="chart-grid"><span>50%</span><span>25%</span><span>0%</span></div><div className="bars">{Array.from({ length: 22 }, (_, index) => { const item = data?.observations.slice().reverse()[index]; const value = item?.errorRate ?? (lab?.errorRate || 0); return <div key={index} className={`bar ${value > 10 ? "bar-bad" : "bar-good"}`} style={{ height: `${Math.max(5, value * 1.65)}%` }} title={`${value}% errors`} />; })}</div></div>
              <div className="chart-caption"><span>ERROR RATE · RECENT OBSERVATIONS</span><span><span className="legend-dot" /> Current {lab?.errorRate ?? "—"}%</span></div>
              <div className="service-facts"><div><span>Release</span><strong>{lab?.release || "—"}</strong></div><div><span>Feature flag</span><strong>{lab?.featureEnabled ? "Enabled" : "Disabled"}</strong></div><div><span>Dependency</span><strong>{lab?.upstreamHealthy ? "Available" : "Unavailable"}</strong></div><div><span>Last observation</span><strong>{time(lab?.lastObservationAt)}</strong></div></div>
            </section>

            <section id="simulator" className="panel simulator-panel"><div className="panel-header"><div><span className="panel-kicker">CONTROL ROOM</span><h2>Event simulator</h2></div><span className="panel-note">Server-side producer</span></div>
              <div className="field-grid"><label className="field"><span>Scenario</span><select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>{SCENARIOS.map((item) => <option key={item} value={item}>{SCENARIO_LABELS[item]}</option>)}</select></label><label className="field"><span>Single event</span><select value={singleType} onChange={(event) => setSingleType(event.target.value as EventType)}>{EVENT_TYPES.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label></div>
              <div className="field"><div className="field-heading"><span>Event types</span><span className="field-hint">Selected for stream</span></div><div className="chip-row">{EVENT_TYPES.map((item) => <button key={item} className={`chip ${types.includes(item) ? "chip-selected" : ""}`} onClick={() => toggleType(item)}><span className="chip-check">{types.includes(item) && <Check size={11} />}</span>{readable(item)}</button>)}</div></div>
              <div className="rate-row"><div><span>Event rate</span><small>Keep it slow enough to inspect each event.</small></div><div className="rate-control"><input aria-label="Events per second" type="range" min="1" max="5" value={rate} onChange={(event) => setRate(Number(event.target.value))} /><strong>{rate}<span>/sec</span></strong></div></div>
              <div className="sim-actions"><button className="button button-primary" disabled={!lab || busy} onClick={() => lab && void act("/api/lab/config", { labId: lab.id, rate, eventTypes: types, running: !lab.running })}>{lab?.running ? <Pause size={14} /> : <Play size={14} />}{lab?.running ? "Stop events" : "Start events"}</button><button className="button button-secondary" disabled={!lab || busy} onClick={() => lab && void act("/api/lab/config", { labId: lab.id, rate, eventTypes: types, running: lab.running })}>Apply settings</button><button className="button button-secondary" disabled={!lab || busy} onClick={() => lab && void act("/api/lab/emit", { labId: lab.id, type: singleType })}><StepForward size={14} /> Emit one</button><button className="button button-secondary" disabled={!lab || busy} onClick={() => lab && void act("/api/lab/emit", { labId: lab.id, type: singleType, count: 8 })}>Burst ×8</button></div>
              <div className="fault-row"><div><strong>Lose the next tool response</strong><span>The action commits, then its HTTP response fails once. Watch the agent retry with the same action ID.</span></div><button className="button button-secondary" disabled={!lab || busy || lab.failNextAction} onClick={() => lab && void act("/api/lab/fault", { labId: lab.id, enabled: true })}>{lab?.failNextAction ? "Armed" : "Arm failure"}</button></div>
              {lab?.scenario === "upstream-outage" && <button className="text-action" onClick={() => void act("/api/lab/recover", { labId: lab.id })}>Simulate upstream recovery <ArrowRight size={13} /></button>}
            </section>
          </div>

          <div id="agent" className="right-column">
            <section className="panel agent-panel"><div className="panel-header"><div><span className="panel-kicker">DURABLE RUN</span><h2>Agent goal</h2></div><span className="panel-icon"><Zap size={16} /></span></div>
              {activeRun ? <><div className="run-state"><span className="run-state-icon"><CirclePause size={18} /></span><div><strong>{readable(run.status)}</strong><span>{run.waitReason || `Working through decision ${run.iteration}`}</span></div></div><div className="goal-readonly">{run.goal}</div><div className="run-meta"><span><Clock3 size={13} /> Started {time(run.startedAt)}</span><span>Run {run.id.slice(0, 8)}</span></div><button className="button button-secondary full-width" disabled={busy} onClick={() => void act("/api/runs/cancel", { runId: run.id })}><Square size={13} /> Cancel run</button></> : <><p className="panel-description">Give the agent an outcome. The harness will decide when to act, wait, or ask for approval.</p><textarea aria-label="Agent goal" value={goal} onChange={(event) => setGoal(event.target.value)} rows={5} /><div className="goal-footer"><span>Works in the background</span><button className="button button-primary" disabled={!lab || busy || !goal.trim()} onClick={() => lab && void act("/api/runs/start", { labId: lab.id, goal })}><Send size={14} /> Start agent</button></div></>}
            </section>

            <section className="panel approval-panel"><div className="panel-header"><div><span className="panel-kicker">HUMAN IN THE LOOP</span><h2>Approval gate</h2></div><ShieldCheck size={17} className="muted-icon" /></div>
              {pending ? <><div className="approval-flag"><CircleAlert size={14} /> {pending.action === "request_help" ? "Waiting for your answer" : "Waiting for your decision"}</div><div className="approval-action"><span>{pending.action === "request_help" ? "QUESTION" : "PROPOSED ACTION"}</span><strong>{readable(pending.action)}</strong><pre>{JSON.stringify(pending.input, null, 2)}</pre></div><div className="approval-expiry">Expires {new Date(pending.expiresAt).toLocaleString()}</div>{pending.action === "request_help" && <textarea className="help-answer" aria-label="Answer to agent" value={helpAnswer} onChange={(event) => setHelpAnswer(event.target.value)} placeholder="What did you learn about the dependency?" rows={3} />}<div className="approval-buttons"><button className="button button-primary" disabled={busy || (pending.action === "request_help" && !helpAnswer.trim())} onClick={() => void act("/api/approvals/decide", { approvalId: pending.id, decision: "approved", reason: pending.action === "request_help" ? helpAnswer.trim() : undefined })}><Check size={14} /> {pending.action === "request_help" ? "Send answer" : "Approve"}</button><button className="button button-secondary" disabled={busy} onClick={() => void act("/api/approvals/decide", { approvalId: pending.id, decision: "rejected" })}>{pending.action === "request_help" ? "Cannot help" : "Reject"}</button></div></> : <div className="empty-gate"><span><ShieldCheck size={23} /></span><strong>No approval needed</strong><p>Risky actions will pause here until a person decides.</p></div>}
            </section>

            <section className="panel report-panel"><div className="panel-header"><div><span className="panel-kicker">ARTIFACT</span><h2>Incident report</h2></div><ArrowUpRight size={16} className="muted-icon" /></div>{run?.report ? <div className="report-text">{run.report}</div> : <p className="panel-description">The agent's final assessment and actions will appear here when the run ends.</p>}</section>
          </div>
        </div>

        <section id="timeline" className="panel timeline-panel"><div className="panel-header"><div><span className="panel-kicker">OBSERVABILITY</span><h2>Run timeline</h2></div><span className="panel-note">Latest activity first</span></div>{data?.timeline.length ? <div className="timeline-list">{data.timeline.map((entry) => <details className="timeline-entry" key={entry.id}><summary><span className={`timeline-symbol timeline-${entry.kind}`}>{entry.kind === "action" ? <Zap size={13} /> : entry.kind === "event" ? <Activity size={13} /> : entry.kind === "approval" ? <ShieldCheck size={13} /> : <CircleCheck size={13} />}</span><span className="timeline-main"><strong>{entry.message}</strong><small>{readable(entry.kind)}</small></span><time>{time(entry.createdAt)}</time><ChevronDown size={14} className="timeline-chevron" /></summary>{entry.detail && <pre>{JSON.stringify(entry.detail, null, 2)}</pre>}</details>)}</div> : <div className="empty-timeline"><Activity size={20} /><span>Events and agent decisions will appear here.</span></div>}</section>

        <footer className="page-footer"><span><span className="footer-mark">●</span> INCIDENT LAB <span className="footer-separator">/</span> BACKGROUND AGENTS</span><span>SIMULATED ENVIRONMENT · LOCAL ONLY</span></footer>
      </div>
    </main>
  </div>;
}

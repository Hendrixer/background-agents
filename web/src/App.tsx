import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Bell,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Eye,
  Inbox,
  MessageCircle,
  Pause,
  Play,
  Send,
  ShieldAlert,
  Square,
  Target,
  Wrench,
  Zap,
} from 'lucide-react'

type ServiceEvent = {
  id: string
  runId: string | null
  instanceId: string | null
  type: string
  data: Record<string, unknown>
  createdAt: string
}
type Run = {
  id: string
  eventId: string
  instanceId: string | null
  eventSequence: number
  goal: string
  status: string
  iteration: number
  waitReason: string | null
  report: string | null
  startedAt: string
}
type Approval = {
  id: string
  runId: string
  action: string
  input: Record<string, unknown>
  status: string
  reason: string | null
  createdAt: string
  expiresAt: string
  decidedAt: string | null
}
type ActivityEntry = {
  id: string
  kind: string
  message: string
  detail: Record<string, unknown> | null
  createdAt: string
}
type ServiceSnapshot = { instanceId: string; version: number; state: Record<string, unknown> }
type Dashboard = {
  service: ServiceSnapshot | null
  events: ServiceEvent[]
  runs: Run[]
  approvals: Approval[]
}

const NAV = [
  { path: '/', label: 'Inbox', icon: Inbox },
  { path: '/activity', label: 'Activity', icon: Activity },
  { path: '/events', label: 'Events', icon: Bell },
] as const

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(
      path,
      body === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    )
  } catch {
    throw new Error('Cannot reach the operator API. Start npm run dev:operator and try again.')
  }
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(`The operator API returned an unexpected response (${response.status}).`)
  const data = await response.json().catch(() => {
    throw new Error('The operator API returned an incomplete response.')
  })
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`)
  return data as T
}
const time = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—'
const label = (value: string) =>
  value.replaceAll('agent:', '').replaceAll('_', ' ').replaceAll('-', ' ')
const terminal = (status: string) =>
  ['completed', 'cancelled', 'failed', 'escalated', 'superseded'].includes(status)
const pretty = (value: unknown) => JSON.stringify(value, null, 2)

function Link({
  to,
  children,
  className = '',
  title,
}: {
  to: string
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <a
      href={to}
      className={className}
      title={title}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return
        event.preventDefault()
        window.history.pushState(null, '', to)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }}
    >
      {children}
    </a>
  )
}

const PHASE_ICONS = {
  start: Target,
  observe: Eye,
  loop: Activity,
  predict: BrainCircuit,
  act: Wrench,
  pause: Pause,
  resume: Play,
  human: MessageCircle,
  terminal: CheckCircle2,
  policy: ShieldAlert,
  event: Bell,
} as const
function phaseOf(entry: ActivityEntry) {
  return entry.kind.startsWith('agent:') ? entry.kind.slice(6) : entry.kind
}
function activityDetail(entry: ActivityEntry) {
  const detail = entry.detail ?? {}
  const phase = phaseOf(entry)
  if (phase === 'observe')
    return `State version ${detail.version ?? '—'} · open payload to inspect the observed state`
  if (phase === 'predict') return String(detail.reason ?? 'The agent chose its next action.')
  if (phase === 'act')
    return String(
      detail.error ??
        (detail.actionId
          ? `Action ${String(detail.actionId).slice(0, 24)}…`
          : 'Tool result saved.'),
    )
  if (phase === 'pause' || phase === 'terminal')
    return String(detail.waitReason ?? 'The run reached a durable state.')
  if (phase === 'human')
    return String(detail.question ?? detail.reason ?? 'Human request or decision recorded.')
  if (phase === 'start') return String(detail.goal ?? 'A service alert opened this incident.')
  if (phase === 'resume') return 'The harness read current state again.'
  if (phase === 'event')
    return String(
      (detail.data as Record<string, unknown> | undefined)?.summary ??
        'The service sent another event for this incident.',
    )
  return ''
}
function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (!entries.length)
    return <div className='empty-state'>No activity recorded for this run yet.</div>
  return (
    <div className='activity-feed'>
      {entries.map((entry) => {
        const phase = phaseOf(entry)
        const Icon = PHASE_ICONS[phase as keyof typeof PHASE_ICONS] ?? Zap
        return (
          <article className={`activity-entry phase-${phase}`} key={entry.id}>
            <div className='activity-rail'>
              <span className='activity-icon'>
                <Icon size={15} strokeWidth={1.8} />
              </span>
            </div>
            <div className='activity-body'>
              <div className='activity-meta'>
                <span>{label(phase)}</span>
                <time>{time(entry.createdAt)}</time>
              </div>
              <h3>{entry.message}</h3>
              <p>{activityDetail(entry)}</p>
              {entry.detail && Object.keys(entry.detail).length > 0 && (
                <details className='payload'>
                  <summary>
                    View payload <ChevronDown size={12} />
                  </summary>
                  <pre>{pretty(entry.detail)}</pre>
                </details>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
function EventFeed({ events }: { events: ServiceEvent[] }) {
  if (!events.length) return <div className='empty-state'>No service events received yet.</div>
  return (
    <div className='event-feed'>
      {events.map((event) => (
        <details className='event-entry' key={event.id}>
          <summary>
            <span className='event-type'>
              <Bell size={14} />
            </span>
            <span className='event-name'>
              <strong>{label(event.type)}</strong>
              <small>
                {event.runId ? `Incident ${event.runId.slice(0, 8)}` : 'No incident opened'} · event{' '}
                {event.id.slice(0, 8)}
              </small>
            </span>
            <time>{time(event.createdAt)}</time>
            <ChevronDown size={14} />
          </summary>
          <pre>{pretty(event.data)}</pre>
        </details>
      ))}
    </div>
  )
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  const route = NAV.some((item) => item.path === path) ? path : '/'
  const [data, setData] = useState<Dashboard | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [inboxFilter, setInboxFilter] = useState<'pending' | 'resolved'>('pending')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const update = () => setPath(window.location.pathname)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  async function refresh() {
    try {
      const next = await request<Dashboard>('/api/dashboard')
      setData(next)
      if (route === '/activity') {
        const runId = next.runs.find((item) => item.id === selectedRunId)?.id ?? next.runs[0]?.id
        setActivity(runId ? await request<ActivityEntry[]>(`/api/runs/${runId}/activity`) : [])
      }
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load dashboard')
    }
  }
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    return () => clearInterval(timer)
  }, [route, selectedRunId])
  async function act(actionPath: string, body: unknown, success: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await request(actionPath, body)
      await refresh()
      setNotice(success)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const runs = data?.runs ?? []
  const run = runs.find((item) => item.id === selectedRunId) ?? runs[0]
  const approvals = data?.approvals ?? []
  const pending = approvals.filter(
    (item) =>
      item.status === 'pending' &&
      runs.some((run) => run.id === item.runId && !terminal(run.status)),
  )
  const filteredMessages = approvals.filter((item) =>
    inboxFilter === 'pending'
      ? pending.some((request) => request.id === item.id)
      : item.status !== 'pending',
  )
  const message =
    filteredMessages.find((item) => item.id === selectedMessageId) ?? filteredMessages[0]
  const title = route === '/' ? 'Inbox' : route === '/activity' ? 'Activity' : 'Events'

  return (
    <div className='app-shell'>
      <aside className='sidebar'>
        <Link to='/' className='brand-mark' title='Checkout operations'>
          <Activity size={20} />
        </Link>
        <nav className='side-nav' aria-label='Operations'>
          {NAV.map(({ path: itemPath, label: name, icon: Icon }) => (
            <Link
              key={itemPath}
              to={itemPath}
              title={name}
              className={route === itemPath ? 'selected' : ''}
            >
              <Icon size={20} strokeWidth={1.7} />
              <span className='sr-only'>{name}</span>
              {itemPath === '/' && pending.length > 0 && (
                <span className='nav-count'>{pending.length}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className='sidebar-bottom' title='Local workshop environment'>
          <span className='live-dot' />
        </div>
      </aside>
      <main className='main-content'>
        <header className='topbar'>
          <span>
            CHECKOUT OPS <span className='topbar-slash'>/</span> {title.toUpperCase()}
          </span>
          <div className='topbar-links'>
            <a href='http://127.0.0.1:8288' target='_blank' rel='noreferrer'>
              Inngest traces ↗
            </a>
            <a href='http://127.0.0.1:5174' target='_blank' rel='noreferrer'>
              Lesson notes ↗
            </a>
          </div>
        </header>
        <div className={`page-content${route === '/activity' ? ' page-content-activity' : ''}`}>
          {error && (
            <div className='error-banner'>
              <CircleAlert size={16} />
              {error}
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          )}
          {notice && !error && <div className='notice-banner'>{notice}</div>}

          {route === '/' && (
            <div className='inbox-layout'>
              <div className='mailbox'>
                <div className='mailbox-heading'>
                  <h1>Inbox</h1>
                  <span>
                    {pending.length === 0
                      ? 'No requests need a response'
                      : `${pending.length} request${pending.length === 1 ? '' : 's'} need a response`}
                  </span>
                </div>
                <div className='mailbox-filters'>
                  <button
                    className={inboxFilter === 'pending' ? 'active' : ''}
                    onClick={() => {
                      setInboxFilter('pending')
                      setSelectedMessageId(null)
                    }}
                  >
                    Needs response <span>{pending.length}</span>
                  </button>
                  <button
                    className={inboxFilter === 'resolved' ? 'active' : ''}
                    onClick={() => {
                      setInboxFilter('resolved')
                      setSelectedMessageId(null)
                    }}
                  >
                    Resolved <span>{approvals.length - pending.length}</span>
                  </button>
                </div>
                <div className='message-list'>
                  {filteredMessages.length ? (
                    filteredMessages.map((item) => (
                      <button
                        key={item.id}
                        className={`message-row ${message?.id === item.id ? 'selected' : ''}`}
                        onClick={() => setSelectedMessageId(item.id)}
                      >
                        <span className='message-avatar'>
                          <Zap size={14} />
                        </span>
                        <span className='message-copy'>
                          <span className='message-row-top'>
                            <strong>Background agent</strong>
                            <time>{time(item.createdAt)}</time>
                          </span>
                          <b>
                            {item.action === 'request_help'
                              ? 'Needs your answer'
                              : `Approve ${label(item.action)}?`}
                          </b>
                          <small>
                            Run {item.runId.slice(0, 8)} · {label(item.action)}
                          </small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className='mailbox-empty'>
                      {inboxFilter === 'pending'
                        ? 'Nothing needs your response. New requests appear here when an agent pauses.'
                        : 'No past responses yet.'}
                    </div>
                  )}
                </div>
              </div>
              <div className='reading-pane'>
                {message ? (
                  <>
                    <div className='reading-header'>
                      <span className='overline'>
                        {message.status === 'pending' ? 'NEEDS RESPONSE' : 'RESOLVED'} · RUN{' '}
                        {message.runId.slice(0, 8)}
                      </span>
                      <h2>
                        {message.action === 'request_help'
                          ? 'The agent needs information'
                          : `Approval: ${label(message.action)}`}
                      </h2>
                      <p>
                        Background agent <span>·</span>{' '}
                        {message.status === 'pending'
                          ? `Expires ${new Date(message.expiresAt).toLocaleString()}`
                          : `${label(message.status)} at ${time(message.decidedAt)}`}
                      </p>
                    </div>
                    <div className='conversation'>
                      <div className='conversation-entry'>
                        <span className='message-avatar'>
                          <Zap size={14} />
                        </span>
                        <div>
                          <div className='conversation-author'>
                            Background agent <span>· Request</span>
                          </div>
                          <p>
                            {message.action === 'request_help'
                              ? String(message.input.question || 'What should I do next?')
                              : `I propose ${label(message.action)}. Please review the exact action before I proceed.`}
                          </p>
                          {message.action !== 'request_help' && (
                            <div className='action-detail'>
                              <span>PROPOSED TOOL INPUT</span>
                              <pre>{pretty(message.input)}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                      {message.status !== 'pending' && (
                        <div className='conversation-entry human-entry'>
                          <span className='message-avatar'>
                            <Check size={14} />
                          </span>
                          <div>
                            <div className='conversation-author'>
                              You <span>· {label(message.status)}</span>
                            </div>
                            <p>{message.reason || label(message.status)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                    {message.status === 'pending' && (
                      <div className='reply-composer'>
                        <label htmlFor='reply-input'>
                          {message.action === 'request_help'
                            ? 'Reply to the agent'
                            : 'Decision note (optional)'}
                        </label>
                        <textarea
                          id='reply-input'
                          value={answers[message.id] ?? ''}
                          onChange={(event) =>
                            setAnswers((current) => ({
                              ...current,
                              [message.id]: event.target.value,
                            }))
                          }
                          placeholder='Add context for the agent…'
                          rows={4}
                        />
                        <div className='composer-actions'>
                          <button
                            className='button button-secondary'
                            disabled={busy}
                            onClick={() =>
                              void act(
                                '/api/approvals/decide',
                                {
                                  approvalId: message.id,
                                  decision: 'rejected',
                                  reason: (answers[message.id] ?? '').trim() || undefined,
                                },
                                'Decision sent.',
                              )
                            }
                          >
                            {message.action === 'request_help' ? 'Cannot help' : 'Deny'}
                          </button>
                          <button
                            className='button button-primary'
                            disabled={
                              busy ||
                              (message.action === 'request_help' &&
                                !(answers[message.id] ?? '').trim())
                            }
                            onClick={() =>
                              void act(
                                '/api/approvals/decide',
                                {
                                  approvalId: message.id,
                                  decision: 'approved',
                                  reason: (answers[message.id] ?? '').trim() || undefined,
                                },
                                'Response sent.',
                              )
                            }
                          >
                            <Send size={14} />
                            {message.action === 'request_help' ? 'Send answer' : 'Approve action'}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className='reading-footer'>
                      <Link to='/activity'>
                        View run activity <ArrowRight size={14} />
                      </Link>
                    </div>
                  </>
                ) : (
                  <div className='reading-empty'>
                    <Inbox size={30} />
                    <h2>{inboxFilter === 'pending' ? 'All caught up' : 'No resolved requests'}</h2>
                    <p>
                      When the agent needs approval or information, its message will appear here.
                    </p>
                    <Link to='/activity'>
                      View activity <ArrowRight size={14} />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {route === '/activity' && (
            <div className='activity-layout'>
              <div className='run-list-pane'>
                <div className='list-heading'>
                  <span className='overline'>BACKGROUND WORK</span>
                  <h1>Activity</h1>
                  <p>
                    {runs.length} incident investigation{runs.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className='run-list'>
                  {runs.length ? (
                    runs.map((item) => (
                      <button
                        key={item.id}
                        className={`run-list-item ${run?.id === item.id ? 'selected' : ''}`}
                        onClick={() => setSelectedRunId(item.id)}
                      >
                        <span
                          className={`run-dot ${terminal(item.status) ? item.status : 'active'}`}
                        />
                        <span>
                          <strong>{item.goal}</strong>
                          <small>
                            {time(item.startedAt)} · {label(item.status)} · {item.id.slice(0, 8)} ·{' '}
                            {item.eventSequence} event{item.eventSequence === 1 ? '' : 's'}
                          </small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className='mailbox-empty'>
                      No investigations yet. Start the checkout service with a fault flag to
                      generate an alert.
                    </div>
                  )}
                </div>
                <Link to='/events' className='list-footer'>
                  View service events <ArrowRight size={13} />
                </Link>
              </div>
              <div className='run-detail-pane'>
                {run ? (
                  <>
                    <div className='run-detail-header'>
                      <div>
                        <span className='overline'>
                          INCIDENT RUN {run.id.slice(0, 8)} · SERVICE INSTANCE{' '}
                          {run.instanceId?.slice(0, 8)}
                        </span>
                        <h2>{label(run.status)}</h2>
                        <p>{run.goal}</p>
                        <div className='run-subline'>
                          Started {time(run.startedAt)} · Decision {run.iteration} ·{' '}
                          {run.eventSequence} event{run.eventSequence === 1 ? '' : 's'}
                          {run.waitReason ? ` · ${run.waitReason}` : ''}
                        </div>
                      </div>
                      {!terminal(run.status) && (
                        <button
                          className='button button-secondary'
                          disabled={busy}
                          onClick={() =>
                            void act('/api/runs/cancel', { runId: run.id }, 'Run cancelled.')
                          }
                        >
                          <Square size={13} /> Cancel run
                        </button>
                      )}
                    </div>
                    <div className='feed-heading'>
                      <h3>Run activity</h3>
                      <span>Persisted per incident · newest first</span>
                    </div>
                    <div className='run-detail-content'>
                      <ActivityFeed entries={activity} />
                      {run.report && (
                        <section className='report-section'>
                          <h3>Report</h3>
                          <div>{run.report}</div>
                        </section>
                      )}
                    </div>
                  </>
                ) : (
                  <div className='reading-empty'>
                    <Activity size={28} />
                    <h2>No investigations yet</h2>
                    <p>
                      Start checkout with a fault. Its alert will open an incident and start the
                      agent.
                    </p>
                    <Link to='/events'>
                      View service events <ArrowRight size={14} />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {route === '/events' && (
            <div className='events-page'>
              <div className='page-heading'>
                <div>
                  <span className='overline'>CHECKOUT SERVICE → AGENT</span>
                  <h1>Events</h1>
                  <p>
                    The local checkout process sends these events. New alerts join an open incident;
                    the agent reads current state over HTTP rather than trusting an event payload.
                  </p>
                </div>
                <span className='quiet-count'>{data?.events.length ?? 0} recent</span>
              </div>
              {data?.service && (
                <details className='event-entry'>
                  <summary>
                    <span className='event-type'>
                      <Eye size={14} />
                    </span>
                    <span className='event-name'>
                      <strong>Current checkout state</strong>
                      <small>
                        Instance {data.service.instanceId.slice(0, 8)} · version{' '}
                        {data.service.version}
                      </small>
                    </span>
                    <ChevronDown size={14} />
                  </summary>
                  <pre>{pretty(data.service.state)}</pre>
                </details>
              )}
              <EventFeed events={data?.events ?? []} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, like } from 'drizzle-orm'
import { db } from './db'
import { actions, approvals, events, runs } from './schema'
import { inngest } from './inngest'
import { logAgentActivity } from './agent-log'
import { getLatestState } from './observe'
import type { ActionName, GoalCondition } from '../shared/types'

export async function getRun(runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1)
  if (!run) throw new Error('Agent run not found')
  return run
}

export async function setRun(
  runId: string,
  status: string,
  waitReason: string | null = null,
  report?: string,
) {
  const run = await getRun(runId)
  if (['completed', 'cancelled', 'failed', 'escalated', 'superseded'].includes(run.status))
    return run
  const [updated] = await db
    .update(runs)
    .set({ status, waitReason, report: report ?? run.report, updatedAt: new Date() })
    .where(eq(runs.id, runId))
    .returning()
  const phase = ['completed', 'cancelled', 'failed', 'escalated', 'superseded'].includes(status)
    ? 'terminal'
    : status === 'waiting'
      ? 'pause'
      : status.startsWith('needs_')
        ? 'human'
        : 'resume'
  if (status !== run.status || status === 'waiting') {
    await logAgentActivity(run.environmentId, runId, phase, `Run ${status.replaceAll('_', ' ')}`, {
      waitReason,
    })
  }
  return updated
}

export async function setIteration(runId: string, iteration: number) {
  await db
    .update(runs)
    .set({ iteration, status: 'running', waitReason: null, updatedAt: new Date() })
    .where(
      and(
        eq(runs.id, runId),
        inArray(runs.status, ['running', 'waiting', 'needs_approval', 'needs_help']),
      ),
    )
}

export async function cancelRun(runId: string) {
  const run = await setRun(runId, 'cancelled', 'Cancelled by operator')
  await inngest.send({ name: 'agent/run.cancelled', data: { runId } })
  return run
}

export async function agentState(environmentId: string, runId: string) {
  const [world, run, recentEvents, recentActions, recentApprovals] = await Promise.all([
    getLatestState(),
    getRun(runId),
    db
      .select()
      .from(events)
      .where(eq(events.runId, runId))
      .orderBy(desc(events.createdAt))
      .limit(8),
    db
      .select()
      .from(actions)
      .where(like(actions.id, `${runId}:%`))
      .orderBy(desc(actions.createdAt))
      .limit(8),
    db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId))
      .orderBy(desc(approvals.createdAt))
      .limit(4),
  ])

  const state = {
    environmentId,
    eventSequence: run.eventSequence,
    world,
    events: recentEvents.map((item) => ({
      type: item.type,
      data: item.data,
      at: item.createdAt.toISOString(),
    })),
    actions: recentActions.map((item) => ({
      id: item.id,
      name: item.name,
      input: item.input,
      result: item.result,
      at: item.createdAt.toISOString(),
    })),
    humanDecisions: recentApprovals
      .filter((item) => item.status !== 'pending')
      .map((item) => ({ action: item.action, status: item.status, answer: item.reason })),
  }

  if (run.environmentId !== environmentId) throw new Error('Run belongs to a different environment')
  if (world.instanceId !== run.instanceId)
    throw new Error('Checkout service restarted during this incident')
  if (run.status === 'waiting' || run.status.startsWith('needs_')) {
    await logAgentActivity(environmentId, runId, 'resume', 'Resumed and read current state', {
      afterDecision: run.iteration,
    })
  }
  await logAgentActivity(environmentId, runId, 'observe', 'Observed latest state', {
    version: world.version,
    state: world.state,
  })
  return state
}

export type AgentState = Awaited<ReturnType<typeof agentState>>

export function goalSatisfied(state: AgentState, condition: GoalCondition) {
  if (!condition) return false
  const value = condition.path
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      state.world.state,
    )
  return value === condition.equals
}

export async function recordDecision(
  environmentId: string,
  runId: string,
  iteration: number,
  action: string,
  reason: string,
) {
  await logAgentActivity(environmentId, runId, 'loop', `Decision cycle ${iteration}`, { iteration })
  await logAgentActivity(
    environmentId,
    runId,
    'predict',
    `Selected ${action.replaceAll('_', ' ')}`,
    { iteration, action, reason },
  )
}

export async function recordToolAction(
  environmentId: string,
  runId: string,
  actionId: string,
  name: ActionName,
  input: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  await db
    .insert(actions)
    .values({ id: actionId, environmentId, name, input, result })
    .onConflictDoNothing()
  await logAgentActivity(environmentId, runId, 'act', `${name.replaceAll('_', ' ')} returned`, {
    actionId,
    input,
    result,
  })
}

export async function proposeAction(
  environmentId: string,
  runId: string,
  actionId: string,
  action: ActionName,
  input: Record<string, unknown>,
) {
  const [proposal] = await db
    .insert(approvals)
    .values({
      id: randomUUID(),
      environmentId,
      runId,
      actionId,
      action,
      input,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60_000),
    })
    .returning()
  await setRun(
    runId,
    action === 'request_help' ? 'needs_help' : 'needs_approval',
    action === 'request_help'
      ? 'Waiting for an answer'
      : `Waiting for ${action.replaceAll('_', ' ')} approval`,
  )
  await logAgentActivity(
    environmentId,
    runId,
    'human',
    action === 'request_help'
      ? 'Asked a human for help'
      : `Requested approval for ${action.replaceAll('_', ' ')}`,
    { proposalId: proposal.id, ...input },
  )
  return proposal
}

export async function getProposal(proposalId: string) {
  const [proposal] = await db.select().from(approvals).where(eq(approvals.id, proposalId)).limit(1)
  if (!proposal) throw new Error('Approval request not found')
  if (proposal.status === 'pending' && proposal.expiresAt.getTime() < Date.now()) {
    const [expired] = await db
      .update(approvals)
      .set({ status: 'expired', decidedAt: new Date() })
      .where(eq(approvals.id, proposalId))
      .returning()
    return expired
  }
  return proposal
}

export async function decideProposal(
  proposalId: string,
  status: 'approved' | 'rejected',
  reason?: string,
) {
  const proposal = await getProposal(proposalId)
  if (proposal.status !== 'pending') return proposal
  const run = await getRun(proposal.runId)
  if (['completed', 'cancelled', 'failed', 'escalated', 'superseded'].includes(run.status)) {
    const [stale] = await db
      .update(approvals)
      .set({ status: 'stale', reason: 'Incident is no longer active', decidedAt: new Date() })
      .where(eq(approvals.id, proposalId))
      .returning()
    return stale
  }
  if (proposal.action === 'request_help' && status === 'approved' && !reason?.trim()) {
    throw new Error('An answer is required before the agent can continue')
  }
  const [updated] = await db
    .update(approvals)
    .set({ status, reason, decidedAt: new Date() })
    .where(and(eq(approvals.id, proposalId), eq(approvals.status, 'pending')))
    .returning()
  if (!updated) return getProposal(proposalId)
  await logAgentActivity(
    proposal.environmentId,
    proposal.runId,
    'human',
    proposal.action === 'request_help'
      ? status === 'approved'
        ? 'Human answered help request'
        : 'Human could not help'
      : `${proposal.action.replaceAll('_', ' ')} ${status}`,
    { proposalId, reason },
  )
  try {
    await inngest.send({
      name: 'agent/approval.decided',
      data: { proposalId, environmentId: proposal.environmentId, runId: proposal.runId },
    })
  } catch (error) {
    console.warn('Approval saved; wake event failed and the run will reconcile on timeout', error)
  }
  return updated
}

export async function staleProposal(proposalId: string) {
  const proposal = await getProposal(proposalId)
  await db
    .update(approvals)
    .set({ status: 'stale', reason: 'State changed before this action ran', decidedAt: new Date() })
    .where(eq(approvals.id, proposalId))
  await logAgentActivity(
    proposal.environmentId,
    proposal.runId,
    'human',
    'Approved action became stale',
    { proposalId },
  )
}

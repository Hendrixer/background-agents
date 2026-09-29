import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from './db'
import { configuredGoal, DEFAULT_CONDITION, ensureEnvironment } from './environment'
import { inngest } from './inngest'
import { getLatestState } from './observe'
import { approvals, environments, events, runs, timeline } from './schema'

const ACTIVE = ['running', 'waiting', 'needs_approval', 'needs_help']

type ServiceEventInput = {
  id: string
  serviceId: 'checkout'
  instanceId: string
  type: string
  data: Record<string, unknown>
}

export async function ingestServiceEvent(input: ServiceEventInput) {
  const environment = await ensureEnvironment()
  const world = await getLatestState()
  if (world.instanceId !== input.instanceId)
    throw new Error('Event belongs to an older checkout service instance')

  const outcome = await db.transaction(async (tx) => {
    await tx
      .select({ id: environments.id })
      .from(environments)
      .where(eq(environments.id, environment.id))
      .for('update')
    const [prior] = await tx.select().from(events).where(eq(events.id, input.id)).limit(1)
    if (prior) {
      const [run] = prior.runId
        ? await tx.select().from(runs).where(eq(runs.id, prior.runId)).limit(1)
        : []
      return {
        runId: prior.runId,
        dispatch: run ? (run.eventId === input.id ? 'opened' : 'updated') : null,
        superseded: [] as string[],
      }
    }

    const old = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.environmentId, environment.id),
          inArray(runs.status, ACTIVE),
          or(isNull(runs.instanceId), ne(runs.instanceId, input.instanceId)),
        ),
      )
    for (const run of old) {
      await tx
        .update(runs)
        .set({
          status: 'superseded',
          waitReason: 'Checkout service restarted with fresh state',
          updatedAt: new Date(),
        })
        .where(eq(runs.id, run.id))
      await tx
        .update(approvals)
        .set({ status: 'stale', reason: 'Checkout service restarted', decidedAt: new Date() })
        .where(and(eq(approvals.runId, run.id), eq(approvals.status, 'pending')))
      await tx.insert(timeline).values({
        id: randomUUID(),
        environmentId: environment.id,
        runId: run.id,
        kind: 'agent:terminal',
        message: 'Run superseded by service restart',
        detail: { newInstanceId: input.instanceId },
      })
    }

    let [run] = await tx
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.environmentId, environment.id),
          eq(runs.instanceId, input.instanceId),
          inArray(runs.status, ACTIVE),
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(1)
    let dispatch: 'opened' | 'updated' | null = run ? 'updated' : null
    const healthy =
      (world.state.health as Record<string, unknown> | undefined)?.status === 'healthy'
    if (!run && input.type !== 'service.started' && !healthy) {
      ;[run] = await tx
        .insert(runs)
        .values({
          id: randomUUID(),
          environmentId: environment.id,
          eventId: input.id,
          instanceId: input.instanceId,
          eventSequence: 1,
          goal: configuredGoal(),
          goalCondition: DEFAULT_CONDITION,
          status: 'running',
        })
        .returning()
      dispatch = 'opened'
    } else if (run) {
      await tx
        .update(runs)
        .set({ eventSequence: sql`${runs.eventSequence} + 1`, updatedAt: new Date() })
        .where(eq(runs.id, run.id))
    }
    await tx.insert(events).values({
      id: input.id,
      environmentId: environment.id,
      runId: run?.id,
      instanceId: input.instanceId,
      type: input.type,
      data: input.data,
    })
    await tx.insert(timeline).values({
      id: randomUUID(),
      environmentId: environment.id,
      runId: run?.id,
      kind: 'event',
      message: `${input.type} event`,
      detail: { eventId: input.id, data: input.data, instanceId: input.instanceId },
    })
    if (dispatch === 'opened' && run) {
      await tx.insert(timeline).values({
        id: randomUUID(),
        environmentId: environment.id,
        runId: run.id,
        kind: 'agent:start',
        message: 'Incident opened; agent run started',
        detail: { goal: run.goal, eventId: input.id },
      })
    }
    return { runId: run?.id ?? null, dispatch, superseded: old.map((item) => item.id) }
  })

  for (const runId of outcome.superseded)
    await inngest.send({ name: 'agent/run.cancelled', data: { runId } })
  if (outcome.runId && outcome.dispatch) {
    await inngest.send({
      id: `${input.id}:incident`,
      name: outcome.dispatch === 'opened' ? 'incident/opened' : 'incident/updated',
      data: {
        runId: outcome.runId,
        environmentId: environment.id,
        instanceId: input.instanceId,
        eventId: input.id,
      },
    })
  }
  return { eventId: input.id, runId: outcome.runId, dispatch: outcome.dispatch }
}

export async function dashboard() {
  const environment = await ensureEnvironment()
  const [recentEvents, recentRuns, recentApprovals] = await Promise.all([
    db
      .select()
      .from(events)
      .where(eq(events.environmentId, environment.id))
      .orderBy(desc(events.createdAt))
      .limit(400),
    db
      .select()
      .from(runs)
      .where(eq(runs.environmentId, environment.id))
      .orderBy(desc(runs.startedAt))
      .limit(100),
    db
      .select()
      .from(approvals)
      .where(eq(approvals.environmentId, environment.id))
      .orderBy(desc(approvals.createdAt))
      .limit(100),
  ])
  let service: Awaited<ReturnType<typeof getLatestState>> | null = null
  try {
    service = await getLatestState()
  } catch {
    /* Keep the operator inbox available when checkout is down. */
  }
  return { service, events: recentEvents, runs: recentRuns, approvals: recentApprovals }
}

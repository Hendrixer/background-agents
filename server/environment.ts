import { randomUUID } from 'node:crypto'
import { desc } from 'drizzle-orm'
import { db } from './db'
import { environments } from './schema'
import type { GoalCondition } from '../shared/types'

const DEFAULT_GOAL =
  'Investigate checkout incidents, use permitted actions to restore service when possible, ask for human help when needed, verify recovery from fresh state, and record the outcome.'
export const DEFAULT_CONDITION: GoalCondition = { path: 'health.status', equals: 'healthy' }

export function configuredGoal() {
  return process.env.AGENT_GOAL?.trim() || DEFAULT_GOAL
}

export async function ensureEnvironment() {
  const [current] = await db
    .select()
    .from(environments)
    .orderBy(desc(environments.createdAt))
    .limit(1)
  if (current) return current
  const [created] = await db
    .insert(environments)
    .values({
      id: randomUUID(),
      scenario: 'legacy-unused',
      eventTypes: [],
      featureEnabled: false,
      release: 'unused',
      upstreamHealthy: true,
      state: {},
      goal: DEFAULT_GOAL,
      goalCondition: DEFAULT_CONDITION,
    })
    .returning()
  return created
}

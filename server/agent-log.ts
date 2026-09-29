import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from './db'
import { timeline } from './schema'

type AgentActivityPhase =
  | 'start'
  | 'observe'
  | 'resume'
  | 'loop'
  | 'predict'
  | 'act'
  | 'pause'
  | 'human'
  | 'terminal'

export async function logAgentActivity(
  environmentId: string,
  runId: string,
  phase: AgentActivityPhase,
  message: string,
  detail: Record<string, unknown> = {},
) {
  await db.insert(timeline).values({
    id: randomUUID(),
    environmentId,
    runId,
    kind: `agent:${phase}`,
    message,
    detail,
  })
}

export async function activityForRun(runId: string) {
  return db
    .select()
    .from(timeline)
    .where(eq(timeline.runId, runId))
    .orderBy(desc(timeline.createdAt))
    .limit(200)
}

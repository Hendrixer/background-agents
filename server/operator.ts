import express from 'express'
import { ZodError, z } from 'zod'
import { cancelRun, decideProposal, getRun } from './agent-data'
import { activityForRun } from './agent-log'
import { ensureEnvironment } from './environment'
import { dashboard, ingestServiceEvent } from './incident-data'

const app = express()
app.use(express.json({ limit: '1mb' }))
const id = z.string().uuid()

app.get('/api/health', (_request, response) => response.json({ ok: true, process: 'operator' }))
app.get('/api/dashboard', async (_request, response) => response.json(await dashboard()))

// The separate checkout process retries a stable event ID until this endpoint
// accepts it. No simulated service behavior is implemented in the agent app.
app.post('/api/service/events', async (request, response) => {
  const input = z
    .object({
      id,
      serviceId: z.literal('checkout'),
      instanceId: id,
      type: z.string().min(1).max(80),
      data: z.record(z.string(), z.unknown()),
    })
    .parse(request.body)
  response.json(await ingestServiceEvent(input))
})

app.post('/api/runs/cancel', async (request, response) => {
  const { runId } = z.object({ runId: id }).parse(request.body)
  response.json(await cancelRun(runId))
})
app.get('/api/runs/:runId/activity', async (request, response) => {
  const runId = id.parse(request.params.runId)
  await getRun(runId)
  response.json(await activityForRun(runId))
})

app.post('/api/approvals/decide', async (request, response) => {
  const input = z
    .object({
      approvalId: id,
      decision: z.enum(['approved', 'rejected']),
      reason: z.string().max(1000).optional(),
    })
    .parse(request.body)
  response.json(await decideProposal(input.approvalId, input.decision, input.reason))
})

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof ZodError) return response.status(400).json({ error: error.message })
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(message)
    return response.status(500).json({ error: message })
  },
)

await ensureEnvironment()
app.listen(3001, '127.0.0.1', () => console.log('Operator API http://127.0.0.1:3001'))

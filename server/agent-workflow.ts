import { randomUUID } from 'node:crypto'
import {
  agentState,
  getProposal,
  getRun,
  goalSatisfied,
  proposeAction,
  recordDecision,
  recordToolAction,
  setIteration,
  setRun,
  staleProposal,
} from './agent-data'
import { chooseAction, writeReport } from './agent-brain'
import { inngest } from './inngest'
import { logAgentActivity } from './agent-log'
import { checkoutServiceUrl } from './observe'
import { actionPolicy } from './tool-policy'
import type { ActionName } from '../shared/types'

async function executeAction(
  environmentId: string,
  runId: string,
  actionId: string,
  name: ActionName,
  expectedVersion?: number,
) {
  const input = expectedVersion === undefined ? {} : { expectedVersion }
  await logAgentActivity(environmentId, runId, 'act', `Calling ${name.replaceAll('_', ' ')}`, {
    actionId,
    input,
  })
  try {
    const response = await fetch(`${checkoutServiceUrl}/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId, name, ...input }),
    })
    const result = (await response.json()) as Record<string, unknown>
    if (!response.ok) throw new Error(String(result.error || `Tool failed: ${response.status}`))
    if (result.stale !== true)
      await recordToolAction(environmentId, runId, actionId, name, input, result)
    return result
  } catch (error) {
    await logAgentActivity(
      environmentId,
      runId,
      'act',
      `${name.replaceAll('_', ' ')} attempt failed`,
      {
        actionId,
        error: error instanceof Error ? error.message : String(error),
      },
    )
    throw error
  }
}

export const incidentAgent = inngest.createFunction(
  {
    id: 'incident-agent',
    name: 'Checkout incident agent',
    triggers: { event: 'incident/opened' },
    retries: 2,
    // This limits executing steps, not the number of waiting incidents.
    concurrency: { limit: 1, key: 'event.data.environmentId' },
    onFailure: async ({ error, event }) => {
      const original = event.data.event as { data?: { runId?: string } }
      if (original.data?.runId) await setRun(original.data.runId, 'failed', error.message)
    },
  },
  async ({ event, step }) => {
    const { environmentId, runId, instanceId } = event.data
    const run = await getRun(runId)
    if (
      run.instanceId !== instanceId ||
      ['completed', 'failed', 'cancelled', 'escalated', 'superseded'].includes(run.status)
    )
      return

    for (let cycle = 1; cycle <= 24; cycle++) {
      const current = await getRun(runId)
      if (['completed', 'failed', 'cancelled', 'escalated', 'superseded'].includes(current.status))
        return
      const state = await step.run(`observe-state-${cycle}`, () => agentState(environmentId, runId))

      if (goalSatisfied(state, run.goalCondition)) {
        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state))
        await step.run(`complete-run-${cycle}`, () => setRun(runId, 'completed', null, report))
        return { report }
      }

      const decision = await step.run(`choose-action-${cycle}`, () => chooseAction(run.goal, state))
      await step.run(`set-iteration-${cycle}`, () => setIteration(runId, cycle))
      await step.run(`record-decision-${cycle}`, () =>
        recordDecision(environmentId, runId, cycle, decision.action, decision.reason),
      )

      if (decision.action === 'wait' || (decision.action === 'complete' && run.goalCondition)) {
        if (decision.action === 'complete') {
          await step.run(`reject-completion-${cycle}`, () =>
            logAgentActivity(
              environmentId,
              runId,
              'human',
              'Completion blocked by configured goal condition',
              { condition: run.goalCondition },
            ),
          )
        }
        await step.run(`wait-status-${cycle}`, () =>
          setRun(
            runId,
            'waiting',
            decision.action === 'wait' ? decision.reason : 'Recovery is not verified',
          ),
        )
        let check = 0
        while (true) {
          const latest = await step.run(`read-event-sequence-${cycle}-${check}`, () =>
            getRun(runId),
          )
          if (['cancelled', 'superseded', 'failed'].includes(latest.status)) return
          if (latest.eventSequence > state.eventSequence) break
          check++
          await step.waitForEvent(`wait-for-service-${cycle}-${check}`, {
            event: 'incident/updated',
            if: `async.data.runId == "${runId}"`,
            timeout: '10s',
          })
          // The timeout also reconciles an event that arrived just before the wait.
        }
        continue
      }
      if (decision.action === 'complete') {
        const report = await step.run(`write-report-${cycle}`, () => writeReport(run.goal, state))
        await step.run(`complete-run-${cycle}`, () => setRun(runId, 'completed', null, report))
        return { report }
      }

      if (decision.action === 'request_help') {
        await step.run(`help-unavailable-${cycle}`, () =>
          setRun(runId, 'escalated', 'Human help path is not built yet'),
        )
        return
      }
      // An attempt-local ID is intentionally unsafe when a response is lost.
      const actionId = randomUUID()
      const policy = actionPolicy[decision.action]
      if (policy === 'approval') {
        const input = { expectedVersion: state.world.version }
        const proposalId = await step.run(`propose-action-${cycle}`, async () => {
          const proposal = await proposeAction(
            environmentId,
            runId,
            actionId,
            decision.action,
            input,
          )
          return proposal.id
        })
        let proposal = await step.run(`read-human-${cycle}`, () => getProposal(proposalId))
        let check = 0
        while (proposal.status === 'pending') {
          check++
          await step.waitForEvent(`wait-for-human-${cycle}-${check}`, {
            event: 'agent/approval.decided',
            if: `async.data.proposalId == "${proposalId}"`,
            timeout: '10s',
          })
          proposal = await step.run(`reconcile-human-${cycle}-${check}`, () =>
            getProposal(proposalId),
          )
        }
        if (proposal.status !== 'approved') {
          await step.run(`stop-after-human-${cycle}`, () =>
            setRun(runId, 'escalated', `Human decision: ${proposal.status}`),
          )
          return
        }
        const fresh = await step.run(`recheck-approved-state-${cycle}`, () =>
          agentState(environmentId, runId),
        )
        if (fresh.world.version !== input.expectedVersion) {
          await step.run(`invalidate-approval-${cycle}`, () => staleProposal(proposalId))
          continue
        }
      }

      const result = await step.run(`execute-action-${cycle}`, () =>
        executeAction(
          environmentId,
          runId,
          actionId,
          decision.action,
          policy === 'read' ? undefined : state.world.version,
        ),
      )
      if (result.stale === true) {
        await step.run(`stale-action-${cycle}`, () =>
          logAgentActivity(
            environmentId,
            runId,
            'act',
            'Action rejected because service state changed',
            result,
          ),
        )
        continue
      }
      await step.run(`settle-status-${cycle}`, () =>
        setRun(runId, 'waiting', 'Waiting briefly before observing the effect'),
      )
      await step.sleep(`settle-${cycle}`, '1s')
    }

    await step.run('stop-at-limit', () => setRun(runId, 'escalated', 'Decision limit reached'))
  },
)

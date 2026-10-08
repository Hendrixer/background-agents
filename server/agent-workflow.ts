import {randomUUID} from 'node:crypto'
import { inngest } from './inngest'
import {agentState, getRun, goalSatisfied, recordDecision, recordToolAction, setIteration, setRun} from './agent-data'
import {chooseAction, writeReport} from './agent-brain'
import {checkoutServiceUrl} from './observe'

// The alert intake has already opened an incident. Build its harness here.
export const incidentAgent = inngest.createFunction(
  { id: 'incident-agent', name: 'Checkout incident agent', triggers: { event: 'incident/opened' } },
  async ({ event, step }) => {
    const {environmentId, runId} = event.data

    return step.run('whole-agentloop', async () => {
      const run = await getRun(runId)
      for( let cycle = 1; cycle <= 8; cycle++) {
        const state = await agentState(environmentId, runId)

        if(goalSatisfied(state, run.goalCondition)) {
          const report = await writeReport(run.goal, state)
          await setRun(runId, 'completed', null, report)
          return {report}
        }

        const decision = await chooseAction(run.goal, state)
        await setIteration(runId, cycle)
        await recordDecision(environmentId, runId, cycle, decision.action, decision.reason)

        if(decision.action === 'wait' ||
          decision.action === 'complete' || 
          decision.action === 'request_help'
        ){
          await setRun(runId, 'esclated', 'This first loop cannot pause yet')
          return
        }
        if(decision.action === 'rollback_release') {
          await setRun(runId, 'esclated', 'Approvals not built yet')
          return
        }
        const actionId = `${runId}:${randomUUID}`
        const response = await fetch(checkoutServiceUrl + '/operations', {
          method: 'POST',
          headers: {'Content-Type' : 'application/json' },
          body: JSON.stringify({
            actionId,
            name: decision.action,
            expectedVersion: state.world.version
          })
    
        })
        const result = (await response.json())
        if(!response.ok) throw new Error(String(result.error ?? response.status))
        if(result.stale !== true) {
          await recordToolAction(
            environmentId, 
            runId,
            actionId,
            decision.action,
            {expectedVersion: state.world.version},
            result
          )
        }
      }
      await setRun(runId, 'esclated', 'Decision limit reached')
    })
  },
)

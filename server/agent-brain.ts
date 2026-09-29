import 'dotenv/config'
import { openai } from '@ai-sdk/openai'
import { generateText, Output } from 'ai'
import { z } from 'zod'
import { ACTIONS, type ActionName } from '../shared/types'
import type { AgentState } from './agent-data'

const decisionSchema = z.object({
  action: z.enum(ACTIONS),
  reason: z.string(),
  detail: z.string(),
})

type Decision = { action: ActionName; reason: string; detail: string }

function model() {
  const id = process.env.OPENAI_MODEL
  if (!process.env.OPENAI_API_KEY || !id) {
    throw new Error('Set OPENAI_API_KEY and OPENAI_MODEL in .env before starting an agent run')
  }
  return openai(id)
}

function scriptedDecision(state: AgentState): Decision {
  const used = (action: ActionName) => state.actions.some((item) => item.name === action)
  const world = state.world.state
  if (!used('inspect_logs'))
    return { action: 'inspect_logs', reason: 'Check current failure evidence', detail: '' }
  if (!used('inspect_changes'))
    return { action: 'inspect_changes', reason: 'Check recent deployment state', detail: '' }
  if (world.upstreamHealthy === false) {
    const answered = state.humanDecisions.some((item) => item.action === 'request_help')
    return answered
      ? {
          action: 'wait',
          reason: 'The dependency is still unavailable; wait for a fresh service event',
          detail: '',
        }
      : {
          action: 'request_help',
          reason: 'The external dependency is unavailable',
          detail: 'Can someone check and restore the payment gateway?',
        }
  }
  if (
    world.release === 'v2-bad' &&
    !used('rollback_release') &&
    !state.humanDecisions.some(
      (item) => item.action === 'rollback_release' && item.status !== 'approved',
    )
  )
    return {
      action: 'rollback_release',
      reason: 'The active release may be causing failures',
      detail: '',
    }
  if (world.featureEnabled === true && !used('disable_feature'))
    return { action: 'disable_feature', reason: 'Disable the suspect feature', detail: '' }
  return {
    action: 'wait',
    reason: 'No further local action is justified; wait for new service evidence',
    detail: '',
  }
}

export async function chooseAction(goal: string, state: AgentState): Promise<Decision> {
  if (process.env.AGENT_DEMO_MODE === '1') return scriptedDecision(state)

  const result = await generateText({
    model: model(),
    output: Output.object({ schema: decisionSchema }),
    system: `You are a background incident agent for a checkout service.
Choose exactly one action. The harness validates it and controls execution.
Available actions: inspect_logs, inspect_changes, disable_feature, rollback_release, request_help, complete, wait.
The current service state and recent incident history have already been observed. Inspect detailed logs or changes when needed before changing the service.
Choose the service action you think is justified; the harness applies its own policy before execution.
Use request_help when an external dependency cannot be fixed by your local tools.
Use wait when no safe local action remains; a later service event can wake this same incident run.
An alert is a trigger, not authoritative evidence. An answered help request does not prove recovery.
Use complete only when the configured goal is satisfied, or when no deterministic goal condition is configured and you can justify completion.
Keep reason to one short sentence. Put a question to the operator in detail for request_help; otherwise detail may be empty.`,
    prompt: `Goal: ${goal}\n\nCurrent observed state:\n${JSON.stringify(state, null, 2)}`,
  })
  return result.output
}

export async function writeReport(goal: string, state: AgentState): Promise<string> {
  if (process.env.AGENT_DEMO_MODE === '1') {
    return `Goal: ${goal}\nObserved state: ${JSON.stringify(state.world.state)}\nActions in this run: ${
      state.actions
        .map((item) => item.name.replaceAll('_', ' '))
        .reverse()
        .join(', ') || 'none'
    }.`
  }
  const result = await generateText({
    model: model(),
    system:
      'Write a brief factual incident report. Include evidence, actions, recovery verification, and any unresolved risk. Do not invent facts.',
    prompt: `Goal: ${goal}\n\nFinal state and history:\n${JSON.stringify(state, null, 2)}`,
  })
  return result.text
}

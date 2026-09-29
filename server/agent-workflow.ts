import { inngest } from './inngest'

// The alert intake has already opened an incident. Build its harness here.
export const incidentAgent = inngest.createFunction(
  { id: 'incident-agent', name: 'Checkout incident agent', triggers: { event: 'incident/opened' } },
  async ({ event }) => {
    return { runId: event.data.runId, next: 'Build the observe–decide–act loop' }
  },
)

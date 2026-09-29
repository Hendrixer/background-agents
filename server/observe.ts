import { z } from 'zod'

export const checkoutServiceUrl = process.env.CHECKOUT_SERVICE_URL || 'http://127.0.0.1:3004'

const snapshotSchema = z.object({
  instanceId: z.string().uuid(),
  version: z.number().int(),
  state: z.record(z.string(), z.unknown()),
})

// The agent reads the checkout process over HTTP. It does not share the
// service's memory or use an event payload as a state snapshot.
export async function getLatestState() {
  const response = await fetch(`${checkoutServiceUrl}/state`)
  if (!response.ok) throw new Error(`Checkout state request failed: ${response.status}`)
  return snapshotSchema.parse(await response.json())
}

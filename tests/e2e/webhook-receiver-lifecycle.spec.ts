import { createServer } from 'node:net'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('fixture port unavailable')
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

test('settings enable, rebind and disable the real webhook receiver', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  const first = await unusedPort()
  let second = await unusedPort()
  while (second === first) {
    second = await unusedPort()
  }
  const settings = await orcaPage.evaluate(() => window.api.settings.get())
  const endpoint = () => orcaPage.evaluate(() => window.api.automations.getWebhookEndpoint())
  const update = (enabled: boolean, port: number) =>
    orcaPage.evaluate(
      ({ enabled, port }) =>
        window.api.settings.set({ webhookServer: { enabled, port, bindAddress: '127.0.0.1' } }),
      { enabled, port }
    )
  try {
    await update(false, first)
    await expect.poll(endpoint).toMatchObject({ running: false })
    await update(true, first)
    await expect.poll(endpoint).toMatchObject({ running: true, port: first, error: null })
    expect(
      (await fetch(`http://127.0.0.1:${first}/webhook/missing`, { method: 'POST' })).status
    ).toBe(404)
    await update(true, second)
    await expect.poll(endpoint).toMatchObject({ running: true, port: second, error: null })
    await expect
      .poll(async () => {
        try {
          await fetch(`http://127.0.0.1:${first}/webhook/missing`, { method: 'POST' })
          return false
        } catch {
          return true
        }
      })
      .toBe(true)
    expect(
      (await fetch(`http://127.0.0.1:${second}/webhook/missing`, { method: 'POST' })).status
    ).toBe(404)
    await update(false, second)
    await expect.poll(endpoint).toMatchObject({ running: false })
  } finally {
    await orcaPage.evaluate(
      (webhookServer) => window.api.settings.set({ webhookServer }),
      settings.webhookServer
    )
  }
})

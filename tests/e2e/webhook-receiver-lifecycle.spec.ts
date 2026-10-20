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

test('webhook settings display the actual receiver state after enabling', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const port = await unusedPort()
  await orcaPage.evaluate(async (port) => {
    const settings = await window.api.settings.set({
      webhookServer: { enabled: false, port, bindAddress: '127.0.0.1' }
    })
    const store = window.__store
    if (!store) {
      throw new Error('test store unavailable')
    }
    store.setState({ settings })
    store.getState().openSettingsTarget({ pane: 'advanced', repoId: null })
    store.getState().openSettingsPage()
  }, port)
  const announcement = orcaPage.getByRole('button', { name: 'Maybe Later', exact: true })
  if (await announcement.isVisible().catch(() => false)) {
    await announcement.click()
  }
  const toggle = orcaPage.getByRole('switch', { name: 'Enable webhook receiver', exact: true })
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await testInfo.attach('webhook-disabled', {
    body: await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('webhook-disabled.png')
    }),
    contentType: 'image/png'
  })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect
    .poll(() => orcaPage.evaluate(() => window.api.automations.getWebhookEndpoint()))
    .toMatchObject({ running: true, port })
  await expect(orcaPage.getByText(`Listening on 127.0.0.1:${port}.`, { exact: true })).toBeVisible()
  await testInfo.attach('webhook-enabled', {
    body: await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('webhook-enabled.png')
    }),
    contentType: 'image/png'
  })
  await toggle.click()
  await expect
    .poll(() => orcaPage.evaluate(() => window.api.automations.getWebhookEndpoint()))
    .toMatchObject({ running: false })
})

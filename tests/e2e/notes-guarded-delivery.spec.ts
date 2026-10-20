import { test, expect } from './helpers/orca-app'
import { waitForSessionReady, waitForActiveWorktree } from './helpers/store'
import { createNotesDeliveryReceiver } from './helpers/notes-delivery-receiver'
import { readHookEndpoint, emitCodexHookStatus } from './helpers/agent-hook-endpoint'

test('saved review notes submit through a real slow-composer PTY exactly once', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  const worktreePath = await orcaPage.evaluate((id) => {
    const worktree = Object.values(window.__store!.getState().worktreesByRepo)
      .flat()
      .find((w) => w.id === id)
    if (!worktree) {
      throw new Error('test workspace missing')
    }
    return worktree.path
  }, worktreeId)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const marker = 'STANDALONE_NOTES_SUBMIT_PROOF'
  const receiver = await createNotesDeliveryReceiver(userDataDir, worktreePath, marker)
  registerPostElectronShutdownCleanup(async () => receiver.dispose())
  await emitCodexHookStatus(await readHookEndpoint(electronApp), {
    paneKey: receiver.paneKey,
    worktreeId,
    state: 'done',
    lastAssistantMessage: 'Ready for test notes'
  })
  await orcaPage.evaluate(
    async ({ worktreeId, marker }) => {
      const state = window.__store!.getState()
      const comment = await state.addDiffComment({
        worktreeId,
        filePath: 'src/index.ts',
        source: 'diff',
        lineNumber: 1,
        body: marker,
        side: 'modified'
      })
      if (!comment) {
        throw new Error('test note creation failed')
      }
      if (!window.__store!.getState().openDiffNotesSendMenuForActiveWorktree()) {
        throw new Error('notes send menu could not open')
      }
    },
    { worktreeId, marker }
  )
  const target = orcaPage
    .getByRole('menu', { name: 'Send notes to an agent' })
    .getByRole('menuitem')
    .filter({ hasText: 'Codex' })
    .first()
  await expect(target).toBeVisible({ timeout: 30_000 })
  await expect(target).toBeEnabled()
  await testInfo.attach('notes-before-send', {
    body: await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('notes-before-send.png')
    }),
    contentType: 'image/png'
  })
  await target.click()
  await expect.poll(receiver.readReport, { timeout: 90_000 }).toMatchObject({
    contractOk: true,
    submitted: true,
    prematureEnters: 0,
    receivedEnters: 1,
    swallowedEnters: 0,
    hasBracketedPasteFrame: true,
    markerReceived: true
  })
  await testInfo.attach('notes-pty-report', {
    body: JSON.stringify(receiver.readReport()),
    contentType: 'application/json'
  })
  await testInfo.attach('notes-after-send', {
    body: await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('notes-after-send.png')
    }),
    contentType: 'image/png'
  })
})

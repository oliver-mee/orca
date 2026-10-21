import { existsSync, readFileSync } from 'node:fs'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import {
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { createNotesDeliveryReceiver } from './helpers/notes-delivery-receiver'
import { readHookEndpoint, emitCodexHookStatus } from './helpers/agent-hook-endpoint'

test('paired saved review notes submit to the host PTY exactly once', async (// oxlint-disable-next-line no-empty-pattern -- This scenario owns both isolated applications.
{}, testInfo) => {
  test.setTimeout(180_000)
  const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
  expect(existsSync(repoPath)).toBe(true)
  const host = await launchHeadlessPairedRuntimeHost()
  let client: PairedElectronClient | null = null
  let receiver: Awaited<ReturnType<typeof createNotesDeliveryReceiver>> | null = null
  try {
    const added = await host.client.call<{ repo: { id: string } }>('repo.add', {
      path: repoPath,
      kind: 'git'
    })
    client = await launchPairedElectronClient(host.offer, testInfo, 'notes-delivery')
    const page = client.page
    const findWorktree = () =>
      page.evaluate(
        (repoId) =>
          window.__store
            ?.getState()
            .allWorktrees()
            .find((worktree) => worktree.repoId === repoId)?.id ?? null,
        added.result.repo.id
      )
    await expect.poll(findWorktree, { timeout: 60_000 }).not.toBeNull()
    const worktreeId = await findWorktree()
    if (!worktreeId) {
      throw new Error('paired host worktree unavailable')
    }
    await page.evaluate((id) => {
      const state = window.__store!.getState()
      state.setActiveView('terminal')
      state.setActiveWorktree(id)
    }, worktreeId)
    const marker = 'PAIRED_STANDALONE_NOTES_SUBMIT_PROOF'
    receiver = await createNotesDeliveryReceiver(host.userDataDir, repoPath, marker)
    await emitCodexHookStatus(await readHookEndpoint(host.app), {
      paneKey: receiver.paneKey,
      worktreeId,
      state: 'done',
      lastAssistantMessage: 'Ready for paired test notes'
    })
    await page.evaluate(
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
          throw new Error('paired note was not saved')
        }
        if (!window.__store!.getState().openDiffNotesSendMenuForActiveWorktree()) {
          throw new Error('paired notes Send menu could not open')
        }
      },
      { worktreeId, marker }
    )
    const target = page
      .getByRole('menu', { name: 'Send notes to an agent' })
      .getByRole('menuitem')
      .filter({ hasText: 'Codex' })
      .first()
    await expect(target).toBeVisible({ timeout: 30_000 })
    await expect(target).toBeEnabled()
    await testInfo.attach('paired-notes-before-send', {
      body: await page.screenshot({ animations: 'disabled' }),
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
    expect(await client.getDirectSshAttemptTargetIds()).toEqual([])
    await testInfo.attach('paired-notes-host-pty-report', {
      body: JSON.stringify(receiver.readReport()),
      contentType: 'application/json'
    })
    await testInfo.attach('paired-notes-after-send', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png'
    })
  } finally {
    if (client) {
      await client.dispose()
    }
    await host.dispose()
    receiver?.dispose()
  }
})

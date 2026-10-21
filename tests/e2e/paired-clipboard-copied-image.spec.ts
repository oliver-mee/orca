import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import {
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'

test('copied image IPC uploads to the paired host and refuses ambiguous selections', async (// oxlint-disable-next-line no-empty-pattern -- This scenario owns both isolated applications.
{}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'macOS copied-file IPC')
  test.setTimeout(120_000)
  const host = await launchHeadlessPairedRuntimeHost()
  let client: PairedElectronClient | null = null
  try {
    const remoteTemp = join(host.userDataDir, 'host-paste-target')
    await mkdir(remoteTemp, { recursive: true })
    await host.app.evaluate(({ app }, target) => {
      app.setPath('temp', target)
    }, remoteTemp)
    client = await launchPairedElectronClient(host.offer, testInfo, 'copied-image-upload')
    const source = testInfo.outputPath('copied-image.png')
    const png = await client.app.evaluate(({ nativeImage }) =>
      nativeImage
        .createFromBitmap(Buffer.alloc(8 * 6 * 4, 180), { width: 8, height: 6 })
        .toPNG()
        .toString('base64')
    )
    await writeFile(source, Buffer.from(png, 'base64'))
    // Only clipboard reads are substituted; upload routing and host persistence are real.
    await client.app.evaluate(
      ({ clipboard }, { url, path }) => {
        clipboard.read = (format) =>
          format === 'public.file-url'
            ? url
            : format === 'NSFilenamesPboardType'
              ? `<plist><array><string>${path}</string></array></plist>`
              : ''
        clipboard.readText = () => 'copied-image.png'
      },
      { url: pathToFileURL(source).href, path: source }
    )
    const save = () =>
      client!.page.evaluate(
        (runtimeEnvironmentId) =>
          window.api.ui.saveCopiedClipboardImageFileAsTempFile({ runtimeEnvironmentId }),
        client!.environmentId
      )
    const saved = await save()
    expect(saved).toMatch(/orca-paste-.+\.png$/)
    if (!saved) {
      throw new Error('paired upload did not return a host path')
    }
    expect(saved.startsWith(`${remoteTemp}/`)).toBe(true)
    expect(await readFile(saved)).toEqual(Buffer.from(png, 'base64'))
    const acceptedFiles = await readdir(remoteTemp)
    expect(acceptedFiles).toHaveLength(1)
    for (const mode of ['multiple', 'binary', 'no-list-multiple-text']) {
      await client.app.evaluate(
        ({ clipboard }, { path, mode }) => {
          const read = clipboard.read
          clipboard.read = (format) =>
            format === 'NSFilenamesPboardType'
              ? mode === 'binary'
                ? 'bplist00opaque-selection'
                : mode === 'multiple'
                  ? `<plist><array><string>${path}</string><string>${path}</string></array></plist>`
                  : ''
              : read(format)
          clipboard.readText = () =>
            mode === 'no-list-multiple-text'
              ? 'copied-image.png\nsecond-image.png'
              : 'copied-image.png'
        },
        { path: source, mode }
      )
      expect(await save()).toBeNull()
      expect(await readdir(remoteTemp)).toEqual(acceptedFiles)
    }
    expect(await client.getDirectSshAttemptTargetIds()).toEqual([])
    await testInfo.attach('paired-clipboard-report', {
      body: JSON.stringify({
        destinationIsHostTemp: true,
        exactPngBytes: true,
        acceptedFiles: acceptedFiles.length,
        refused: ['multiple', 'binary', 'no-list-multiple-text'],
        directSshAttempts: 0,
        operatingSystemClipboardChanged: false
      }),
      contentType: 'application/json'
    })
  } finally {
    if (client) {
      await client.dispose()
    }
    await host.dispose()
  }
})

import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('copied image IPC reads the selected file and refuses a multi-file list', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'macOS copied-file contract')
  await waitForSessionReady(orcaPage)
  const source = testInfo.outputPath('fixture.png')
  const png = await electronApp.evaluate(({ nativeImage }) =>
    nativeImage
      .createFromBitmap(Buffer.alloc(8 * 6 * 4, 180), { width: 8, height: 6 })
      .toPNG()
      .toString('base64')
  )
  await writeFile(source, Buffer.from(png, 'base64'))
  // Keep the user's clipboard intact. Native named-pasteboard evidence separately
  // covers these formats; this test covers the shipping preload and main IPC.
  await electronApp.evaluate(
    ({ clipboard }, { url, name, path }) => {
      clipboard.read = (format) =>
        format === 'public.file-url'
          ? url
          : format === 'NSFilenamesPboardType'
            ? `<plist><array><string>${path}</string></array></plist>`
            : ''
      clipboard.readText = () => name
    },
    { url: pathToFileURL(source).href, name: 'fixture.png', path: source }
  )
  let saved: string | null = null
  try {
    saved = await orcaPage.evaluate(() => window.api.ui.saveCopiedClipboardImageFileAsTempFile())
    expect(saved).toMatch(/orca-paste-.+\.png$/)
    if (!saved) {
      throw new Error('Copied image was not saved')
    }
    const image = await readFile(saved)
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([8, 6])
    await electronApp.evaluate(({ clipboard }, path) => {
      const read = clipboard.read
      clipboard.read = (format) =>
        format === 'NSFilenamesPboardType'
          ? `<plist><array><string>${path}</string><string>${path}</string></array></plist>`
          : read(format)
    }, source)
    expect(
      await orcaPage.evaluate(() => window.api.ui.saveCopiedClipboardImageFileAsTempFile())
    ).toBeNull()
  } finally {
    if (saved) {
      await rm(saved, { force: true })
    }
  }
})

import {
  clipboard,
  ipcMain,
  nativeImage,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { open } from 'node:fs/promises'
import { isMacClipboardFileUrl, readMacClipboardImageFileAsPng } from './clipboard-mac-image-file'
import type { SaveClipboardImageAsTempFileArgs } from './clipboard-image-temp-file'

type MacCopiedImageClipboardDeps = {
  assertTextSender: (event: IpcMainInvokeEvent) => void
  isTrustedRenderer: (sender: WebContents) => boolean
  saveImageForTarget: (buffer: Buffer, args?: SaveClipboardImageAsTempFileArgs) => Promise<string>
}

export function registerMacCopiedImageClipboardHandler({
  assertTextSender,
  isTrustedRenderer,
  saveImageForTarget
}: MacCopiedImageClipboardDeps): void {
  // Why: a Finder-copied image file also carries its filename as text (and its
  // icon as the image), so terminals must check for the file before text.
  ipcMain.handle(
    'clipboard:saveCopiedImageFileAsTempFile',
    async (event, args?: SaveClipboardImageAsTempFileArgs) => {
      assertTextSender(event)
      // Why: runs before every terminal text paste; popouts keep text-only authority.
      if (process.platform !== 'darwin' || !isTrustedRenderer(event.sender)) {
        return null
      }
      // Why: bail before reading (possibly huge) text when no file was copied.
      const fileUrl = clipboard.read('public.file-url')
      if (!isMacClipboardFileUrl(fileUrl)) {
        return null
      }
      const png = await readMacClipboardImageFileAsPng(
        {
          fileUrl,
          filenamesPlist: clipboard.read('NSFilenamesPboardType'),
          text: clipboard.readText()
        },
        {
          createImageFromBuffer: (buffer) => nativeImage.createFromBuffer(buffer),
          openFile: (filePath) => open(filePath, 'r')
        }
      )
      return png ? saveImageForTarget(png, args) : null
    }
  )
}

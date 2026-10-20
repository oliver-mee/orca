import { clipboard } from 'electron'
import { runProcess } from '@orca/process-host'
import type { ClipboardFileDeps } from './clipboard-file-copy'

type ClipboardWriteFileRequest = {
  filePath: string
  connectionId?: string
}

export function normalizeClipboardWriteFileRequest(
  args: unknown
): ClipboardWriteFileRequest | null {
  if (typeof args === 'string') {
    return { filePath: args }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null
  }
  const filePath = (args as { filePath?: unknown }).filePath
  if (typeof filePath !== 'string') {
    return null
  }
  const connectionId = (args as { connectionId?: unknown }).connectionId
  if (typeof connectionId === 'string' && connectionId.trim() !== '') {
    return { filePath, connectionId }
  }
  return { filePath }
}

export function makeClipboardFileDeps(
  resolveFilePath: ClipboardFileDeps['resolveFilePath']
): ClipboardFileDeps {
  return {
    platform: process.platform,
    desktop: process.env.XDG_CURRENT_DESKTOP,
    resolveFilePath,
    writeBuffer: (format, buffer) => clipboard.writeBuffer(format, buffer),
    runProcess
  }
}

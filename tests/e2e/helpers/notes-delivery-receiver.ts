import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RuntimeClient } from '../../../src/cli/runtime/client'
import { recognizeAgentProcess } from '../../../src/shared/agent-process-recognition'
import { buildFakeAgentCommandOverride } from './fake-agent-command-override'
import { expect } from './orca-app'

/** A real PTY receiver using the existing slow-composer fixture, without a model request. */
export async function createNotesDeliveryReceiver(
  userDataDir: string,
  repoPath: string,
  marker: string
): Promise<{ paneKey: string; readReport: () => unknown; dispose: () => void }> {
  const client = new RuntimeClient(userDataDir, 30_000)
  const root = mkdtempSync(path.join(os.tmpdir(), 'orca-annotation-receiver-'))
  const report = path.join(root, 'report.json')
  const executable = path.join(root, process.platform === 'win32' ? 'codex.cmd' : 'codex')
  const fixture = path.join(process.cwd(), 'tests', 'tools', 'repro-terminal-send-submit.mjs')
  const observer = path.join(root, 'observe-input.cjs')
  writeFileSync(
    observer,
    `const fs = require('node:fs');
process.stdin.on('data', chunk => fs.appendFileSync(process.env.ORCA_FAKE_AGENT_REPORT + '.input', chunk));
import(require('node:url').pathToFileURL(${JSON.stringify(fixture)}).href);
`
  )
  writeFileSync(
    executable,
    process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${observer}" --fake-agent --report "%ORCA_FAKE_AGENT_REPORT%" --marker "%ORCA_FAKE_AGENT_MARKER%" --timeout-ms 240000 --allow-unframed-paste %*\r\n`
      : `#!/usr/bin/env sh\n"${process.execPath}" "${observer}" --fake-agent --report "$ORCA_FAKE_AGENT_REPORT" --marker "$ORCA_FAKE_AGENT_MARKER" --timeout-ms 240000 "$@"\n`
  )
  if (process.platform !== 'win32') {
    chmodSync(executable, 0o755)
  }
  try {
    const created = await client.call<{ terminal: { handle: string; paneKey: string | null } }>(
      'terminal.create',
      {
        worktree: `path:${repoPath}`,
        command: buildFakeAgentCommandOverride(executable),
        launchAgent: 'codex',
        env: { ORCA_FAKE_AGENT_REPORT: report, ORCA_FAKE_AGENT_MARKER: marker },
        title: 'Notes receiver'
      }
    )
    await expect
      .poll(
        async () => {
          const inspected = await client.call<{ process: { foregroundProcess: string | null } }>(
            'terminal.inspectProcess',
            { terminal: created.result.terminal.handle }
          )
          return recognizeAgentProcess(inspected.result.process.foregroundProcess)?.agent ?? null
        },
        { timeout: 30_000 }
      )
      .toBe('codex')
    const paneKey = created.result.terminal.paneKey
    if (!paneKey) {
      throw new Error('receiver has no authoritative pane identity')
    }
    return {
      paneKey,
      readReport: () => {
        try {
          return JSON.parse(readFileSync(report, 'utf8'))
        } catch {
          try {
            return { submitted: false, observedInput: readFileSync(`${report}.input`, 'utf8') }
          } catch {
            return { submitted: false, observedInput: null }
          }
        }
      },
      dispose: () => rmSync(root, { recursive: true, force: true })
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

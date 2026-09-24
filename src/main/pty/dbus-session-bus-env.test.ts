import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { repairDisabledSessionBusEnv } from './dbus-session-bus-env'

const servers: Server[] = []
const dirs: string[] = []

function runtimeDirWithBus(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xdg-runtime-with-bus-'))
  const server = createServer()
  server.listen(join(dir, 'bus'))
  servers.push(server)
  dirs.push(dir)
  return dir
}

function runtimeDirWithoutBus(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xdg-runtime-no-bus-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('repairDisabledSessionBusEnv', () => {
  it('replaces the disabled marker with the per-UID user bus', () => {
    const perUidDir = runtimeDirWithBus()
    const env: Record<string, string | undefined> = { DBUS_SESSION_BUS_ADDRESS: 'disabled:' }

    repairDisabledSessionBusEnv(env, 'linux', perUidDir)

    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe(`unix:path=${perUidDir}/bus`)
  })

  it('prefers the per-UID bus over a hardened XDG_RUNTIME_DIR without a bus', () => {
    const perUidDir = runtimeDirWithBus()
    const env: Record<string, string | undefined> = {
      DBUS_SESSION_BUS_ADDRESS: 'disabled:',
      XDG_RUNTIME_DIR: runtimeDirWithoutBus()
    }

    repairDisabledSessionBusEnv(env, 'linux', perUidDir)

    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe(`unix:path=${perUidDir}/bus`)
  })

  it('falls back to XDG_RUNTIME_DIR when there is no per-UID bus', () => {
    const xdgDir = runtimeDirWithBus()
    const env: Record<string, string | undefined> = {
      DBUS_SESSION_BUS_ADDRESS: 'disabled:',
      XDG_RUNTIME_DIR: xdgDir
    }

    repairDisabledSessionBusEnv(env, 'linux', runtimeDirWithoutBus())

    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe(`unix:path=${xdgDir}/bus`)
  })

  it('leaves the marker when no reachable bus exists', () => {
    const env: Record<string, string | undefined> = { DBUS_SESSION_BUS_ADDRESS: 'disabled:' }

    repairDisabledSessionBusEnv(env, 'linux', runtimeDirWithoutBus())

    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('disabled:')
  })

  it('does not treat a plain file named bus as a bus', () => {
    const dir = runtimeDirWithoutBus()
    writeFileSync(join(dir, 'bus'), '')
    const env: Record<string, string | undefined> = { DBUS_SESSION_BUS_ADDRESS: 'disabled:' }

    repairDisabledSessionBusEnv(env, 'linux', dir)

    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('disabled:')
  })

  it('leaves a real bus address and an absent address untouched', () => {
    const perUidDir = runtimeDirWithBus()
    const withAddress: Record<string, string | undefined> = {
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus'
    }
    const withoutAddress: Record<string, string | undefined> = { HOME: '/home/user' }

    repairDisabledSessionBusEnv(withAddress, 'linux', perUidDir)
    repairDisabledSessionBusEnv(withoutAddress, 'linux', perUidDir)

    expect(withAddress).toEqual({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' })
    expect(withoutAddress).toEqual({ HOME: '/home/user' })
  })

  it('does nothing off Linux', () => {
    const env: Record<string, string | undefined> = { DBUS_SESSION_BUS_ADDRESS: 'disabled:' }

    repairDisabledSessionBusEnv(env, 'darwin', runtimeDirWithBus())

    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('disabled:')
  })
})

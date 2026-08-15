#!/usr/bin/env node
/**
 * Packaged runtime smoke: installs the packed tarball into a fresh project,
 * loads the real plugin, registers the tools, and executes both handlers
 * against a temporary DSH_HOME.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tgz = path.resolve(process.argv[2] ?? path.join(root, 'dsh-rule-evolve-0.4.1.tgz'))
if (!existsSync(tgz)) {
  console.error(`[runtime-smoke] missing tarball: ${tgz}`)
  process.exit(1)
}

function runPnpm(args, cwd) {
  return spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    timeout: 300_000,
  })
}

const dir = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-smoke-'))
try {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-evolve-smoke-host',
    private: true,
    version: '1.0.0',
    dependencies: {
      '@deepseek-ai/cordis': '^4.0.1',
      '@deepseek-ai/dsh-tools': '0.1.0-rc.6',
      'dsh-rule-evolve': `file:${tgz.replaceAll('\\', '/')}`,
    },
  }, null, 2))
  const install = runPnpm(['install'], dir)
  if (install.status !== 0) throw new Error('pnpm install failed')

  const pluginIndex = path.join(dir, 'node_modules', 'dsh-rule-evolve', 'lib', 'index.js')
  const plugin = await import(pathToFileURL(pluginIndex).href)
  if (plugin.name !== 'dsh-rule-evolve') throw new Error(`unexpected name: ${plugin.name}`)

  const home = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-smoke-home-'))
  process.env.DSH_HOME = home
  const registered = []
  plugin.apply({ tools: { register: (t) => { registered.push(t); return () => {} } } })
  const names = registered.map((t) => t.name).sort()
  if (JSON.stringify(names) !== JSON.stringify(['evolve_apply', 'evolve_learn', 'evolve_recall', 'evolve_touch'])) {
    throw new Error(`unexpected tools: ${names.join(', ')}`)
  }
  const exec = { signal: new AbortController().signal }

  const learn = registered.find((t) => t.name === 'evolve_learn')
  const learned = await learn.execute({
    task: 'smoke',
    experience: 'ERROR: sample failure line\ninfo: resolved',
    hint: 're-run after fix',
    profile: 'web',
  }, exec)
  if (learned.added !== 1) throw new Error(`evolve_learn added ${learned.added}`)

  const applyTool = registered.find((t) => t.name === 'evolve_apply')
  const applied = await applyTool.execute({
    profile: 'web',
    verifyCmd: `node -e "process.exit(0)"`,
  }, exec)
  if (!applied.installed) throw new Error(`evolve_apply failed: ${applied.note}`)
  const agents = readFileSync(applied.agentsPath, 'utf8')
  if (!agents.includes('sample failure line')) throw new Error('installed rules missing failure line')
  console.log('PASS [runtime-smoke] packed plugin loaded, tools registered, handlers executed, rules installed')
  rmSync(home, { recursive: true, force: true })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

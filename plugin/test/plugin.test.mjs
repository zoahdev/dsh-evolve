import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plugin = await import('../lib/index.js')
const core = await import('../lib/core.js')

function makeCtx() {
  const registered = []
  return {
    registered,
    tools: {
      register: (tool) => { registered.push(tool); return () => {} },
    },
  }
}

test('plugin registers evolve_learn, evolve_apply and evolve_touch', () => {
  const ctx = makeCtx()
  plugin.apply(ctx)
  const names = ctx.registered.map((t) => t.name).sort()
  assert.deepEqual(names, ['evolve_apply', 'evolve_learn', 'evolve_touch'])
})

test('evolve_learn extracts from a failure log into the profile store', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-plugin-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ctx = makeCtx()
    plugin.apply(ctx)
    const tool = ctx.registered.find((t) => t.name === 'evolve_learn')
    const result = await tool.execute({
      task: 'install plugin',
      experience: 'ERROR: Cannot read properties of undefined (reading prepare)\ninfo: resolved\nERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED',
      hint: 'check allowBuilds and re-run',
      profile: 'web',
    }, { signal: new AbortController().signal })
    assert.equal(result.added, 2)
    assert.equal(result.profile, 'web')
    const saved = readFileSync(result.file, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(saved.length, 2)
    assert.ok(saved.every((e) => e.rule.startsWith('When "')))
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('evolve_apply refuses unverified install and installs after a passing verifyCmd', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-apply-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ctx = makeCtx()
    plugin.apply(ctx)
    const learn = ctx.registered.find((t) => t.name === 'evolve_learn')
    const applyTool = ctx.registered.find((t) => t.name === 'evolve_apply')
    await learn.execute({
      task: 't',
      experience: '- Never run recursive listings through node_modules; use Glob.',
      profile: 'web',
    }, { signal: new AbortController().signal })

    const refused = await applyTool.execute({ profile: 'web' }, { signal: new AbortController().signal })
    assert.equal(refused.installed, false)
    assert.match(refused.note, /verifyCmd/)

    const installed = await applyTool.execute({
      profile: 'web',
      verifyCmd: `node -e "process.exit(0)"`,
    }, { signal: new AbortController().signal })
    assert.equal(installed.installed, true)
    assert.equal(installed.verified, true)
    assert.equal(installed.rules, 1)
    const agents = readFileSync(installed.agentsPath, 'utf8')
    assert.match(agents, /## Self-evolution rules/)
    assert.match(agents, /Never run recursive listings/)
    assert.match(agents, /verified/)
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('core logic is shared and healthy', () => {
  const entries = core.extractExperience('- Never use X; always use Y.', 'x.md')
  assert.equal(entries.length, 1)
  const audit = core.auditRules(entries)
  assert.equal(audit.total, 1)
})

test('evolve_touch increments usageCount', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-touch-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ctx = makeCtx()
    plugin.apply(ctx)
    const learn = ctx.registered.find((t) => t.name === 'evolve_learn')
    const touch = ctx.registered.find((t) => t.name === 'evolve_touch')
    const learned = await learn.execute({
      task: 't',
      experience: '- Never use recursive listings; prefer Glob.',
      profile: 'web',
    }, { signal: new AbortController().signal })
    const first = await touch.execute({ profile: 'web', rule: 'recursive' }, { signal: new AbortController().signal })
    assert.equal(first.updated, 1)
    const entries = readFileSync(learned.file, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(entries[0].usageCount, 1)
    assert.ok(entries[0].lastUsedAt)
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    rmSync(home, { recursive: true, force: true })
  }
})

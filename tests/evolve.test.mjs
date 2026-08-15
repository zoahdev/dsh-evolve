import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractExperience,
  renderRules,
  profileAgentsPath,
  mergeRules,
  evolutionRounds,
  appendEvolutionLog,
  extractFromLog,
  ruleSimilarity,
  auditRules,
} from '../scripts/dsh-evolve.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SAMPLE = `
# Troubleshooting

- Never run recursive directory listings through node_modules; prefer Glob/Grep.
- allowBuilds entries are required before git installs can run prepare scripts.
- Windows cannot resolve /bin/bash by default; install Git Bash or set shellPath.
- This line is informational only.
- Tests must use offset/limit reads to keep context bounded.
`

test('extractExperience extracts actionable lines and dedupes', () => {
  const entries = extractExperience(SAMPLE, 'docs/troubleshooting.md')
  assert.equal(entries.length, 4)
  const ids = new Set(entries.map((e) => e.id))
  assert.equal(ids.size, 4)
  assert.ok(entries.every((e) => e.source === 'docs/troubleshooting.md'))
  assert.ok(entries.every((e) => Array.isArray(e.tags) && e.tags.length > 0))
  assert.ok(entries.some((e) => e.tags.includes('install')))
  assert.ok(entries.some((e) => e.tags.includes('windows')))
})

test('renderRules includes id, source and verification status', () => {
  const entries = extractExperience(SAMPLE, 'x.md')
  entries[0].verified = true
  entries[0].lastVerifiedAt = new Date().toISOString()
  const rendered = renderRules(entries)
  assert.match(rendered, /EXP-001/)
  assert.match(rendered, /x\.md/)
  assert.match(rendered, /verified/)
  assert.match(rendered, /unverified/)
})

test('write/read round-trip via files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-'))
  try {
    const md = path.join(dir, 'in.md')
    const jsonl = path.join(dir, 'exp.jsonl')
    writeFileSync(md, SAMPLE)
    const cli = path.join(ROOT, 'scripts', 'dsh-evolve.mjs')
    const learn = spawnSync(process.execPath, [cli, 'learn', '--from', md, '--out', jsonl], { encoding: 'utf8' })
    assert.equal(learn.status, 0, learn.stderr)
    const rules = spawnSync(process.execPath, [cli, 'rules', '--experience', jsonl], { encoding: 'utf8' })
    assert.equal(rules.status, 0, rules.stderr)
    assert.match(rules.stdout, /EXP-001/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mergeRules replaces the previous block or appends a new one', () => {
  const rendered = '## Self-evolution rules\n\n- [EXP-001] Never X. _(source: a.md · ○ unverified)_\n'
  const without = mergeRules('# Repo\n\nSome text.\n', rendered)
  assert.match(without, /## Self-evolution rules/)
  assert.match(without, /Some text\./)

  const withOld = '# Repo\n\n## Self-evolution rules\n\n- [EXP-OLD] Old rule.\n\n## Other\n'
  const replaced = mergeRules(withOld, rendered)
  assert.match(replaced, /EXP-001/)
  assert.doesNotMatch(replaced, /EXP-OLD/)
  assert.match(replaced, /## Other/)
})

test('appendEvolutionLog increments rounds', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-log-'))
  try {
    const log = path.join(dir, 'EVOLUTION.md')
    assert.equal(evolutionRounds(log), 0)
    appendEvolutionLog(log, { newRules: 2, verified: true, sources: ['a.md'], command: 'test' })
    appendEvolutionLog(log, { newRules: 1, verified: false, sources: ['b.md'], command: 'test' })
    assert.equal(evolutionRounds(log), 2)
    const text = readFileSync(log, 'utf8')
    assert.match(text, /## Round 1/)
    assert.match(text, /## Round 2/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('profileAgentsPath respects DSH_HOME', () => {
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = 'C:/tmp/dsh-home'
  try {
    assert.equal(profileAgentsPath('web'), path.join('C:/tmp/dsh-home', 'profiles', 'web', 'AGENTS.md'))
  } finally {
    if (old === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = old
  }
})

test('extractFromLog turns error lines into conditional rules and skips noise', () => {
  const log = [
    'info: resolving packages',
    'ERROR: Cannot read properties of undefined (reading prepare)',
    'done in 1.2s',
    'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED: git install blocked',
    'warn: nothing to do',
  ].join('\n')
  const entries = extractFromLog(log, 'debug plugin install', 'install.log', 'check allowBuilds and re-run')
  assert.equal(entries.length, 2)
  assert.ok(entries.every((e) => e.rule.startsWith('When "')))
  assert.ok(entries.some((e) => e.rule.includes('allowBuilds')))
  assert.ok(entries.some((e) => e.source.includes('install.log:')))
  assert.ok(entries.every((e) => e.tags.includes('log')))
})

test('ruleSimilarity and auditRules flag near-duplicates', () => {
  const a = 'Never run recursive directory listings through node_modules'
  const b = 'Never run recursive directory listings through node_modules; prefer Glob'
  const c = 'Always warm up the model cache before benchmarks'
  assert.ok(ruleSimilarity(a, b) > 0.7)
  assert.ok(ruleSimilarity(a, c) < 0.5)
  const entries = [
    { id: 'EXP-001', rule: a, source: 'x.md', tags: ['perf'], verified: true },
    { id: 'EXP-002', rule: b, source: 'y.md', tags: ['perf'], verified: false },
    { id: 'EXP-003', rule: c, source: 'z.md', tags: ['general'], verified: true },
  ]
  const report = auditRules(entries)
  assert.equal(report.total, 3)
  assert.equal(report.verified, 2)
  assert.equal(report.duplicates.length, 1)
  assert.deepEqual(report.duplicates[0], ['EXP-001', 'EXP-002'])
})

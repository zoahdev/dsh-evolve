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
  toolReadiness,
  renderReadiness,
  scoreRule,
  ruleLifecycle,
  pruneRules,
  mergeDuplicateRules,
  recallRules,
  parseEvolutionLog,
  renderGrowthDashboard,
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

test('toolReadiness parses doctor-style JSON and renders a report', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-ready-'))
  try {
    const script = path.join(dir, 'fake-check.mjs')
    writeFileSync(script, `console.log(JSON.stringify({ checks: [
      { name: 'manifest', status: 'PASS', detail: 'ok' },
      { name: 'entry', status: 'WARN', detail: 'lib not built' },
      { name: 'pack', status: 'FAIL', detail: 'pack failed' }
    ] })); process.exit(1)`)
    const cmd = `${process.execPath} ${script}`
    const report = toolReadiness(cmd, 'my-plugin')
    assert.equal(report.ok, false)
    assert.equal(report.checks.length, 3)
    const rendered = renderReadiness(report)
    assert.match(rendered, /1 pass \/ 1 warn \/ 1 fail/)
    assert.match(rendered, /ISSUES FOUND/)
    assert.match(rendered, /pack failed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tool-verify CLI learns rules from a failing readiness report', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-tv-'))
  try {
    const script = path.join(dir, 'fake-check.mjs')
    writeFileSync(script, `console.log(JSON.stringify({ checks: [
      { name: 'pack', status: 'FAIL', detail: 'pack failed with ERR_X' }
    ] })); process.exit(1)`)
    const exp = path.join(dir, 'experience.jsonl')
    const reportOut = path.join(dir, 'report.md')
    const cli = path.join(ROOT, 'scripts', 'dsh-evolve.mjs')
    const r = spawnSync(process.execPath, [
      cli, 'tool-verify', '--dir', 'repo-x', '--out', reportOut, '--experience', exp,
      '--verify-cmd', `${process.execPath} ${script}`,
    ], { encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.match(readFileSync(reportOut, 'utf8'), /ISSUES FOUND/)
    const entries = readFileSync(exp, 'utf8').trim().split('\n').map(JSON.parse)
    assert.ok(entries.length >= 1)
    assert.ok(entries.every((e) => e.verified === false))
    assert.ok(entries.some((e) => e.rule.includes('ERR_X')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rule lifecycle: scores, stale classification, soft prune and merge', () => {
  const old = 'Never run recursive directory listings through node_modules'
  const near = 'Never run recursive directory listings through node_modules; prefer Glob'
  const entries = [
    { id: 'EXP-001', rule: old, source: 'a.md', tags: ['perf'], verified: true, verifiedCount: 3, usageCount: 5, addedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() },
    { id: 'EXP-002', rule: near, source: 'b.md', tags: ['perf'], verified: false, verifiedCount: 0, usageCount: 0, addedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() },
    { id: 'EXP-003', rule: 'Always warm the model cache', source: 'c.md', tags: ['perf'], verified: true, verifiedCount: 1, usageCount: 0, addedAt: new Date().toISOString() },
  ]
  assert.ok(scoreRule(entries[0]) > scoreRule(entries[1]))

  const lifecycle = ruleLifecycle(entries, 3)
  assert.equal(lifecycle.find((e) => e.id === 'EXP-001').lifecycle, 'active')
  assert.equal(lifecycle.find((e) => e.id === 'EXP-002').lifecycle, 'stale')

  const removed = pruneRules(entries, 3, false)
  assert.ok(removed.includes('EXP-002'))
  assert.equal(entries.find((e) => e.id === 'EXP-002').retired, true)

  const dup = [
    { id: 'EXP-001', rule: old, source: 'a.md', tags: ['perf'], verified: true, verifiedCount: 3, usageCount: 5 },
    { id: 'EXP-002', rule: near, source: 'b.md', tags: ['perf'], verified: false, verifiedCount: 0, usageCount: 0 },
  ]
  const merges = mergeDuplicateRules(dup, 0.7, false)
  assert.equal(merges.length, 1)
  const low = dup.find((e) => e.merged === true)
  const high = dup.find((e) => e.id === low.mergedInto)
  assert.equal(high.id, 'EXP-001')
})

test('recallRules ranks relevant rules and rewards verified/used ones', () => {
  const entries = [
    { id: 'EXP-001', rule: 'Never run recursive directory listings through node_modules', source: 'a.md', verified: true, usageCount: 3 },
    { id: 'EXP-002', rule: 'Allow build scripts for git installs via allowBuilds', source: 'b.md', verified: false, usageCount: 0 },
    { id: 'EXP-003', rule: 'Recursive directory scans are slow; prefer Glob', source: 'c.md', verified: true, usageCount: 0 },
  ]
  const results = recallRules(entries, 'recursive directory listings', 5)
  assert.ok(results.length >= 2)
  assert.equal(results[0].id, 'EXP-001', 'verified + used relevant rule ranks first')
  assert.ok(results.some((r) => r.id === 'EXP-003'))
  assert.ok(!results.some((r) => r.id === 'EXP-002'))
  assert.throws(() => recallRules(entries, 'a', 5), /query must contain words/)
})

test('merged experience keeps unique EXP ids across batches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-evolve-ids-'))
  try {
    const cli = path.join(ROOT, 'scripts', 'dsh-evolve.mjs')
    const exp = path.join(dir, 'experience.jsonl')
    const a = path.join(dir, 'a.md')
    const b = path.join(dir, 'b.log')
    writeFileSync(a, '- Never run recursive listings through node_modules.\n- Always verify rules with real checks.\n')
    writeFileSync(b, 'ERROR: first failure line\nERROR: second failure line\ninfo: progress\n')
    const r1 = spawnSync(process.execPath, [cli, 'reflect', '--task', 't1', '--result', a, '--out', exp], { encoding: 'utf8' })
    assert.equal(r1.status, 0, r1.stderr)
    const r2 = spawnSync(process.execPath, [cli, 'extract', '--task', 't2', '--from', b, '--out', exp], { encoding: 'utf8' })
    assert.equal(r2.status, 0, r2.stderr)
    const entries = readFileSync(exp, 'utf8').trim().split('\n').map(JSON.parse)
    const ids = entries.map((e) => e.id)
    assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(',')}`)
    assert.equal(entries.length, 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseEvolutionLog extracts rounds', () => {
  const log = '## Round 1 — 2026-08-15T10:00:00Z\n- New rules: 5\n- Verified: yes\n\n## Round 2 — 2026-08-15T11:00:00Z\n- New rules: 6\n- Verified: no\n'
  const rounds = parseEvolutionLog(log)
  assert.equal(rounds.length, 2)
  assert.equal(rounds[0].round, 1)
  assert.equal(rounds[0].newRules, 5)
  assert.equal(rounds[0].verified, true)
  assert.equal(rounds[1].verified, false)
})

test('renderGrowthDashboard produces a self-contained report', () => {
  const entries = [
    { id: 'EXP-001', rule: 'Never rely on /bin/bash on Windows', source: 'a.md', tags: ['windows'], verified: true, usageCount: 2, addedAt: '2026-08-15T10:00:00Z' },
    { id: 'EXP-002', rule: 'Configure NPM_TOKEN before publishing', source: 'b.log', tags: ['install'], verified: true, usageCount: 1, addedAt: '2026-08-15T11:00:00Z' },
  ]
  const html = renderGrowthDashboard(entries, [{ round: 1, date: '2026-08-15T10:00:00Z', newRules: 2, verified: true }])
  assert.match(html, /Your agent/)
  assert.match(html, /<b>2<\/b>/)
  assert.match(html, /Round 1/)
  assert.match(html, /windows × 1/)
  assert.match(html, /Times rules used/)
  assert.match(html, /Download PNG/)
  assert.match(html, /function downloadPng/)
})

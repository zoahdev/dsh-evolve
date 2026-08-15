import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractExperience, renderRules } from '../scripts/dsh-evolve.mjs'

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

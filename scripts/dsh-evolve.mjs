#!/usr/bin/env node
/**
 * dsh-evolve — verification-driven self-evolution loop.
 *
 * The loop:
 *   1. learn/reflect   extract experience entries from markdown
 *   2. rules           render entries into an auditable AGENTS.md rules block
 *   3. verify          run real checks and stamp each entry
 *   4. evolve          verify + install rules into a dsh profile + log the round
 *
 * Rules carry their source and verification status, so "the agent evolved"
 * is always traceable and never unverified. Zero runtime dependencies.
 *
 * Usage:
 *   node scripts/dsh-evolve.mjs learn --from README.md --out experience.jsonl
 *   node scripts/dsh-evolve.mjs rules --experience experience.jsonl --out AGENTS.md
 *   node scripts/dsh-evolve.mjs verify --experience experience.jsonl --dir <repo> [--cmd "node lib/bin.js check DIR --json"]
 *   node scripts/dsh-evolve.mjs reflect --task "..." --result retro.md --out experience.jsonl
 *   node scripts/dsh-evolve.mjs evolve --experience experience.jsonl --dir <repo> --profile web
 *   node scripts/dsh-evolve.mjs install-rules --experience experience.jsonl --profile web
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const ACTION_RE = /(must|never|always|do not|avoid|required|needs?\b|install|禁止|必须|不要|避免|→|=>|->|should)/i
const TAG_HINTS = [
  [/install|allowBuilds|pnpm|npm/i, 'install'],
  [/crash|fatal|崩溃|报错|error/i, 'crash'],
  [/windows|win32/i, 'windows'],
  [/test|测试/i, 'test'],
  [/memory|remember|记忆/i, 'memory'],
  [/security|安全/i, 'security'],
  [/perf|performance|效率/i, 'performance'],
]

function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

function inferTags(rule) {
  const tags = []
  for (const [re, tag] of TAG_HINTS) {
    if (re.test(rule) && !tags.includes(tag)) tags.push(tag)
  }
  return tags.length > 0 ? tags : ['general']
}

/** Extract deduplicated experience entries from markdown text. */
export function extractExperience(markdown, source) {
  const entries = []
  const seen = new Set()
  let n = 0
  for (const raw of markdown.split('\n')) {
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(raw)
    if (!m) continue
    const rule = m[1].trim().replace(/\s+/g, ' ')
    if (!ACTION_RE.test(rule)) continue
    const key = hash(rule)
    if (seen.has(key)) continue
    seen.add(key)
    n += 1
    entries.push({
      id: `EXP-${String(n).padStart(3, '0')}`,
      rule,
      source,
      tags: inferTags(rule),
      addedAt: new Date().toISOString(),
      verified: null,
      lastVerifiedAt: null,
    })
  }
  return entries
}

const NOISE_RE = /^\s*(warn|info|progress|resolved|added|done|success|ok)\b|resolved \d+|added \d+|done in/i
const ERROR_RE = /(error|failed|fatal|exception|cannot|unable|denied|not found|timeout|ENOENT|ERESOLVE|ERR_|exit code|失败|报错|错误|无法|拒绝|超时)/i

/**
 * Extract experience entries from a raw failure log: error lines become
 * conditional rules ("when <error> occurs, <remedy>"). Honest heuristic —
 * rules still need verification before they are trusted.
 */
export function extractFromLog(logText, task, source, hint = 'investigate before proceeding') {
  const entries = []
  const seen = new Set()
  let n = 0
  const lines = logText.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line === '' || NOISE_RE.test(line) || !ERROR_RE.test(line)) continue
    const rule = `When "${line.slice(0, 160)}" occurs, ${hint}.`
    const key = hash(rule)
    if (seen.has(key)) continue
    seen.add(key)
    n += 1
    entries.push({
      id: `EXP-${String(n).padStart(3, '0')}`,
      rule,
      source: `${source}:${i + 1}`,
      tags: ['log', ...inferTags(line)],
      task,
      addedAt: new Date().toISOString(),
      verified: null,
      lastVerifiedAt: null,
    })
  }
  return entries
}

/** Jaccard similarity between two rule strings (word bigrams). */
export function ruleSimilarity(a, b) {
  const grams = (s) => {
    const words = s.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
    const set = new Set()
    for (let i = 0; i < words.length - 1; i += 1) set.add(`${words[i]} ${words[i + 1]}`)
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter += 1
  const union = new Set([...ga, ...gb]).size
  return inter / union
}

/** Audit a rule library: health, tags, sources, near-duplicates. */
export function auditRules(entries, threshold = 0.7) {
  const byTag = {}
  const bySource = {}
  const duplicates = []
  for (const e of entries) {
    for (const tag of e.tags ?? []) byTag[tag] = (byTag[tag] ?? 0) + 1
    bySource[e.source] = (bySource[e.source] ?? 0) + 1
  }
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (ruleSimilarity(entries[i].rule, entries[j].rule) >= threshold) {
        duplicates.push([entries[i].id, entries[j].id])
      }
    }
  }
  return {
    total: entries.length,
    verified: entries.filter((e) => e.verified === true).length,
    unverified: entries.filter((e) => e.verified !== true).length,
    byTag,
    bySource,
    duplicates,
  }
}

/**
 * Tool-learning step: run a readiness command (default: dsh-plugin-doctor
 * check), parse its JSON checks when available, render a readiness report,
 * and append the findings to the experience store so the lesson is learned.
 */
export function toolReadiness(verifyCmd, dir) {
  const parts = verifyCmd.split(/\s+/).map((t) => t.replace(/^"|"$/g, ''))
  const result = spawnSync(parts[0], parts.slice(1), { encoding: 'utf8', timeout: 300_000 })
  let checks = null
  try {
    const parsed = JSON.parse(result.stdout)
    if (Array.isArray(parsed.checks)) checks = parsed.checks
  } catch { /* non-JSON output: fall back to exit code only */ }
  const ok = result.status === 0
  return { ok, exitCode: result.status, stdout: result.stdout, stderr: result.stderr, checks, dir }
}

export function renderReadiness(report) {
  const lines = [`# Tool readiness report — ${report.dir}`, '']
  lines.push(`- Generated: ${new Date().toISOString()}`)
  lines.push(`- Verify exit: ${report.exitCode}`)
  if (report.checks !== null) {
    const pass = report.checks.filter((c) => c.status === 'PASS').length
    const warn = report.checks.filter((c) => c.status === 'WARN').length
    const fail = report.checks.filter((c) => c.status === 'FAIL').length
    lines.push(`- Checks: ${pass} pass / ${warn} warn / ${fail} fail`)
    lines.push('')
    lines.push('| Check | Status | Detail |')
    lines.push('| --- | --- | --- |')
    for (const c of report.checks) {
      lines.push(`| ${c.name} | ${c.status} | ${String(c.detail ?? '').replace(/\|/g, '\\|').slice(0, 120)} |`)
    }
  }
  lines.push('', `- Overall: ${report.ok ? '**READY ✅**' : '**ISSUES FOUND ❌**'}`)
  return lines.join('\n')
}

/** Render entries into an AGENTS.md rules block (appendable). */
export function renderRules(entries) {
  const lines = []
  lines.push('## Self-evolution rules')
  lines.push('')
  lines.push('> Auto-generated by dsh-evolve. Rules are traceable to their source and to the last verification run.')
  lines.push('')
  for (const entry of entries) {
    const status = entry.verified === true ? '✅ verified'
      : entry.verified === false ? '❌ verification failed'
        : '○ unverified'
    lines.push(`- [${entry.id}] ${entry.rule} _(source: ${entry.source} · ${status}${entry.lastVerifiedAt ? ' · ' + entry.lastVerifiedAt.slice(0, 10) : ''})_`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Path of a dsh profile's AGENTS.md (respects DSH_HOME, defaults ~/.dsh). */
export function profileAgentsPath(profile) {
  const home = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh')
  return path.join(home, 'profiles', profile, 'AGENTS.md')
}

/**
 * Merge the rendered rules block into existing AGENTS.md content:
 * replaces the previous Self-evolution rules block, or appends one.
 */
export function mergeRules(existing, rendered) {
  const marker = '## Self-evolution rules'
  const idx = existing.indexOf(marker)
  if (idx === -1) {
    return `${existing.replace(/\s*$/, '')}\n\n${rendered.trim()}\n`
  }
  const next = existing.indexOf('\n## ', idx + marker.length)
  const block = next === -1 ? existing.slice(idx) : existing.slice(idx, next)
  return existing.replace(block, `${rendered.trim()}\n`)
}

/** Count completed evolution rounds in a log file. */
export function evolutionRounds(logFile) {
  if (!existsSync(logFile)) return 0
  return (readFileSync(logFile, 'utf8').match(/^## Round \d+/gm) ?? []).length
}

/** Append one evolution-round entry to the log. */
export function appendEvolutionLog(logFile, entry) {
  mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true })
  const round = evolutionRounds(logFile) + 1
  const lines = [
    `## Round ${round} — ${new Date().toISOString()}`,
    '',
    `- New rules: ${entry.newRules}`,
    `- Verified: ${entry.verified ? 'yes ✅' : 'no ❌'}`,
    `- Sources: ${entry.sources.join(', ')}`,
    `- Command: \`${entry.command}\``,
    '',
  ]
  const previous = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
  writeFileSync(logFile, `${previous.replace(/\s*$/, '')}\n\n${lines.join('\n')}`, 'utf8')
  return round
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else {
      args._.push(arg)
    }
  }
  return args
}

function loadEntries(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

function saveEntries(file, entries) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0] ?? 'help'

if (command === 'help' || args.help) {
  console.log(`dsh-evolve — verification-driven self-evolution loop

Usage:
  dsh-evolve learn --from <md|dir> --out <jsonl>        extract experience entries
  dsh-evolve rules --experience <jsonl> [--out <md>]    render AGENTS.md rules block
  dsh-evolve verify --experience <jsonl> --dir <repo>   stamp entries with a real check
                      [--cmd "node lib/bin.js check DIR --json"]
  dsh-evolve reflect --task <text> --result <md> --out <jsonl>   reflection -> experience
  dsh-evolve evolve --experience <jsonl> --dir <repo> [--profile P] [--log EVOLUTION.md]
  dsh-evolve install-rules --experience <jsonl> --profile P [--dry-run]
`)
  process.exit(0)
}

if (command === 'learn') {
  const from = args.from
  const out = args.out ?? 'experience.jsonl'
  if (!from || !existsSync(from)) {
    console.error(`learn: cannot read ${from ?? '(missing --from)'}`)
    process.exit(1)
  }
  const text = existsSync(from) && !existsSync(path.join(from, 'package.json'))
    ? readFileSync(from, 'utf8')
    : readFileSync(path.join(from, 'README.md'), 'utf8')
  const entries = extractExperience(text, from)
  saveEntries(out, entries)
  console.log(`learned ${entries.length} experience entries -> ${out}`)
  process.exit(0)
}

if (command === 'rules') {
  const entries = loadEntries(args.experience ?? 'experience.jsonl')
  const rendered = renderRules(entries)
  if (args.out) writeFileSync(args.out, rendered + '\n', 'utf8')
  console.log(rendered)
  process.exit(0)
}

if (command === 'verify') {
  const file = args.experience ?? 'experience.jsonl'
  const dir = args.dir ?? '.'
  const cmd = args.cmd ?? `node ${path.join(process.cwd(), '..', 'doctor', 'lib', 'bin.js')} check ${dir} --json`
  const parts = cmd.split(/\s+/).map((t) => t.replace(/^"|"$/g, ''))
  const result = spawnSync(parts[0], parts.slice(1), { encoding: 'utf8', timeout: 180_000 })
  const entries = loadEntries(file)
  if (entries.length === 0) {
    console.log('verify: no entries to verify')
    process.exit(0)
  }
  const ok = result.status === 0
  for (const entry of entries) {
    entry.verified = ok
    entry.lastVerifiedAt = new Date().toISOString()
  }
  saveEntries(file, entries)
  console.log(`verify: exit ${result.status} — ${entries.length} entries ${ok ? 'verified ✅' : 'marked failed ❌'}`)
  process.exit(ok ? 0 : 1)
}

if (command === 'loop') {
  const from = args.from
  const out = args.out ?? 'experience.jsonl'
  const text = readFileSync(from, 'utf8')
  const entries = extractExperience(text, from)
  saveEntries(out, entries)
  console.log(renderRules(entries))
  if (args.dir) {
    const dir = args.dir
    const parts = `node ${path.join(process.cwd(), '..', 'doctor', 'lib', 'bin.js')} check ${dir} --json`.split(/\s+/)
    const result = spawnSync(parts[0], parts.slice(1), { encoding: 'utf8', timeout: 180_000 })
    for (const entry of entries) {
      entry.verified = result.status === 0
      entry.lastVerifiedAt = new Date().toISOString()
    }
    saveEntries(out, entries)
    console.log(`loop verify: exit ${result.status}`)
  }
  process.exit(0)
}

if (command === 'reflect') {
  const task = args.task ?? ''
  const goal = args.goal ?? ''
  const result = args.result
  const out = args.out ?? 'experience.jsonl'
  if (!task || !result || !existsSync(result)) {
    console.error('reflect: --task and --result <md-file> are required')
    process.exit(1)
  }
  const text = readFileSync(result, 'utf8')
  const fresh = extractExperience(text, result).map((e) => ({
    ...e,
    task,
    goal: goal || undefined,
    reflectedAt: new Date().toISOString(),
  }))
  const existing = loadEntries(out)
  const seen = new Set(existing.map((e) => hash(e.rule)))
  const added = fresh.filter((e) => !seen.has(hash(e.rule)))
  saveEntries(out, [...existing, ...added])
  console.log(`reflect: ${added.length} new experience entries from reflection -> ${out} (total ${existing.length + added.length})`)
  process.exit(0)
}

if (command === 'install-rules') {
  const file = args.experience ?? 'experience.jsonl'
  const profile = args.profile
  if (!profile) {
    console.error('install-rules: --profile <name> is required')
    process.exit(1)
  }
  const entries = loadEntries(file)
  const rendered = renderRules(entries)
  const agentsPath = profileAgentsPath(profile)
  const previous = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
  const merged = mergeRules(previous, rendered)
  if (args['dry-run']) {
    console.log(merged)
    process.exit(0)
  }
  mkdirSync(path.dirname(agentsPath), { recursive: true })
  if (previous !== merged) {
    writeFileSync(`${agentsPath}.bak-${Date.now()}`, previous)
  }
  writeFileSync(agentsPath, merged)
  console.log(`install-rules: ${entries.length} rules installed into ${agentsPath}`)
  process.exit(0)
}

if (command === 'evolve') {
  const file = args.experience ?? 'experience.jsonl'
  const dir = args.dir ?? '.'
  const profile = args.profile
  const rulesOut = args['rules-out']
  const logFile = args.log ?? 'EVOLUTION.md'
  const entries = loadEntries(file)
  if (entries.length === 0) {
    console.error('evolve: no experience entries to evolve')
    process.exit(1)
  }
  const cmd = args.cmd ?? `node ${path.join(process.cwd(), '..', 'doctor', 'lib', 'bin.js')} check ${dir} --json`
  const parts = cmd.split(/\s+/).map((t) => t.replace(/^"|"$/g, ''))
  const result = spawnSync(parts[0], parts.slice(1), { encoding: 'utf8', timeout: 180_000 })
  const ok = result.status === 0
  for (const entry of entries) {
    entry.verified = ok
    entry.lastVerifiedAt = new Date().toISOString()
  }
  saveEntries(file, entries)
  const rendered = renderRules(entries)
  if (rulesOut) writeFileSync(rulesOut, `${rendered}\n`, 'utf8')
  if (profile) {
    const agentsPath = profileAgentsPath(profile)
    const previous = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
    const merged = mergeRules(previous, rendered)
    mkdirSync(path.dirname(agentsPath), { recursive: true })
    if (previous !== merged) writeFileSync(`${agentsPath}.bak-${Date.now()}`, previous)
    writeFileSync(agentsPath, merged)
    console.log(`evolve: rules installed into ${agentsPath}`)
  }
  const round = appendEvolutionLog(logFile, {
    newRules: entries.length,
    verified: ok,
    sources: [...new Set(entries.map((e) => e.source))],
    command: `dsh-evolve evolve --experience ${file} --dir ${dir}${profile ? ` --profile ${profile}` : ''}`,
  })
  console.log(`evolve: round ${round} — ${entries.length} rules, ${ok ? 'verified ✅' : 'verification failed ❌'} — log: ${logFile}`)
  process.exit(ok ? 0 : 1)
}

if (command === 'extract') {
  const task = args.task ?? ''
  const from = args.from
  const out = args.out ?? 'experience.jsonl'
  const hint = args.hint ?? 'investigate before proceeding'
  if (!task || !from || !existsSync(from)) {
    console.error('extract: --task and --from <log-file> are required')
    process.exit(1)
  }
  const logText = readFileSync(from, 'utf8')
  const fresh = extractFromLog(logText, task, from, hint)
  const existing = loadEntries(out)
  const seen = new Set(existing.map((e) => hash(e.rule)))
  const added = fresh.filter((e) => !seen.has(hash(e.rule)))
  saveEntries(out, [...existing, ...added])
  console.log(`extract: ${added.length} rules extracted from failure log -> ${out} (total ${existing.length + added.length})`)
  process.exit(0)
}

if (command === 'audit') {
  const entries = loadEntries(args.experience ?? 'experience.jsonl')
  const report = auditRules(entries)
  const lines = [
    '# dsh-evolve rule library audit',
    '',
    `- Total rules: ${report.total}`,
    `- Verified: ${report.verified}`,
    `- Unverified: ${report.unverified}`,
    '',
    'By tag:',
    '',
    ...Object.entries(report.byTag).sort((a, b) => b[1] - a[1]).map(([t, c]) => `- ${t}: ${c}`),
    '',
    'By source:',
    '',
    ...Object.entries(report.bySource).sort((a, b) => b[1] - a[1]).map(([s, c]) => `- ${s}: ${c}`),
    '',
  ]
  if (report.duplicates.length > 0) {
    lines.push('Near-duplicate rule pairs (similarity >= 0.8):', '')
    for (const [a, b] of report.duplicates) lines.push(`- ${a} ~ ${b}`)
    lines.push('')
  } else {
    lines.push('No near-duplicate rule pairs.', '')
  }
  const rendered = lines.join('\n')
  if (args.out) writeFileSync(args.out, `${rendered}\n`, 'utf8')
  console.log(rendered)
  process.exit(0)
}

if (command === 'tool-verify') {
  const dir = args.dir ?? '.'
  const out = args.out
  const file = args.experience ?? 'experience.jsonl'
  const verifyCmd = args['verify-cmd']
    ?? `node ${path.join(process.cwd(), '..', 'doctor', 'lib', 'bin.js')} check ${dir} --json`
  const report = toolReadiness(verifyCmd, dir)
  const rendered = renderReadiness(report)
  if (out) writeFileSync(out, `${rendered}\n`, 'utf8')
  console.log(rendered)

  // Tool-learning: failures/warnings become experience entries.
  const problemLines = (report.checks ?? [])
    .filter((c) => c.status === 'FAIL' || c.status === 'WARN')
    .map((c) => `ERROR: ${c.name}: ${c.detail}`)
  if (problemLines.length > 0) {
    const fresh = extractFromLog(
      problemLines.join('\n'),
      `make ${dir} ready`,
      `tool-verify:${dir}`,
      'fix the failing check before shipping',
    )
    const existing = loadEntries(file)
    const seen = new Set(existing.map((e) => hash(e.rule)))
    const added = fresh.filter((e) => !seen.has(hash(e.rule)))
    for (const e of added) {
      e.verified = report.ok
      e.lastVerifiedAt = new Date().toISOString()
    }
    saveEntries(file, [...existing, ...added])
    console.log(`tool-verify: learned ${added.length} rule(s) -> ${file} (verified: ${report.ok})`)
  } else {
    console.log('tool-verify: no issues to learn from')
  }
  process.exit(report.ok ? 0 : 1)
}

  console.error(`unknown command: ${command} (run 'dsh-evolve help')`)
  process.exit(1)
}

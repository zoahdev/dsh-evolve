/**
 * dsh-rule-evolve plugin — in-session self-evolution for DeepSeek Harness.
 *
 * Tools:
 *   evolve_learn   extract lessons from a failure log or a retrospective and
 *                  persist them to the profile's experience store
 *   evolve_apply   verify rules with a user-supplied command, then install
 *                  them into the profile's AGENTS.md (with backup)
 *
 * Rules are never installed unverified: evolve_apply requires a verifyCmd
 * that exits 0, or returns the rules as a dry-run instead.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  extractExperience,
  extractFromLog,
  renderRules,
  mergeRules,
  profileAgentsPath,
  profileDataPath,
} from './core.js'

export const name = 'dsh-rule-evolve'

export const inject = ['tools']

function loadEntries(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

function saveEntries(file, entries) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}

function createTools() {
  return [
    defineTool({
      name: 'evolve_learn',
      description:
        'Extract lessons from a failure log or retrospective and persist them to the profile experience store. '
        + 'Error lines become conditional rules ("When <error> occurs, <hint>."); markdown bullets become rules. '
        + 'Rules are NOT verified yet — use evolve_apply with a verifyCmd to install them.',
      parameters: {
        task: { type: 'string', description: 'What the agent was trying to do (required)' },
        experience: { type: 'string', description: 'Failure log text or markdown retrospective (required)' },
        hint: { type: 'string', description: 'Remedy to attach to error-line rules' },
        source: { type: 'string', description: 'Source label for provenance (default: session)' },
        profile: { type: 'string', description: 'dsh profile name (default: web)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            added: { type: 'integer', required: true },
            total: { type: 'integer', required: true },
            profile: { type: 'string', required: true },
            file: { type: 'string', required: true },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `Learned ${value.added} new rule(s) (${value.total} total) for profile ${value.profile}: ${value.file}`,
        }],
      },
      async execute(args) {
        const profile = /^[A-Za-z0-9_-]+$/.test(args.profile ?? '') ? args.profile : 'web'
        const source = args.source ?? 'session'
        const text = String(args.experience ?? '')
        const fresh = /(ERROR|Error|failed|FATAL|ERR_|ENOENT|Cannot|Unable|exit code)/.test(text)
          ? extractFromLog(text, args.task ?? '', source, args.hint ?? 'investigate before proceeding')
          : extractExperience(text, source)
        const file = profileDataPath(profile)
        const existing = loadEntries(file)
        const seen = new Set(existing.map((e) => e.rule))
        const added = fresh.filter((e) => !seen.has(e.rule))
        saveEntries(file, [...existing, ...added])
        return { added: added.length, total: existing.length + added.length, profile, file }
      },
      presentCall: (args) => ({ card: 'generic', title: `Evolve learn: ${args.task ?? 'session'}`, kind: 'other', rawInput: args }),
    }),

    defineTool({
      name: 'evolve_apply',
      description:
        'Verify the profile experience store with a user-supplied command and install the rules into the profile '
        + 'AGENTS.md (previous file backed up). If verifyCmd is omitted or exits non-zero, nothing is installed.',
      parameters: {
        profile: { type: 'string', description: 'dsh profile name (default: web)' },
        verifyCmd: { type: 'string', description: 'Command that exits 0 when the rules hold (e.g. a doctor check)' },
        dryRun: { type: 'boolean', description: 'Return the rendered rules without installing' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            installed: { type: 'boolean', required: true },
            rules: { type: 'integer', required: true },
            verified: { type: 'boolean', required: true },
            agentsPath: { type: 'string', required: true },
            dryRun: { type: 'boolean', required: true },
            note: { type: 'string', required: true },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: value.installed
            ? `Installed ${value.rules} verified rule(s) into ${value.agentsPath}`
            : `Not installed (${value.rules} rule(s) ${value.verified ? 'verified' : 'unverified'}): ${value.note}`,
        }],
      },
      async execute(args) {
        const profile = /^[A-Za-z0-9_-]+$/.test(args.profile ?? '') ? args.profile : 'web'
        const file = profileDataPath(profile)
        const entries = loadEntries(file)
        const dryRun = args.dryRun === true
        const rendered = renderRules(entries)
        const agentsPath = profileAgentsPath(profile)
        if (dryRun || !args.verifyCmd) {
          return {
            installed: false,
            rules: entries.length,
            verified: false,
            agentsPath,
            dryRun,
            note: dryRun
              ? 'dry-run: rules below'
              : 'no verifyCmd provided — rules stay unverified; provide verifyCmd to install',
          }
        }
        const parts = String(args.verifyCmd).split(/\s+/).map((t) => t.replace(/^"|"$/g, ''))
        const result = spawnSync(parts[0], parts.slice(1), {
          encoding: 'utf8',
          timeout: 180_000,
          shell: process.platform === 'win32' && parts[0].endsWith('.cmd') ? true : false,
        })
        const ok = result.status === 0
        for (const entry of entries) {
          entry.verified = ok
          entry.lastVerifiedAt = new Date().toISOString()
        }
        saveEntries(file, entries)
        if (!ok) {
          return {
            installed: false,
            rules: entries.length,
            verified: false,
            agentsPath,
            dryRun: false,
            note: `verifyCmd exited ${result.status} — nothing installed; fix the checks first`,
          }
        }
        const previous = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : ''
        const merged = mergeRules(previous, rendered)
        mkdirSync(path.dirname(agentsPath), { recursive: true })
        if (previous !== merged) writeFileSync(`${agentsPath}.bak-${Date.now()}`, previous)
        writeFileSync(agentsPath, merged)
        return {
          installed: true,
          rules: entries.length,
          verified: true,
          agentsPath,
          dryRun: false,
          note: `verified and installed; previous AGENTS.md backed up`,
        }
      },
      presentCall: (args) => ({ card: 'generic', title: `Evolve apply (${args.profile ?? 'web'})`, kind: 'other', rawInput: args }),
    }),
  ]
}

export function apply(ctx) {
  for (const tool of createTools()) {
    ctx.tools.register(tool)
  }
}

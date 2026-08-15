# dsh-rule-evolve

**Verification-driven self-evolution loop for DeepSeek Harness.**

> Renamed from `dsh-evolve` (old URL redirects). Reason: another community
> project ([william-jin-cmu/dsh-evolve](https://github.com/william-jin-cmu/dsh-evolve))
> already uses that name for in-session plugin hot-mounting. Different focus:
> that project evolves which plugins are mounted; this project evolves which
> **rules** are trusted, with verification gates. The CLI command stays
> `dsh-evolve` for compatibility (`dsh-rule-evolve` is also available).

Agents keep repeating the same expensive lessons: a crash fixed last week gets
re-debugged today, a Windows quirk gets rediscovered, an install trap gets
re-hit. dsh-evolve turns that loop into a traceable pipeline:

```text
experience (markdown)  →  learn  →  rules (AGENTS.md)  →  verify (real checks)
```

Every rule carries its source and its last verification result — evolution is
auditable, and nothing is ever "learned" without being checked.

## Quick start

```sh
node scripts/dsh-evolve.mjs learn --from docs/troubleshooting.md --out experience.jsonl
node scripts/dsh-evolve.mjs rules --experience experience.jsonl --out AGENTS.md
node scripts/dsh-evolve.mjs verify --experience experience.jsonl --dir ./my-plugin
```

`verify` runs the real check pipeline (dsh-plugin-doctor `check <dir>` by
default, override with `--cmd`) and stamps every entry `verified: true/false`.

## Self-improvement loop (v0.2.0)

Full evolution with reflection, profile installation and an evolution log:

```sh
# 1. reflect on a completed task/retrospective
node scripts/dsh-evolve.mjs reflect --task "make my plugin pass its own checks" --result retro.md --out experience.jsonl

# 2. evolve: verify rules against the real repo, install them into a dsh profile,
#    and append one round to EVOLUTION.md
node scripts/dsh-evolve.mjs evolve --experience experience.jsonl --dir ./my-plugin --profile web --log EVOLUTION.md
```

The rules land in `<DSH_HOME>/profiles/web/AGENTS.md` (previous file backed up),
so the next session actually starts with the lessons. Every round is logged:

```markdown
## Round 1 — 2026-08-15T…
- New rules: 5
- Verified: yes ✅
- Sources: examples/doctor-experience.md
- Command: dsh-evolve evolve --experience … --dir … --profile web
```

Dogfood: our doctor repo now passes its own check with 5 verified rules installed
into a profile (see `examples/demo/EVOLUTION.md`).

## Learning from failure logs (v0.3.0)

`extract` turns raw failure logs into conditional rules automatically — no
manual retrospective needed:

```sh
node scripts/dsh-evolve.mjs extract --task "publish to npm" --from install.log \
  --out experience.jsonl --hint "configure the credential and retry"
```

Every `ERROR`/`failed`/`ERR_` line becomes a rule: `When "<error>" occurs,
<hint>.` Noise lines (progress/warnings/success) are skipped; rules are
deduplicated and tagged.

`audit` keeps the rule library healthy:

```sh
node scripts/dsh-evolve.mjs audit --experience experience.jsonl
```

It reports totals, verified/unverified counts, tag and source distribution,
and near-duplicate rule pairs (Jaccard ≥ 0.7) so overlapping lessons can be
merged. Dogfood: extracted 6 rules from our real npm ENEEDAUTH failure log.

## Tool learning (v0.5.0)

`tool-verify` is the "agent wrote a tool → is it ready?" gate:

```sh
node scripts/dsh-evolve.mjs tool-verify --dir ./my-plugin --out readiness.md \
  --experience experience.jsonl
```

It runs the real readiness pipeline (dsh-plugin-doctor `check` by default),
renders a readiness report (checks table, pass/warn/fail, overall READY/ISSUES),
and **learns**: every failing/warning check becomes an experience entry
(stamped with the verification result). A tool that ships with failures
therefore teaches the next tool how not to ship.

Dogfood: our doctor repo reports **8/8 PASS → READY ✅**; before v1.10.1 this
same gate caught its own lint bug.

## Rule lifecycle (v0.6.0)

Rules get a health score and the library self-maintains — no manual cleanup:

```sh
node scripts/dsh-evolve.mjs score --experience experience.jsonl        # score + lifecycle table
node scripts/dsh-evolve.mjs prune --experience experience.jsonl --min-score 3 [--dry-run]
node scripts/dsh-evolve.mjs merge-duplicates --experience experience.jsonl [--threshold 0.7] [--dry-run]
```

- `score`: verified count, usage count, recency → active / stale
- `prune`: soft-retires low-score rules (`retired: true`, reason kept — auditable, never deleted)
- `merge-duplicates`: near-duplicate pairs merge into the higher-scoring rule (`mergedInto` kept)

The library tells you what to keep, what to merge, and what to retire — that
is the "memory that forgets usefully" half of long-term agent learning.

## Cross-session reinforcement (v0.7.0)

Rules now carry **usage and verification history**:

```sh
node scripts/dsh-evolve.mjs touch --experience experience.jsonl --id EXP-001
```

Every successful `verify`/`evolve`/`tool-verify` increments `verifiedCount`;
every `touch` (or the plugin's `evolve_touch` tool) increments `usageCount`.
The health score already rewards both — so rules that are **repeatedly verified
and repeatedly used** survive pruning, while stale rules fade. That is
cross-session reinforcement: the library remembers what works.

One command for the whole loop:

```sh
node scripts/dsh-evolve.mjs loop --from docs/troubleshooting.md --out experience.jsonl --dir ./my-plugin
```

## How rules get into the agent

The generated block is plain AGENTS.md — drop it into your repo root or dsh
profile rules, and every future session sees it:

```markdown
## Self-evolution rules

> Auto-generated by dsh-evolve. Rules are traceable to their source and to the last verification run.

- [EXP-001] Never run recursive directory listings through node_modules; prefer Glob/Grep. _(source: docs/troubleshooting.md · ✅ verified)_
- [EXP-002] allowBuilds entries are required before git installs can run prepare scripts. _(source: docs/troubleshooting.md · ○ unverified)_
```

## Design

- Zero runtime dependencies, Node ≥ 18.
- Experience entries are JSONL: `{ id, rule, source, tags, addedAt, verified, lastVerifiedAt }`.
- Dedup by rule hash; tags are inferred heuristics (install/crash/windows/test/memory/security/performance).
- The verify step is pluggable: point `--cmd` at any command that exits 0 on success.

## Why this fits dsh

Official discussion #1881 proposes triple-layer persistent memory; its Layer 1
is Git-tracked Markdown rules. dsh-evolve is the **production and validation
half of that layer** — where rules come from, and how they stay honest. The
ecosystem already has plenty of memory engines; it has no verification-driven
rule evolution loop.

## License

MIT

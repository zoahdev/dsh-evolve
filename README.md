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

## Local recall (v0.8.0)

`recall` is a zero-dependency BM25-lite retrieval over the rule library —
the retrieval half of #1881's Layer 2 without needing an embedding model:

```sh
node scripts/dsh-evolve.mjs recall --experience experience.jsonl --query "windows bash" --limit 5
# [3.28] EXP-003 ✅ — Never rely on /bin/bash as a default shellPath on Windows…
```

Verified and frequently used rules rank higher. Works offline, no model, no
network — and it is the seam where a real embedding provider can plug in later.

## Agent Growth Dashboard (v0.10.0)

Turn the rule library into something you can **see and share**:

```sh
node scripts/dsh-evolve.mjs dash --experience experience.jsonl --evolution EVOLUTION.md --out agent-growth.html
```

One self-contained HTML page (no dependencies, opens offline): rule growth
curve, library health, what the agent learned, most-used rules, evolution
timeline, and a shareable **Agent Growth Report** card. Bilingual.

Live example: [examples/marathon/agent-growth.html](./examples/marathon/agent-growth.html) — the actual
growth diary from the self-evolution marathon.

One command for the whole loop:

```sh
node scripts/dsh-evolve.mjs loop --from docs/troubleshooting.md --out experience.jsonl --dir ./my-plugin
```

## Evolution badge (v0.11.0)

One command turns the rule library into a README-ready SVG badge:

```sh
dsh-evolve badge --experience experience.jsonl --evolution EVOLUTION.md --out badge.svg
```

![agent rules](https://raw.githubusercontent.com/zoahdev/dsh-rule-evolve/main/examples/badge.svg)

Tiers by verified-rule count: `starting` (0) · `learning` (1-4) · `building` (5-9) · `growing` (10-19) · `legend` (20+). Add `--json` for the machine-readable summary plus the SVG payload.

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
---

# 中文说明

**面向 DeepSeek Harness 的、带验证的智能体自我进化循环。**

> 项目已从 `dsh-evolve` 改名 `dsh-rule-evolve`（旧地址会跳转）。CLI 命令仍保留 `dsh-evolve` 以兼容。

智能体会反复踩同一个坑：上周修好的崩溃这周又 debug 一遍，Windows 的怪癖被重新发现，安装陷阱被再次触发。这个项目把这个循环变成一条可追踪的流水线：

```text
经验（markdown）→ learn → 规则（AGENTS.md）→ verify（真实检查）
```

每条规则都带着来源和最近一次验证结果——进化全程可审计，没有经过检查的东西永远不会被「学到」。

## 快速上手

```sh
node scripts/dsh-evolve.mjs learn --from docs/troubleshooting.md --out experience.jsonl
node scripts/dsh-evolve.mjs rules --experience experience.jsonl --out AGENTS.md
node scripts/dsh-evolve.mjs verify --experience experience.jsonl --dir ./my-plugin
```

`verify` 会跑真实的检查流水线（默认是 dsh-plugin-doctor `check <dir>`，可用 `--cmd` 覆盖），并把每条经验盖上 `verified: true/false`。

## 核心命令一览

| 命令 | 作用 |
| --- | --- |
| `learn` | 从 markdown 经验文档提取规则 |
| `rules` | 把规则库渲染成 AGENTS.md |
| `verify` | 用真实检查验证每条规则 |
| `reflect` | 对完成的任务/复盘做反思 |
| `evolve` | 验证规则 + 装进 dsh profile + 追加进化日志 |
| `extract` | 从失败日志自动提取「当 X 出错时做 Y」的条件规则 |
| `audit` | 规则库健康报告（去重、来源分布、近重复）|
| `tool-verify` | 「agent 写了个工具 → 它能用吗？」就绪门禁 |
| `score` / `prune` / `merge-duplicates` | 规则打分、软淘汰、合并近重复 |
| `touch` | 记录规则被使用（跨会话强化）|
| `recall` | 零依赖 BM25 检索规则库 |
| `dash` | 生成可分享的 Agent 成长报告 HTML（双语）|
| `badge` | 把规则库生成 README 用 SVG 徽章 |
| `loop` | 一条命令跑完整循环 |

## 规则怎么进入 agent

生成的是纯文本 AGENTS.md，放到仓库根目录或 dsh profile 规则里，以后每个会话都能看到：

```markdown
## Self-evolution rules
- [EXP-001] Never run recursive directory listings through node_modules; prefer Glob/Grep. _(source: docs/troubleshooting.md · ✅ verified)_
```

## 设计要点

- 零运行时依赖，Node ≥ 18。
- 经验条目是 JSONL：`{ id, rule, source, tags, addedAt, verified, lastVerifiedAt }`。
- 按规则哈希去重；标签是启发式推断（install/crash/windows/test/memory/security/performance）。
- 验证步骤可插拔：用 `--cmd` 指向任意「成功即退出 0」的命令。

## 为什么契合 dsh

官方讨论 #1881 提出了三层持久记忆；其中第一层是 Git 托管的 Markdown 规则。dsh-rule-evolve 就是这一层的**生产和验证半边**——规则从哪来，以及它们如何保持诚实。生态里已经有很多记忆引擎，但还没有一个带验证驱动的规则进化循环。

## 许可

MIT

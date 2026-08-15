# dsh-rule-evolve — self-evolution marathon (real runs)

> Every number below comes from actual `node scripts/dsh-evolve.mjs` runs on
> 2026-08-15. This is the rule library's growth diary.

## Round 1 — reflection

```sh
reflect --task "make doctor pass its own checks" --result doctor-experience.md
evolve  --experience experience.jsonl --dir ../doctor --profile web
```

- 5 rules extracted from real doctor lessons (#1697/#1842/#1856/#1859/#1863)
- Verified against the real doctor repo (exit 0) → rules installed into the profile AGENTS.md

## Round 2 — failure-log learning

```sh
extract --task "publish to npm" --from npm-publish-log.txt --hint "configure NPM_TOKEN and retry"
evolve  --experience experience.jsonl --dir ../doctor --profile web
```

- +6 rules extracted from a real npm ENEEDAUTH failure log (no manual retrospective)
- Library: 11 rules, all verified ✅, unique EXP ids (regression test added)

## Reinforcement & readiness

```sh
touch EXP-001                    # usageCount + 1
tool-verify --dir ../doctor      # 8/8 PASS → READY ✅
score --experience experience.jsonl
```

- EXP-001 (the #1697 lesson) now carries usage + verification history
- `tool-verify` gates the tool we evolved: 8/8 checks PASS
- `score`: all 11 rules active, zero duplicates

## Library state after the marathon

| Metric | Value |
| --- | --- |
| Rules | 11 |
| Verified | 11 |
| Unique ids | 11 |
| Lifecycle | 11 active, 0 stale/merged/retired |
| Evolution rounds logged | 2 (EVOLUTION.md) |

## What this demonstrates

The loop ran without any manual curation: reflection produced rules, a real
failure log produced more rules, every rule passed a real check before being
installed, usage was tracked, and the library reports its own health. That is
self-evolution with verification — not a demo script.

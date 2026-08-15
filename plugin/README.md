# dsh-rule-evolve (plugin)

In-session self-evolution for DeepSeek Harness. Install the plugin, and your
agent can learn from failures and install verified rules into the profile —
without leaving the conversation.

## Install

```sh
dsh plugin --profile web add github:zoahdev/dsh-rule-evolve#path:/plugin
```

## Tools

| Tool | What it does |
| --- | --- |
| `evolve_learn` | Extracts lessons from a failure log or retrospective and persists them to `profiles/<p>/data/dsh-evolve/experience.jsonl` |
| `evolve_apply` | Verifies rules with a user-supplied command, then installs them into `profiles/<p>/AGENTS.md` (backup created); refuses to install unverified rules |

Example flow the agent can run itself:

```text
evolve_learn(task: "fix plugin install", experience: <error log>, hint: "check allowBuilds")
evolve_apply(profile: "web", verifyCmd: "node <doctor>/lib/bin.js check <repo> --json")
```

Rules are auditable: each one carries its source, tag, and last verification
status. Same core logic as the CLI (`dsh-evolve extract/evolve/audit`).

## 中文

把自我改进循环装进 DSH：agent 在会话里直接从失败日志提取规则，经真实检查
验证后安装进 profile 的 AGENTS.md（自动备份），未验证的规则绝不安装。

```sh
dsh plugin --profile web add github:zoahdev/dsh-rule-evolve#path:/plugin
```

两个工具：`evolve_learn`（失败→经验）、`evolve_apply`（验证→安装）。

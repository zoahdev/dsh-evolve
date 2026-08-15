# dsh-plugin-doctor verified experience

> Real lessons encoded into doctor checks, each tied to an upstream discussion.

- Never ship a plugin whose tool runtime can resolve two physical copies of @deepseek-ai/dsh-tools; the scheduler symbol mismatch crashes every tool call (#1697).
- Never leave a profile package.json with a UTF-8 BOM; dsh web crashes at boot with Unexpected token (#1842).
- Never rely on /bin/bash as a default shellPath on Windows; probe Git Bash or WSL before spawning (#1856).
- Always warn when a profile file exceeds 100 MB; giant session logs hit the 512 MB stringify cap (#1859).
- Never let a pre-execute listener run host-level side effects before returning ask; approval is consent UX, not a sandbox (#1863).

# Tool readiness report — ..\doctor

- Generated: 2026-08-15T12:23:30.565Z
- Verify exit: 0
- Checks: 8 pass / 1 warn / 0 fail

| Check | Status | Detail |
| --- | --- | --- |
| manifest | PASS | dsh-plugin-doctor@1.11.0 bundle manifest ok |
| patch | PASS | 1 plugin row(s): doctor |
| entry | PASS | entry lib/index.js exists |
| files | PASS | ships: lib, cordis.patch.yml, README.md, LICENSE |
| pre-execute-side-effects | PASS | no pre-execute listener found |
| shell-launcher | WARN | child_process + shell-launcher pattern(s) detected (#1923/#1863): lib\env.js (cmd.exe); lib\index.js (explorer); scripts |
| build | PASS | pnpm run build succeeded |
| pack | PASS | packed dsh-plugin-doctor-1.11.0.tgz |
| install | PASS | plugin id(s) present in composed config: doctor |

- Overall: **READY ✅**

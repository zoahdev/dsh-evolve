# Tool readiness report — ..\doctor

- Generated: 2026-08-15T11:38:58.136Z
- Verify exit: 0
- Checks: 8 pass / 0 warn / 0 fail

| Check | Status | Detail |
| --- | --- | --- |
| manifest | PASS | dsh-plugin-doctor@1.10.1 bundle manifest ok |
| patch | PASS | 1 plugin row(s): doctor |
| entry | PASS | entry lib/index.js exists |
| files | PASS | ships: lib, cordis.patch.yml, README.md, LICENSE |
| pre-execute-side-effects | PASS | no pre-execute listener found |
| build | PASS | pnpm run build succeeded |
| pack | PASS | packed dsh-plugin-doctor-1.10.1.tgz |
| install | PASS | plugin id(s) present in composed config: doctor |

- Overall: **READY ✅**

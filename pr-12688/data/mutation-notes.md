# Mutation notes

- `mutation.json` / `mutation-unit.log`: 27 mutants scored by the PR's own targeted unit tests
  (core: advisor, advisor-policy, agent-core, coreToolScheduler, config; cli: settings,
  advisor-command, AppHeader, ToolMessage, useReactToolScheduler, OpenTUI event-adapter,
  live-session; web-shell: settings, toolFormatting).
- M18 (`formatAdvisorDisplay` always formats as a legacy review) shows SURVIVED in the unit
  log only because the cli suites import core through `packages/core/dist`. Re-run with core
  rebuilt (`tsc --build`): KILLED by `ToolMessage.test.tsx › renders free-form Advisor guidance
  in its card` and `event-adapter.test.ts › formats native Advisor advice …`.
- M16 first form (delete the push) fails `tsc --build` (unused local), so it was re-run as
  `if (advisorReminder && process.env['NEVER_SET_M16'])` — SURVIVED the unit tests, KILLED by
  `integration-tests/cli/advisor-tool.test.ts` (`mutation-bundle-M16.json`).
- `mutation-bundle.json`: unit survivors rebuilt into the bundle and scored by
  `integration-tests/cli/advisor-tool.test.ts` (the file PR CI does not run).
- The two tests added in `../f1-fix.patch` kill M02 (no reset on a new session) and M03
  (0 no longer unlimited) at unit level.

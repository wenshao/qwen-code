#!/usr/bin/env python3
"""Applies one mutant at a time to the mut worktree, runs the PR's suites, records kills."""
import json, subprocess, sys, pathlib, time
ROOT = pathlib.Path('/Users/wenshao/git/pr13974-arms/mut')
CLI = ROOT / 'packages/cli'
S = 'src/serve/'
SUITES = [S + f for f in ['hosted-team-session.test.ts', 'hosted-session-command-session.test.ts',
    'hosted-child-agent-session.test.ts', 'hosted-runtime-recovery.test.ts',
    'hosted-workspace-tool-turn.commands.test.ts', 'hosted-workspace-tool-turn.team.test.ts',
    'hosted-member-chain.test.ts', 'hosted-tool-approval.test.ts', 'hosted-workspace-tool-turn.test.ts']]
M = [
 ('M01', 'decide: no settle check before commit', 'hosted-team-session.ts',
  "if (!view.continuable || view.head === undefined)\n      throw new HostedTeamRefusal(`Decide after ${member.name}'s run settles.`);",
  "if (view.head === undefined)\n      throw new HostedTeamRefusal(`Decide after ${member.name}'s run settles.`);"),
 ('M02', 'submit: member without plan mode may submit', 'hosted-team-session.ts',
  "      if (\n        !member.team.members.find((entry) => entry.name === member.name)!\n          .planModeRequired\n      )",
  "      if (\n        false\n      )"),
 ('M03', 'one submission per run guard off', 'hosted-session-command-session.ts',
  "          if (state === 'cancelled' || state === 'rejected') continue;",
  "          continue;"),
 ('M04', 'supersede recovery reuses the old revision', 'hosted-team-session.ts',
  "const revision = previous.planRevision + 1;", "const revision = previous.planRevision;"),
 ('M05', 'submit does not withdraw the superseded plan', 'hosted-team-session.ts',
  "      await this.withdrawPlans(\n        member.team.teamId,\n        member.name,\n        `supersede:${commandId}`,\n      );", ""),
 ('M06', 'split outcome claims delivery', 'hosted-team-session.ts',
  "was recorded (${plan.decision}). The call stopped before",
  "was recorded (${plan.decision}) and the member was continued. The call stopped before"),
 ('M07', 'decide: older revision decidable', 'hosted-team-session.ts',
  "          entry.member === member.name &&\n          entry.planRevision > plan.planRevision,",
  "          entry.member === member.name &&\n          false,"),
 ('M08', 'no escaped feedback reserve in submit bound', 'hosted-team-session.ts',
  "teamPlanInstruction(text, 'rejected', '\"'.repeat(4096))", "teamPlanInstruction(text, 'rejected', '')"),
 ('M09', 'gate-off shutdown refusal removed', 'hosted-team-session.ts',
  "    checkWithdrawal();\n    await this.withdrawPlans(team.teamId, name, `shutdown:${callKey}`);",
  "    await this.withdrawPlans(team.teamId, name, `shutdown:${callKey}`);"),
 ('M10', 'recovery ignores plan decision evidence', 'hosted-runtime-recovery.ts',
  "      call.name === 'team_plan_approval'\n        ? await input.teams?.planDecisionEvidence(callKey)\n        : undefined;",
  "      call.name === 'team_plan_approval'\n        ? undefined\n        : undefined;"),
 ('M11', 'exit_plan_mode refused in plan mode', 'hosted-workspace-tool-turn.ts',
  "            call.name === 'exit_plan_mode' &&\n            command &&\n            teamPlanAdmissionsEnabled()",
  "            false"),
 ('M12', 'plan_mode_required not recorded on join', 'hosted-workspace-tool-turn.ts',
  "        planModeRequired: request.call.args['plan_mode_required'] === true,",
  "        planModeRequired: false,"),
 ('M13', 'result notification omits the waiting plan', 'hosted-child-agent-session.ts',
  "            command.kind === 'plan_submit',", "            command.kind === ('never' as string),"),
 ('M14', 'gate-off refuses replay of a committed submission', 'hosted-session-command-session.ts',
  "        if (teams.plan(params.commandId) === undefined)\n          assertManagedSessionDomainEnabled('team_plan');",
  "        assertManagedSessionDomainEnabled('team_plan');"),
 ('M15', 'decision commits despite refused preflight', 'hosted-team-session.ts',
  "    if (preflight.kind === 'refused')\n      throw new HostedTeamRefusal(preflight.reason);", ""),
 ('M16', 'continuation ignores a newer plan', 'hosted-child-agent-session.ts',
  "                other.planRevision > plan.planRevision", "                false"),
]
FLAKY = {'enforces the per-run command budget with budget_exhausted',
         "counts the lead's plain sends toward the run's 64-message budget (R1-6)"}
only = set(sys.argv[1:])
out = open('/Users/wenshao/git/pr13974-arms/logs/mutants.jsonl', 'a')
for mid, what, f, old, new in M:
    if only and mid not in only: continue
    path = CLI / S / f
    src = path.read_text()
    n = src.count(old)
    if n != 1:
        rec = {'id': mid, 'what': what, 'error': f'pattern count {n}'}
        print(json.dumps(rec)); out.write(json.dumps(rec) + '\n'); out.flush(); continue
    path.write_text(src.replace(old, new))
    t = time.time()
    try:
        r = subprocess.run(['npx', 'vitest', 'run', '--testTimeout=120000', '--reporter=json',
                            '--outputFile=/tmp/claude-501/mut-' + mid + '.json', *SUITES],
                           cwd=CLI, capture_output=True, text=True)
        failed = []
        try:
            rep = json.load(open('/tmp/claude-501/mut-' + mid + '.json'))
            for tf in rep['testResults']:
                for a in tf['assertionResults']:
                    if a['status'] == 'failed' and a['title'] not in FLAKY:
                        failed.append(pathlib.Path(tf['name']).name + ' > ' + a['title'])
                if tf.get('status') == 'failed' and not any(a['status'] == 'failed' for a in tf['assertionResults']):
                    failed.append(pathlib.Path(tf['name']).name + ' (file failed: ' + (tf.get('message') or '')[:200] + ')')
            total = rep.get('numTotalTests')
        except Exception as e:
            total = None; failed.append('report unreadable: ' + str(e) + ' ' + r.stdout[-500:] + r.stderr[-500:])
        rec = {'id': mid, 'what': what, 'killed': bool(failed), 'failedCount': len(failed), 'failed': failed[:8],
               'total': total, 'seconds': round(time.time() - t)}
    finally:
        path.write_text(src)
    print(json.dumps(rec)); out.write(json.dumps(rec) + '\n'); out.flush()

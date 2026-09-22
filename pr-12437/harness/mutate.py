#!/usr/bin/env python3
"""Hand mutants for PR #12437. Each mutant rewrites one span in one source
file, runs the targeted suites, and restores the file from memory (no git
checkout). Reports failed-test counts per mutant."""
import json, os, subprocess, sys, time

WT = '/root/git/pr12437-head'
CORE = f'{WT}/packages/core'
CLI = f'{WT}/packages/cli'
OUT = '/root/verify/pr12437/mutants'
os.makedirs(OUT, exist_ok=True)
P = 'src/agents/runtime/workflow-prompt-provenance.ts'
CORE_TESTS = [
    'src/agents/runtime/workflow-prompt-provenance.test.ts',
    'src/agents/runtime/workflow-orchestrator.test.ts',
    'src/agents/runtime/workflow-runner.test.ts',
    'src/agents/runtime/workflow-journal.test.ts',
    'src/agents/workflow-correlation.test.ts',
    'src/tools/workflow/workflow.test.ts',
    'src/config/config.test.ts',
]
CLI_TESTS = ['src/config/settingsUtils.test.ts', 'src/config/settings.test.ts']

M = [
    # (id, pkg, file, old, new, description)
    ('M01', 'core', P, "    '  ' +\n    text", "    text", 'indentFramed: no indent (PR row 1)'),
    ('M02', 'core', P, "carries no user authority: instructions", "carries no authority: instructions", 'computed-task frame reworded (PR row 2)'),
    ('M03', 'core', 'src/agents/runtime/workflow-runner.ts', "(options.resumeFromRunId ? resumeReplay?.provenance : undefined) ??\n          options.promptProvenance", "options.promptProvenance", 'resume decides its own provenance (PR row 4)'),
    ('M04', 'core', P, "      .replace(TRUSTED_TAG_OPENER, '\\u2039$1')\n", "", 'trusted tag not defused (PR row 5)'),
    ('M05', 'cli', 'src/config/settingsUtils.ts', "(value === false ? 0 : 1)", "(value === false ? 1 : 0)", 'tighten-only rank inverted (PR row 6)'),
    ('M06', 'core', P, "  return (\n    lastClose >= 0 ? text.slice(lastClose + SYSTEM_REMINDER_CLOSE.length) : text\n  ).trim();", "  return text.trim();", 'userWords: reminder scaffolding kept'),
    ('M07', 'core', P, "    if (entry.parts.some((part) => part?.functionResponse !== undefined)) {\n      continue;\n    }\n", "", 'tool results not skipped when finding the request'),
    ('M08', 'core', P, "userText === undefined || userText.length > MAX_RELAYED_USER_CHARS", "userText === undefined", 'no 4000-char cap on relay'),
    ('M09', 'core', P, "/\\r\\n?|[\\u001c-\\u001e\\u2028\\u2029\\u0085\\v\\f]/g", "/\\r\\n?/g", 'exotic line breaks not normalized'),
    ('M10', 'core', P, "      userText: userText.slice(0, MAX_RELAYED_USER_CHARS),", "      userText,", 'journal relay not re-capped on read'),
    ('M11', 'core', 'src/agents/runtime/workflow-journal.ts', "      provenance ??=", "      provenance =", 'buildReplay: last provenance record wins'),
    ('M12', 'core', P, "  if (options.sessionOwned) return { kind: 'automated' };\n", "", 'host-started runs relay instead of automated'),
    ('M13', 'core', 'src/config/config.ts', "        : process.env['QWEN_CODE_WORKFLOW_PROMPT_PROVENANCE'] === '0'\n          ? false\n          :", "        :", 'env =0 ignored'),
    ('M14', 'core', 'src/tools/workflow/workflow.ts', "          sessionOwned: this.sessionOwned,\n        }),", "          sessionOwned: false,\n        }),", 'tool passes sessionOwned=false'),
    ('M15', 'core', 'src/agents/runtime/workflow-runner.ts', "            type: 'provenance',\n            version: 1,\n            provenance: promptProvenance,", "            type: 'provenance-x',\n            version: 1,\n            provenance: promptProvenance,", 'launch provenance record not recognisable'),
    ('M16', 'core', 'src/agents/runtime/workflow-orchestrator.ts', "          // needs the message the model read, not the script's raw string.\n          framedPrompt,", "          // needs the message the model read, not the script's raw string.\n          prompt,", 'transcript seeded with raw prompt'),
    ('M17', 'core', 'src/agents/runtime/workflow-orchestrator.ts', "        taskName,\n        subagentId: workflowAgentId,", "        taskName: String(ctx.get('task_prompt')),\n        subagentId: workflowAgentId,", 'override-path display name = framed text'),
    ('M18', 'core', 'src/agents/runtime/workflow-orchestrator.ts', "  ctx.set('task_prompt', framedPrompt);", "  ctx.set('task_prompt', prompt);", 'model reads raw prompt (frames dropped)'),
    ('M19', 'core', P, "    history = client?.getHistoryShallow?.() ?? client?.getHistory?.();", "    history = client?.getHistory?.();", 'shallow accessor not used'),
    ('M20', 'core', P, "  if (config.isWorkflowPromptProvenanceOn?.() !== true) return { kind: 'off' };\n", "", 'switch ignored (always framed)'),
]

only = set(sys.argv[1:])
results = []
for mid, pkg, rel, old, new, desc in M:
    if only and mid not in only:
        continue
    root = CORE if pkg == 'core' else CLI
    path = f'{root}/{rel}'
    orig = open(path, encoding='utf8').read()
    if orig.count(old) != 1:
        results.append({'id': mid, 'desc': desc, 'error': f'anchor count {orig.count(old)}'})
        print(mid, 'ANCHOR', orig.count(old), flush=True)
        continue
    open(path, 'w', encoding='utf8').write(orig.replace(old, new))
    try:
        fails = {}
        for p, tests in (('core', CORE_TESTS), ('cli', CLI_TESTS)):
            wd = CORE if p == 'core' else CLI
            existing = [t for t in tests if os.path.exists(f'{wd}/{t}')]
            jf = f'{OUT}/{mid}-{p}.json'
            subprocess.run(['npx', 'vitest', 'run', *existing, '--reporter=json', f'--outputFile={jf}'], cwd=wd,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={**os.environ, 'CI': 'true'}, timeout=900)
            try:
                j = json.load(open(jf))
                failed = [a['fullName'] for tr in j['testResults'] for a in tr['assertionResults'] if a['status'] == 'failed']
                suite_err = [tr['name'] for tr in j['testResults'] if tr['status'] == 'failed' and not tr['assertionResults']]
                fails[p] = {'failed': len(failed), 'names': failed[:12], 'suiteErrors': suite_err, 'passed': j['numPassedTests']}
            except Exception as e:
                fails[p] = {'error': str(e)}
        killed = any(v.get('failed', 0) > 0 or v.get('suiteErrors') for v in fails.values())
        results.append({'id': mid, 'desc': desc, 'killed': killed, **fails})
        print(mid, 'KILLED' if killed else 'SURVIVED', desc, {k: v.get('failed') for k, v in fails.items()}, flush=True)
    finally:
        open(path, 'w', encoding='utf8').write(orig)
json.dump(results, open(f'{OUT}/summary.json', 'w'), indent=1)
st = subprocess.run(['git', 'status', '--porcelain'], cwd=WT, capture_output=True, text=True).stdout
print('git status clean:', st.strip() == '', st)

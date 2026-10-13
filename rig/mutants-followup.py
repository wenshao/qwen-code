#!/usr/bin/env python3
import json, subprocess, pathlib, sys
CLI = pathlib.Path('/Users/wenshao/git/pr13974-arms/followup/packages/cli')
F = CLI / 'src/serve/hosted-team-session.ts'
M = [
 ('F1', 'split answer claims delivery', "was recorded (${plan.decision}). The call stopped before", "was recorded (${plan.decision}) and the member was continued. The call stopped before"),
 ('F2', 'needed: JSON quotes not subtracted', "JSON.stringify(escapeXml(plan)), 'utf8') - 2;", "JSON.stringify(escapeXml(plan)), 'utf8');"),
 ('F3', 'needed: XML escaping not counted', "JSON.stringify(escapeXml(plan)), 'utf8') - 2;", "JSON.stringify(plan), 'utf8') - 2;"),
 ('F4', 'needed: JSON escaping not counted', "Buffer.byteLength(JSON.stringify(escapeXml(plan)), 'utf8') - 2;", "Buffer.byteLength(escapeXml(plan), 'utf8');"),
 ('F5', 'available: feedback reserve not counted', "preamble + teamPlanInstruction('', 'rejected', PLAN_FEEDBACK_RESERVE),", "preamble + teamPlanInstruction('', 'rejected', ''),"),
 ('F6', 'available: off by one', "      MANAGED_CHILD_LIMITS.maxEnvelopeBytes -\n", "      MANAGED_CHILD_LIMITS.maxEnvelopeBytes - 1 -\n"),
 ('F7', 'available: preamble not counted', "preamble + teamPlanInstruction('', 'rejected', PLAN_FEEDBACK_RESERVE),", "teamPlanInstruction('', 'rejected', PLAN_FEEDBACK_RESERVE),"),
]
src = F.read_text()
for mid, what, old, new in M:
    if src.count(old) != 1:
        print(json.dumps({'id': mid, 'error': f'count {src.count(old)}'})); continue
    F.write_text(src.replace(old, new))
    try:
        r = subprocess.run(['npx', 'vitest', 'run', '--testTimeout=120000', '--reporter=json', f'--outputFile=/tmp/claude-501/fu-{mid}.json', 'src/serve/hosted-team-session.test.ts'], cwd=CLI, capture_output=True, text=True)
        rep = json.load(open(f'/tmp/claude-501/fu-{mid}.json'))
        failed = [a['title'] for t in rep['testResults'] for a in t['assertionResults'] if a['status'] == 'failed']
        print(json.dumps({'id': mid, 'what': what, 'killed': bool(failed), 'failed': failed}), flush=True)
    finally:
        F.write_text(src)

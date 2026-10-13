#!/usr/bin/env python3
"""Builds cards.json for render-cards.mjs from the probe evidence."""
import json, re, sys, pathlib

R = pathlib.Path('/Users/wenshao/git/pr13955-arms/results')
L = lambda p: json.load(open(R / p))
txt = lambda v: re.sub(r'"\}\]$', '', re.sub(r'^\[\{"type":"text","text":"', '', v))

H = {'P1': 'head-3/p1PeerMessagesEndToEnd.json', 'P2': 'head-3/p2MemberInFlightCapOnTheRelay.json',
     'P3': 'head-4/p3ReceiptRefusedOnceThenReExecuted.json', 'P4': 'head-4/p4SizesAndEscapes.json',
     'P5': 'head-4/p5StoppingThenEndedRecipient.json', 'P6': 'head-5/p6ParentLaneControlText.json',
     'P7': 'head-5/p7ReExecuteAfterHarnessRestart.json', 'P8': 'head-5/p8BoardWriteReceiptRefused.json'}
M = {k: 'merge-1/' + v.split('/')[1] for k, v in H.items()}
B = {'P1': 'base-1/p1PeerMessagesEndToEnd.json', 'P6': 'base-2/p6ParentLaneControlText.json',
     'P8': 'base-2/p8BoardWriteReceiptRefused.json'}

h1, b1 = L(H['P1']), L(B['P1'])
cards = []

cards.append({
    'file': '01-matrix.png',
    'title': 'PR #13955 @ ce9306ed — real Hosted stack verification matrix',
    'subtitle': 'Spring managed-agent-server on MySQL 8.4.7 + embedded Runtime Broker + bundled Hosted Harness (dist/cli.js serve --profile hosted-harness) + a logging proxy between them; only the model is scripted. macOS arm64, JDK 21, Node 24.',
    'sections': [{
        'heading': 'Arms: base = 21b78c55 (merge base, main right after #13928) | head = ce9306ed | merge = head + main c5098a27 (clean trial merge, includes #13858)',
        'table': {'head': ['probe (what it drives)', 'base', 'head', 'merge'], 'rows': [
            ['P1 design physical pass: alice -> bob (running), "*" with carol finished,\n   carol alone, stranger, self, "leader", "Parent"; bob replies to alice',
             '-- all 7 refused: addresses\n-- only to "parent"', '++ 7/7 answers as designed\n++ bob/alice see <from>member ..</from>', '++ same as head'],
            ['P2 member in-flight cap on the real relay (bob\'s receive held at proxy)', '', '++ c1-c4 sent, c5 count_limit (4)\n++ lead\'s own message still sent', '++ same'],
            ['P5 stopping, then ended recipient (bob\'s cancel held at proxy)', '', '++ "being stopped" -> "has ended"', '++ same'],
            ['P4 sizes: 32,697-byte CJK/escape-rich message; 33 KB; small', '', '++ delivered intact / byte_limit / sent', '++ same'],
            ['P7 receipt refused until execute fails, Harness killed + restarted', '', '++ re-run answers "sent", 2 msgc_ total,\n++ 1 inbound per recipient', '++ same'],
            ['P3 receipt refused until execute fails, no restart', '', '!! lead latched (#13413): command unknown,\n!! 2 msgc_ stranded planned', '!! same'],
            ['P8 = P3 on a b3b board write (no member message)', '!! same latch', '!! same latch', '!! same latch'],
            ['P4/P6 escape-dense 26 KB JSON (32,549 B envelope) -> peer / "parent"', '!! "parent": Turn FAILED', '!! peer and "parent": Turn FAILED', '!! same'],
            ['4 PR suites (vitest)', '', '++ 119/119', '++ 4 PR + 8 related suites: 961/965;\n== the 4 = 15-30 s load timeouts,\n++ their 3 files alone: 123/123'],
            ['22 targeted mutants on the 4 suites', '', '++ 22/22 killed (3 by 15 s timeout)', ''],
            ['tsc --noEmit (cli)', '', '== CI Lint & Static pass', '++ pass'],
        ]}}],
    'note': 'Green: behaves as the PR and the design say. Amber: a pre-existing gap reached through the new path (reproduces on base, not introduced here). Red: the base refusal this PR replaces. Every probe dumps JSON evidence (tool answers the model saw, rendered inputs, lead/member journal rows, relay rows, proxy log).',
})

ans = {k: txt(v['text']) for k, v in h1['toolAnswers'].items()}
bans = {k: txt(v['text']) for k, v in b1['toolAnswers'].items()}
steps = [('a1', 'to "bob" (running, held in its model call)'), ('a2', 'to "*" (carol already finished)'),
         ('a3', 'to "carol" (finished)'), ('a4', 'to "zed" (stranger)'), ('a5', 'to "alice" (herself)'),
         ('a6', 'to "leader"'), ('a7', 'to "Parent" (capitalized)')]
rows = [[f'{k} {what}', '++ ' + ans[k]] for k, what in steps]
cards.append({
    'file': '02-p1-peer-messages.png',
    'title': 'P1 — the b3c physical pass: alice messages her teammates (head ce9306ed)',
    'subtitle': 'Team "review" = alice, bob, carol, launched by the lead in one batch. carol answers at once; bob\'s first model call is held until alice\'s a2 has been answered, so he is running when she writes.',
    'sections': [
        {'heading': 'What alice\'s model saw for each send_message (tool answer, verbatim)', 'table': {'head': ['call', 'answer'], 'rows': rows}},
        {'heading': 'bob\'s next model input (rendered on the recipient side; header/footer stripped)', 'lines':
            [l for l in h1['memberInputs']['bob'][0].split('\n')]},
        {'heading': 'bob answers with send_message {to: "alice"} -> "Message sent to alice."; alice (still running) then sees', 'lines':
            [l for l in h1['memberInputs']['alice'][0].split('\n')]},
        {'heading': 'base 21b78c55, same script', 'lines': [
            '-- declared send_message.to = {"type":"string","enum":["parent"]}; preamble ends "You cannot message other members."',
            '-- a1..a7 all: ' + bans['a1'],
            "== head: to = a free string ('A member name, \"*\" for every other member, or \"parent\"'), and that preamble sentence is gone"]},
    ],
})

lead_rows = []
for r in h1['leadRequests']:
    u = r['lastUser']
    kind = ('the lead\'s own first Turn, round ' + str(sum(1 for x in lead_rows if x[1].startswith('the lead')) + 1) if 'PRB_LEAD' in u else
            'member result: ' + re.search(r'<teammate>(\w+)', u).group(1) if '<task-notification>' in u else
            'alice\'s a7 to "Parent" (H4d-b plain lane)' if 'PRB_PARENT' in u else u[:40])
    lead_rows.append([f'+{r["atSec"]:.1f}s', kind])
msg_rows = []
for c in h1['idCheck']:
    msg_rows.append([c['messageId'], c['executionCallId'], c['recipientByRootRun'], '++ ' + c['idMatchesPositionOf']])
cards.append({
    'file': '03-p1-lead-journal.png',
    'title': 'P1 — what the lead committed, and what it did NOT do',
    'subtitle': 'MySQL rows of the lead Session after P1 (head). msgc_ ids recomputed in the probe as sha256(lead \\0 commandId \\0 rosterPosition)[:32].',
    'sections': [
        {'heading': 'lead outbound member messages (session_message, route to_child, all consumed)', 'table': {
            'head': ['message id', 'executionCallId (= the member_message command)', 'recipient (by root run)', 'id recomputed for position of'], 'rows': msg_rows}},
        {'heading': 'other lead facts', 'lines': [
            '++ 5 inbound member_message receipts (a1 a2 a3 a4 + bob\'s reply), each with its stored reply; a5/a6 never left alice',
            '++ sendSessionMessage x3 = exactly the 3 sends; child_run records = 3 (no continuation launched, no launch budget spent)',
            '++ carol (finished) received nothing; bob got 2 inputs, alice 1; every relay row done with 0 retries',
        ]},
        {'heading': f'every lead model request in P1 ({len(lead_rows)}) — none was woken by a member message', 'table': {
            'head': ['at', 'what woke the lead'], 'rows': lead_rows}},
    ],
    'note': 'Design-acknowledged side effect, now visible on a real stack: alice\'s result to the lead is ALICE_GOT_BOB (her answer to bob\'s reply), not "ALICE_REPORT all steps done"; bob\'s is his answer to the broadcast. The wrapper tells the recipient to answer the leader\'s last instruction in full (decision 8 / H4d-b result rule).',
})

p2, p5, p4 = L(H['P2']), L(H['P5']), L(H['P4'])
a2 = {k: txt(v['text']) for k, v in p2['toolAnswers'].items()}
a5 = {k: txt(v['text']) for k, v in p5['toolAnswers'].items()}
a4 = {k: txt(v['text']) for k, v in p4['toolAnswers'].items()}
held = p2['facts']['whileHeld.leadOutbound']
cards.append({
    'file': '04-bounds-and-states.png',
    'title': 'P2 / P5 / P4 — bounds and recipient states on the real relay (head)',
    'subtitle': 'P2: the proxy answers bob\'s receive with 409 session_message_not_ready, so the lead\'s outbound entries stay undelivered. P5: the proxy answers bob\'s cancel with 503, so his requested stop stays unsettled.',
    'sections': [
        {'heading': 'P2 — alice sends bob five messages while his deliveries are held', 'lines': [
            '++ c1..c4: ' + a2['c1'].replace('\n', ' '),
            '++ c5:     ' + a2['c5'].replace('\n', ' '),
            '++ lead\'s own send_message to bob afterwards: Message queued for delivery to member "bob" ...',
            '== while held: ' + ', '.join(f"{x['messageId'][:9]}..={x['state']}" for x in held),
            '++ released: bob\'s model receives the 4 msgc_ inputs (<from>member alice</from>) and the lead\'s msg_ (<from>parent</from>)',
        ]},
        {'heading': 'P5 — the lead calls request_shutdown on bob; alice writes to him before and after the stop settles', 'lines': [
            '== lead: ' + a5['lead-stop-bob'],
            '++ f1 (stop requested, cancel held): ' + a5['f1'].replace('\n', ' '),
            '++ f2 (bob cancelled):               ' + a5['f2'].replace('\n', ' '),
            '++ f3 to "*" (bob is the only peer):  ' + a5['f3'].replace('\n', ' '),
        ]},
        {'heading': 'P4 — sizes', 'lines': [
            '++ e1 32,697-byte content (CJK, quotes, backslashes, newlines): ' + a4['e1'].replace('\n', ' '),
            '++    bob\'s model input carries it whole: 39,711 bytes after XML escaping, closing tags intact',
            '++ e3 33 KB: ' + a4['e3'],
            '++ e4 small message afterwards: ' + a4['e4'].replace('\n', ' '),
        ]},
    ],
})

p3, p7, p8b = L(H['P3']), L(H['P7']), L(B['P8'])
def execs(e):
    out = []
    for op in e.get('proxyMessageOperations', []):
        if op.get('kind') == 'execute':
            ans = op.get('answer', '')
            m = re.search(r'"message":"([^"]{0,90})', ans)
            msg = m.group(1) if m else ''
            msg = msg.replace('Managed Session Store POST /transactions:commit failed: The Managed Agent request failed.', 'store commit failed')
            msg = re.sub(r'session log writes stopped after an earlier failure.*', 'session log writes stopped after an earlier failure', msg)
            out.append(f"{op['t'][11:19]} execute -> {op['status']} {msg}")
    return out
p3_ex = execs(p3)
cards.append({
    'file': '05-rerun-and-latch.png',
    'title': 'P7 / P3 / P8 — re-running execute after the receipt commit fails',
    'subtitle': 'A MySQL trigger refuses the lead\'s session_command receipt INSERT until one whole execute has failed at the proxy (the store client retries a commit inside one call), then is disarmed. alice sends to "*" while bob and carol are running.',
    'sections': [
        {'heading': 'P7 (head, merge) — then the Harness is killed and restarted', 'lines': [
            '== before restart: both msgc_ committed (planned), no receipt; the execute answered 503',
            '++ after restart (lead installActivation 2): the re-run answers',
            "++   Message sent to every other member of team \"review\". / - bob: sent. / - carol: sent.",
            '++ sendSessionMessage x2 in total, the same two msgc_ ids; bob and carol each received exactly 1 input',
        ]},
        {'heading': 'P3 (head, merge) — no restart: the lead\'s writes stay stopped', 'lines': ['!! ' + l for l in p3_ex[:4]] + [
            '!!   ... 7 executes in all, then the relay gives the command up as unknown',
            '!! msgc_ to bob/carol: handover 503 x9 and counting -> stay planned; bob/carol never get it; all 3 runs stay running',
            '!! alice (2-minute bound): "The command reached the leader, but its reply did not arrive in time; a write may',
            '!!   have taken effect. End your turn and say so in your result; read the board again before repeating the write."',
        ]},
        {'heading': 'P8 (base 21b78c55, head, merge) — the same trigger on a b3b board write, no member message involved', 'lines': [
            '!! base: execute -> 503 store commit failed, then 6 x 503 session log writes stopped; the command goes unknown',
            '!!   and alice\'s task_create gets the same "reply did not arrive in time" answer after 2 minutes (head, merge: identical)',
            '== => the latch is #13413 (a transient store failure permanently stops Session log writes), pre-existing;',
            '==    b3c inherits it, and its msgc_ entries committed before the failure stay stranded until a restart',
        ]},
    ],
})

p6b, p6h = L(B['P6']), L(H['P6'])
cards.append({
    'file': '06-escape-dense-turn-failure.png',
    'title': 'P4 / P6 — an escape-dense message inside the 32 KiB bound fails the whole Turn',
    'subtitle': 'Message = a JSON array of 6,500 short strings (26 KB). As a member-message envelope it is 32,549 bytes, under the local 32,768 bound; the tool admission encodes {toolName, input} as JSON inside JSON and caps that at 64 KiB inline.',
    'sections': [
        {'heading': 'measured', 'table': {'head': ['', 'bytes', 'limit', ''], 'rows': [
            ['member-message envelope (PR\'s local check)', '32,549', '32,768', '++ passes'],
            ['encodeToolInput body (hosted-workspace-tool-turn.ts)', '71,710', '65,536', '-- throws'],
        ]}},
        {'heading': 'outcome', 'lines': [
            '-- head P4, to "bob": Hosted Harness turn ... failed: Error: Hosted tool input exceeds the inline Session Store limit.',
            '--   alice\'s Turn FAILED (hosted_turn_failed) and her child run -> failed; no tool answer, nothing to retry',
            '-- head P6, same text to "parent": same failure; base P6 (21b78c55), to "parent": same failure',
            '== the H4d-b "parent" lane allows 64 KiB raw, so it is exposed on base already; the b3c path is a narrower window',
        ]},
    ],
    'note': 'Pre-existing, not introduced by this PR. A follow-up could refuse the call (tool error) when encodeToolInput overflows, instead of throwing out of admission.',
})

mut = [json.loads(l) for l in open('/Users/wenshao/git/pr13955-arms/logs/mutants.jsonl')]
rows = []
for r in mut:
    killer = (r.get('failed') or [''])[0]
    killer = re.sub(r'^×\s*', '', killer)
    killer = re.sub(r'\s+\d+ms$', '', killer)
    killer = re.sub(r'^hosted-session-command-session funnel \(H4e-b3\) > ', '', killer)
    killer = re.sub(r'^(member messages|member-message ids|never-started notes) \([^)]*\) > ', '', killer)
    slow = ' (15 s timeout)' if r['id'] in ('M16', 'M17', 'M22') else ''
    rows.append([r['id'], r['what'], '++ killed' + slow, killer[:95]])
cards.append({
    'file': '07-mutation.png',
    'title': '22 targeted mutants of the b3c code paths vs the PR\'s four suites (head ce9306ed)',
    'subtitle': 'Each mutant is one unique replacement, applied in a separate worktree, run against the 4 suites (baseline 119/119), restored with git checkout. M16/M17/M22 re-run alone: killed again.',
    'sections': [{'heading': '22/22 killed', 'table': {'head': ['id', 'mutation', 'result', 'first failing test'], 'rows': rows}}],
    'note': 'M16/M17/M22 are caught only by the 15 s test timeout: the mutant parks the call on a command reply the fixture never sends. Still discriminating, but the failure message does not say why.',
})

json.dump(cards, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
print('cards', len(cards))

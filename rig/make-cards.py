#!/usr/bin/env python3
"""Builds cards.json for render-cards.mjs from the PR 13974 probe evidence."""
import json, re, pathlib

R = pathlib.Path('/Users/wenshao/git/pr13974-arms/results')
OUT = pathlib.Path('/Users/wenshao/git/pr13974-arms/figs')


def L(label, test):
    p = R / label / (test + '.json')
    return json.load(open(p)) if p.exists() else None


def txt(v):
    v = re.sub(r'^\[\{"type":"text","text":"', '', v)
    v = re.sub(r'"\}\]$', '', v).replace(' | ', ' ')
    return re.sub(r'\s*\n\s*', ' ⏎ ', v).strip()


def ans(e, k, n=150):
    if e is None or k not in e['toolAnswers']:
        return '(not reached)'
    t = txt(e['toolAnswers'][k]['text'])
    return t if len(t) <= n else t[:n - 1] + '…'


def short(s, n):
    return s if len(s) <= n else s[:n - 1] + '…'


P1, P1M = L('head-p1', 'p1DesignPass'), L('merge-p1', 'p1DesignPass')
P2, P2B, P2M = L('head-p2', 'p2BoundsAndRefusals'), L('head-p2b', 'p2BoundsAndRefusals'), L('merge-p2', 'p2BoundsAndRefusals')
P3A, P3AM = L('head-p3a', 'p3aDecisionCommittedContinuationLost'), L('merge-p3a', 'p3aDecisionCommittedContinuationLost')
P3B, P3BM = L('head-p3b', 'p3bSupersedeSubmitLost'), L('merge-p3b', 'p3bSupersedeSubmitLost')
P3C, P3CM = L('head-p3c', 'p3cDecisionInUserTurnContinuationLost'), L('merge-p3c', 'p3cDecisionInUserTurnContinuationLost')
P3U, P3UB = L('head-p3u', 'p3uUserTurnContinuationLost'), L('base-p3u', 'p3uUserTurnContinuationLost')
P3W, P3WB = L('head-p3w', 'p3wWakeTurnContinuationLost'), L('base-p3w', 'p3wWakeTurnContinuationLost')
P4, P4M = L('head-p4', 'p4RollbackGateOffThenReenable'), L('merge-p4', 'p4RollbackGateOffThenReenable')
P5 = L('head-p5', 'p5DeleteGateOff')
P6, P6M = L('head-p6', 'p6ReplayCommittedSubmissionGateOff'), L('merge-p6', 'p6ReplayCommittedSubmissionGateOff')
P7 = L('head-p7', 'p7RollbackToBase')
MUT = [json.loads(l) for l in open('/Users/wenshao/git/pr13974-arms/logs/mutants.jsonl')]

cards = []


def merged(e, ok):
    return ('++ ' + ok) if e is not None else '== not run'


def turns(e):
    return ', '.join(f"{t['status']}{'/' + t['error_code'] if t['error_code'] else ''}" for t in e['leadTurns'])


cards.append({
    'file': '01-matrix.png',
    'title': 'PR #13974 @ c4c00d4f — real Hosted stack verification matrix',
    'subtitle': 'Spring managed-agent-server on MySQL 8.4.7 + embedded Runtime Broker + bundled Hosted Harness (serve --profile hosted-harness), '
                'a logging Spring->Harness proxy and a Harness->Session Store proxy that can hold one journal commit; only the model is scripted. '
                'macOS arm64, JDK 21, Node 24. "on" = the PR bundle with team_plan added to MANAGED_SESSION_ENABLED_DOMAINS (the only byte difference); '
                '"off" = the PR as shipped; "base" = merge base 72316e66 (main without this PR).',
    'sections': [{
        'heading': 'Arms: head = c4c00d4f | merge = head + main 17fe37cd (clean trial merge, tree e86e4b44) | base = 72316e66',
        'table': {'head': ['probe', 'head', 'merge', 'base (control)'], 'rows': [
            ['P1 design pass: reject -> revise -> lead message -> early approve\n   -> approve -> edit; bob = control member without plan mode',
             '++ 2 revisions, 3 refused writes, 1 edit after approval\n++ approval lifts plan mode for the next run only', merged(P1M, 'same'), ''],
            ['P1D the same pass in default approval mode (every card auto-approved)',
             '++ cards only for team_create, 2 launches, 3 writes/messages;\n++ exit_plan_mode x2, team_plan_approval x4: no card', '', ''],
            ['P2 bounds and refusals (14 checks), supersession, repeat approval',
             '++ every answer as designed', merged(P2M, 'same'), ''],
            ['P2b exact plan cap: 7,077 B vs 7,076 B ASCII, then 4,096 x \'"\' feedback',
             '++ 7,077 refused (byte_limit), 7,076 accepted;\n++ rejection continues (32,529 B instruction)', '', ''],
            ['P3b supersede: withdraw committed, new plan commit held, Harness killed',
             '++ re-run opens revision 2 exactly once', merged(P3BM, 'same'), ''],
            ['P3D review P3 window: P3b\'s interruption, relay re-execute held while\n   the lead stops alice and deletes the team, then released',
             '++ stopped sender -> plan_submit "unknown", never re-executed;\n++ no waiting plan written for the deleted team', '', ''],
            ['P6 receipt commit held after submitTeamPlan, restart on the gate-off build',
             '++ original answer replayed, no second plan', merged(P6M, 'same'), ''],
            ['P4 rollback to gate-off build with a waiting plan, then reenable',
             '++ plan readable, shutdown refused before effects,\n++ member stays read-only; approved after reenable', merged(P4M, 'same'), ''],
            ['P5 team_delete while gate-off, then reenable',
             '++ delete works, plan stays waiting;\n++ decision refused "The team is not active."', '', ''],
            ['P3a decision committed, continuation commit held, Harness killed\n   (decision made in a notification wake turn)',
             '++ wake turn settled within ~2 s, call answered with the exact split outcome;\n!! but the lead is not re-prompted: nothing acts on it until its next input', merged(P3AM, 'same') if P3AM else '== not run',
             '!! P3W: same — settled, lead not re-prompted (send_message);\n== answer is core\'s generic "not recorded" text'],
            ['P3c the same with the decision made in a user turn',
             '-- lead permanently recovery-blocked\n-- (takeover_unrecovered / unresolved_after_settle)',
             ('-- same' if P3CM else '== not run'),
             '-- P3U: identical with send_message (open #13847)'],
            ['P7 Harness rolled back to base after a team_plan commit',
             '!! lead load refused: "Hosted recovery domain is unsupported."\n!! (documented rollback caveat, fail-closed)', '', ''],
            ['16 mutants on the PR\'s guards, PR unit suites (550 tests)',
             f"++ {sum(1 for m in MUT if m.get('killed'))}/{len(MUT)} killed", '', ''],
            ['PR unit suites (CLI 10 files, core 2, Java 3)', '',
             '++ CLI 1009/1009 (2 load timeouts pass alone),\n++ core 190/190, Java 45/45', ''],
        ]}}],
    'note': 'Green: holds as the PR and its design say. Amber: a limitation or a pre-existing gap reached through the new path. '
            'Red: a wedge — reproduced identically on base with send_message, i.e. inherited (tracked by open #13847), but it is exactly the '
            'interruption point the PR\'s split-outcome contract is about. Every probe dumps JSON evidence (tool answers, model inputs, '
            'journal rows with writer generations, plan records, proxy logs).',
})

# --- P1
mr = P1['memberRuns']
rows = []
for tag, label in [('first', 'run 1 (launch)'), ('rejected', 'run 2 (rejected)'), ('note-P1', 'run 3 (lead message)'), ('approved', 'run 4 (approved)')]:
    r = mr[f'alice#{tag}@on']
    rows.append([label, '++ ' + ('plan-mode="required"' if r['planModeAttribute'] else 'no plan-mode attribute'),
                 ('++ ' if ('exit_plan_mode' in r['tools']) == r['planModeAttribute'] else '-- ') + ('declared' if 'exit_plan_mode' in r['tools'] else 'not declared')])
b = mr['bob#first@on']
rows.append(['bob run 1 (control)', '== no plan-mode attribute', '== not declared'])
A = lambda k: ans(P1, k, 128)
cards.append({
    'file': '02-p1-design-pass.png',
    'title': 'P1 — the design\'s physical pass on the real stack (head c4c00d4f, gate on)',
    'subtitle': 'Lead launches alice with plan_mode_required:true and bob without. Each line is the tool answer the scripted model actually received.',
    'sections': [
        {'heading': 'alice\'s four runs: what each run\'s first model request carried', 'table': {'head': ['run', 'preamble', 'exit_plan_mode tool'], 'rows': rows}},
        {'heading': 'alice, run 1 (plan mode)', 'lines': [
            '++ a1 read_file README.md      -> ' + short(A('a1-read'), 70),
            '++ a2 write_file blocked-1.md  -> ' + short(A('a1-write'), 110),
            '++ a3 task_list                -> ' + short(A('a1-list'), 70),
            '++ a4 exit_plan_mode PLAN_V1   -> ' + A('a1-submit')]},
        {'heading': 'lead (woken by alice\'s result, which carries <plan-approval-request request=... revision="1">)', 'lines': [
            '++ show                        -> ' + short(A('l-show-1'), 110),
            '++ reject + feedback           -> ' + A('l-reject-1')]},
        {'heading': 'alice, run 2 (rejected, still plan mode)', 'lines': [
            '++ write_file blocked-2.md     -> refused (same plan-mode text)',
            '++ exit_plan_mode PLAN_V2      -> ' + A('a2-submit')]},
        {'heading': 'lead: board, a message before approval, an early approval, then the approval', 'lines': [
            '++ task_list                   -> ... ' + short(re.search(r'Pending plan:.*', ans(P1, 'l-list-2', 900)).group(0), 100),
            '++ send_message alice          -> ' + short(A('l-note'), 110),
            '++ approve (alice running)     -> ' + A('l-early'),
            '++ alice run 3 write_file      -> refused (plan mode kept for the lead\'s message run)',
            '++ approve (alice settled)     -> ' + A('l-approve-2')]},
        {'heading': 'alice, run 4 (approved) and the records', 'lines': [
            '++ write_file plan-output.md   -> ' + short(A('a4-write'), 60),
            '++ team_plan rev 1: settled/rejected (feedback 32 B); rev 2: settled/approved',
            f"++ child_run: alice 4 (launch + 3 continuations), bob 1; workspace files: {', '.join(sorted(P1['workspaceFiles']))}",
            '== bob (no plan mode): write_file bob.md succeeded in his first run'
        ]},
    ],
})

# --- P2
a2 = lambda k: ans(P2, k, 120)
cards.append({
    'file': '03-p2-bounds.png',
    'title': 'P2 / P2b — bounds and refusals through the real relay (head, gate on)',
    'subtitle': 'Same answers on the trial merge with main 17fe37cd. P2b pins the exact plan cap computed offline from alice\'s real launch envelope.',
    'sections': [
        {'heading': 'launch arguments (lead)', 'lines': [
            '++ agent name="zed" plan_mode_required:"yes" -> ' + a2('l-bad-launch'),
            '++ unnamed agent plan_mode_required:true     -> ' + short(a2('l-unnamed'), 100)]},
        {'heading': 'alice, plan mode, one run', 'lines': [
            '++ exit_plan_mode "   "                      -> ' + a2('a1-empty'),
            '++ send_message to "carol"                   -> ' + short(a2('a1-msg'), 100),
            '++ exit_plan_mode 12,000 B                   -> ' + a2('a1-big'),
            '++ exit_plan_mode PLAN_V1                    -> ' + short(a2('a1-ok'), 60),
            '++ exit_plan_mode again (same run)           -> ' + short(a2('a1-again'), 100)]},
        {'heading': 'lead decisions', 'lines': [
            '++ approve request "cmd_bogus"               -> ' + a2('l-bogus'),
            '++ action "maybe"                            -> ' + a2('l-badaction'),
            '++ reject, 4,097-byte message                -> ' + a2('l-bigmsg'),
            '++ reject, 4,096 x \'"\'                         -> recorded (rejected) and the member was continued',
            '++ approve rev 1 (already rejected)          -> ' + short(a2('l-old'), 70),
            '== lead message -> alice run 3 submits PLAN_V3 -> rev 2 withdrawn (supersede)',
            '++ approve rev 2 (superseded)                -> ' + short(a2('l-stale'), 70),
            '++ approve rev 3                             -> recorded (approved) and the member was continued',
            '++ approve rev 3 again (new call)            -> ' + short(a2('l-again-3'), 70) + '  (no 2nd continuation)']},
        {'heading': 'P2b: the cap at the boundary (alice\'s envelope: description 10 B, preamble 769 B)', 'lines': [
            '++ exit_plan_mode 7,077 x "B"                -> ' + ans(P2B, 'a1-big', 100),
            '++ exit_plan_mode 7,076 x "B"                -> ' + short(ans(P2B, 'a1-ok', 60), 60),
            '++ reject with 4,096 x \'"\' feedback          -> continued; the rejected run\'s instruction is 32,529 B',
            '!! effective cap ~7 KB of ASCII (1,179 chars if every char is \'"\'): 24 KiB of the 32 KiB envelope is reserved',
            '!! for the worst-case escaped 4 KiB feedback; the refusal does not say how large a plan may be',
            '!! the next continuation\'s history no longer carries the original task (relay history budget, pre-existing)']},
    ],
})

# --- interruptions
def jr(e):
    return [f"{'++' if True else ''} #{j['journal_revision']:<3} {j['operation']:<28} gen {j['writer_generation']}  {j['command_id'][-34:]}" for j in e['leadPlanJournal']]

cards.append({
    'file': '04-interruptions.png',
    'title': 'P3a / P3b / P6 — interrupting at the durable boundaries (store proxy holds one commit, Harness SIGKILLed, restarted)',
    'subtitle': 'gen = the Session Store writer generation that committed the row (1 = before the kill, 2 = the restarted Harness).',
    'sections': [
        {'heading': 'P3a: decideTeamPlan committed, continueChildRun held -> kill -> restart (decision made in alice\'s notification wake turn)', 'lines': [
            '++ restart: the crash aftermath answers the call and settles the wake turn (turn.settled error) within ~2 s:',
            *['++ ' + part for part in re.split(r'(?<=continued;) ', ans(P3A, 'l-approve', 400))],
            '!! but no model round follows: the lead sees the answer only on its next turn (a user input here, ~150 s later)',
            '++ approve again -> ' + ans(P3A, 'l-again', 80) + '   (no second continuation)',
            '++ lead re-sends with send_message -> alice continued WITHOUT plan mode -> write_file succeeds',
            *[('== ' + x[3:]) for x in jr(P3A)]]},
        {'heading': 'P3b: supersede — withdrawTeamPlan committed, submitTeamPlan of PLAN_V2 held -> kill -> restart', 'lines': [
            '++ alice\'s parked command wait resumes: ' + ans(P3B, 'a2-submit', 110),
            '++ rev 1 cancelled, rev 2 waiting -> approved; stale approve of rev 1 -> ' + ans(P3B, 'l-stale', 60),
            *[('== ' + x[3:]) for x in jr(P3B)]]},
        {'heading': 'P6: submitTeamPlan committed, receipt commit held -> kill -> restart on the GATE-OFF build', 'lines': [
            '++ alice receives the original answer: ' + ans(P6, 'a1-submit', 110),
            *[('== ' + x[3:]) for x in jr(P6)]]},
    ],
})

# --- user-turn wedge
def rec(e):
    return turns(e)
cards.append({
    'file': '05-user-turn-wedge.png',
    'title': 'P3c vs P3U — the same interruption in a user turn wedges the lead; base does the same with send_message',
    'subtitle': 'Inherited, not introduced: the takeover declines a Turn with no Runtime checkpoint (open #13847). But decide -> continue is two journal-only commits, '
                'so the PR\'s split-outcome answer is unreachable when the decision is made in a user turn.',
    'sections': [
        {'heading': 'head P3c: user input "decide" -> team_plan_approval approve -> decideTeamPlan committed, continueChildRun held -> kill -> restart -> user input', 'lines': [
            '-- Harness: load refused (takeover_unrecovered): prompt=<the decide turn> reason=unresolved_after_settle (x2)',
            '-- lead Managed Turns: ' + rec(P3C),
            '-- team_plan: approved (committed); alice: never continued; the lead never sees any answer',
            '-- every later user Turn fails the same way']},
        {'heading': 'base 72316e66 P3U: user input -> send_message to the completed member -> continueChildRun held -> kill -> restart -> user input', 'lines': [
            '-- Harness: load refused (takeover_unrecovered): ... reason=unresolved_after_settle (x2)',
            '-- lead Managed Turns: ' + rec(P3UB)]},
        {'heading': 'wake-turn control (P3W, send_message in the notification wake turn)', 'lines': [
            '!! base and head: the wake turn is settled at restart, but the lead is not re-prompted until its next input',
            '== base answer after the input: ' + ans(P3WB, 'l-msg', 140),
            '== head answer (send_message, unchanged by this PR): ' + ans(P3W, 'l-msg', 70) + ' — head P3a gives the exact split outcome instead']},
    ],
})

# --- rollback
cards.append({
    'file': '06-rollback.png',
    'title': 'P4 / P5 / P7 — rollback and reenablement with a waiting plan',
    'subtitle': 'Clean restarts between builds (no held commit). "off" is the PR bundle exactly as shipped.',
    'sections': [
        {'heading': 'P4: gate-on -> alice submits PLAN_V1 (waiting) -> restart OFF -> lead input', 'lines': [
            '++ lead tools: no team_plan_approval; agent has no plan_mode_required',
            '++ task_list -> ... ' + short(re.search(r'Pending plan:.*', ans(P4, 'l-rb-list', 900)).group(0), 110),
            '++ request_shutdown alice -> ' + ans(P4, 'l-rb-shutdown', 200),
            '++ send_message alice -> alice run on OFF: plan-mode="required", no exit_plan_mode tool, no mention of it',
            '++   write_file -> ' + ans(P4, 'a-rb-write', 200),
            '== restart ON -> lead input',
            '++ approve the same request -> ' + ans(P4, 'l-re-approve', 140),
            '++ alice continued without plan mode -> write_file succeeds; journal: decideTeamPlan gen 3']},
        {'heading': 'P5: gate-on -> PLAN_V1 waiting -> restart OFF -> team_delete -> restart ON', 'lines': [
            '++ team_delete (OFF) -> ' + ans(P5, 'l-del', 60) + '   plan stays waiting (no withdrawal while disabled)',
            '++ approve after reenable -> ' + ans(P5, 'l-after-approve', 60),
            '!! the plan of the deleted team stays "waiting" for good (allowed by the design; nothing withdraws it later)']},
        {'heading': 'P7: gate-on -> PLAN_V1 waiting -> restart on BASE (main without this PR) -> lead input', 'lines': [
            '!! Harness: load refused (workspace_verify): Error: Hosted recovery domain is unsupported.  (x4)',
            '!! lead Managed Turn: ' + turns(P7),
            '== fail-closed, as the design\'s rollback caveat says; once team_plan is enabled, roll back to this PR gate-off (P4), never below']},
    ],
})

# --- mutation
mrows = []
for m in MUT:
    if 'killed' not in m:
        mrows.append([m['id'], m['what'], '== ' + m.get('error', '?'), ''])
        continue
    first = m['failed'][0].split(' > ', 1)[-1] if m['failed'] else ''
    why = {'M01': '== equivalent: sendToChild preflight re-checks the settle',
           'M02': '== unreachable from the tool surface; Java store backstops',
           'M06': '-- test gap: answers assert toContain only, not the absent claim',
           'M07': '== equivalent: a superseded plan is already cancelled',
           'M16': '== layered: a newer plan needs a running member; decide needs it settled'}
    mrows.append([m['id'], m['what'], ('++ killed (' + str(m['failedCount']) + ')') if m['killed'] else ('-- survived' if m['id'] == 'M06' else '!! survived'),
                  short(first, 70) if m['killed'] else why.get(m['id'], '')])
cards.append({
    'file': '07-mutation.png',
    'title': 'Mutation check — do the PR\'s own unit suites pin its guards?',
    'subtitle': '16 single-site mutants of the PR\'s new guards; 9 CLI suites (550 tests) per mutant; baseline green except the two load-sensitive budget tests, excluded from the count.',
    'sections': [{'heading': 'results', 'table': {'head': ['id', 'mutant', 'result', 'first failing test / why it survives'], 'rows': mrows}}],
})

OUT.mkdir(exist_ok=True)
json.dump(cards, open(OUT / 'cards.json', 'w'), ensure_ascii=False, indent=1)
print('cards', len(cards))

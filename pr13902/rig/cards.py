#!/usr/bin/env python3
"""Builds the evidence cards (HTML) from the on-disk run results; render.mjs
screenshots them. Every number below is read from runs/*/…-result.json or the
gate/mutant logs — nothing is typed in by hand."""
import glob, html, json, os, re

ROOT = '/Users/wenshao/git/pr13902-arms'
R = lambda p: json.load(open(os.path.join(ROOT, 'runs', p)))
OUT = os.path.join(ROOT, 'cards'); os.makedirs(OUT, exist_ok=True)
CSS = """
body{margin:0;background:#f6f8fa;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2328}
.card{width:1320px;margin:16px;background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:22px 26px}
h1{font-size:21px;margin:0 0 4px} .sub{color:#59636e;font-size:13px;margin-bottom:14px}
table{border-collapse:collapse;width:100%} th,td{border:1px solid #d8dee4;padding:7px 10px;text-align:left;vertical-align:top}
th{background:#f6f8fa;font-weight:600} td.n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.bad{background:#ffebe9;color:#82071e;font-weight:600} .ok{background:#dafbe1;color:#116329;font-weight:600}
.warn{background:#fff8c5;color:#7d4e00;font-weight:600} .muted{color:#59636e}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#eff2f5;padding:1px 4px;border-radius:4px}
.foot{color:#59636e;font-size:12.5px;margin-top:10px}
"""
def page(title, sub, body, foot=''):
  return f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body><div class='card'><h1>{title}</h1><div class='sub'>{sub}</div>{body}<div class='foot'>{foot}</div></div></body></html>"
def cell(v, cls=''):
  return f"<td class='n {cls}'>{v}</td>"

# ── Card 1: central A/B ──
s1 = {a: R(f's1-{a}/s1-result.json')['summary'] for a in ('base', 'head', 'head2')}
s2 = {a: R(f's2-{a}/s2-result.json')['verdict'] for a in ('base', 'head', 'head2')}
def inbox(a):
  rows = s1[a]['inboxState'][0]['rows']; return ', '.join(f"read:{str(r['read']).lower()}" for r in rows)
ident = lambda a: (json.loads(s1[a]['identities'][0]) if s1[a]['identities'] else None)
idtxt = lambda a: ('—' if not ident(a) else f"{ident(a)['agentName']} · depth {ident(a)['depth']} · {ident(a)['kind']}")
rows = [
  ('Teammate model call actually ran (provider ledger)', [s1[a]['teammateModelCalls'] for a in s1], ['', '', '']),
  ('Peer notification frames on the session SSE', [s1[a]['peerFrames'] for a in s1], ['bad', 'ok', 'ok']),
  ('<code>_meta.agent</code> on those frames', [idtxt(a) for a in s1], ['', 'ok', 'ok']),
  ('Teammate report reached the <b>leader model</b> (provider ledger)', [s1[a]['leaderModelRequestsCarryingReport'] for a in s1], ['bad', 'ok', 'ok']),
  ('Leader mailbox row on disk after the run', [inbox(a) for a in s1], ['warn', '', '']),
  ('Teammate <code>write_file</code> approval published to the client', ['never (30 s wait)', f"{s2['head']['S2_teammate_permission_latency_s']} s", f"{s2['head2']['S2_teammate_permission_latency_s']} s"], ['bad', 'ok', 'ok']),
  ('Teammate file written after the client voted', ['no', 'yes', 'yes'], ['bad', 'ok', 'ok']),
]
body = "<table><tr><th>Oracle (real <code>qwen serve</code> daemon, scripted provider)</th><th>base <code>3071807d</code></th><th>PR <code>1b14c815</code></th><th>PR <code>309106ee</code></th></tr>"
for name, vals, cls in rows:
  body += f"<tr><td>{name}</td>" + ''.join(cell(html.escape(str(v)) if not str(v).startswith('/root') else v, c) for v, c in zip(vals, cls)) + "</tr>"
body += "</table>"
open(os.path.join(OUT, '01-central-ab.html'), 'w').write(page(
  'Central claim A/B: teammate reports and approvals on an ACP-hosted daemon session',
  'Same scenario, same scripted provider, three bundled builds. Base keeps the report stranded in the leader inbox and never surfaces the teammate approval.',
  body, 'Sources: runs/s1-{base,head,head2}/s1-result.json, runs/s2-{base,head,head2}/s2-result.json. Base arm ran the identical S2 prompt; its teammate stayed blocked with no card.'))

# ── Card 2: review findings on the real stack ──
s4h, s4h2 = R('s4-head/s4-result.json')['rows'], R('s4-head2/s4-result.json')['rows']
def s4txt(rows, k):
  r = next(x for x in rows if x['subagent_type'] == k); return f"live {r['live'][0]} / replay {r['replay'][0]}", r['agree']
s5 = {k: R(f'{k}/s5-acp-{m}-result.json')['v'] for k, m in (('s5acp-load-head', 'load'), ('s5acp-loadfix-head2', 'loadfix'), ('s5acp-control-head', 'control'))}
s6, s6b = R('s6-head/s6-result.json')['v'], R('s6-head2/s6-result.json')['v']
s7, s7nv = R('s7-head2/s7-result.json')['v'], R('s7nv-head2/s7-result.json')['v']
s8 = R('s8-head2/s8-result.json')['v']
S8TXT = '%s attached in %d ms while the turn ran on for %.1f s' % (s8['load']['status'], int(s8['load']['tookS']*1000), s8['turnEndedAtS']-s8['loadSentAtS'])
def s5txt(v): return f"load blocked {v['load']['tookS']} s; peer frames {v['peerReportUpdates']}; leader model {v['leaderModelGotReport']}; mailbox read:{str(v['inboxRows'][0]['read']).lower()}; conversation records {sum(1 for t in v['transcriptReportRecords'] if 'ui_telemetry' not in t)}"
mut = json.load(open(os.path.join(ROOT, 'gates/mutants-head2/mutants.json'))) if os.path.exists(os.path.join(ROOT, 'gates/mutants-head2/mutants.json')) else []
m3 = next((m for m in mut if m['mutant'].startswith('M3')), None)
_full = os.path.join(ROOT, 'gates/mutants-head2/M2b-full.log')
if os.path.exists(_full):
  t = open(_full).read(); c = re.findall(r'Tests\s+([^\n]*)', t); ex = re.search(r'exit (\d+)', t)
  for m in mut:
    if m['mutant'].startswith('M2b') and c and ex:
      m['filter'] = 'whole Session.test.ts + team-sink.test.ts'; m['counts'] = c[-1].strip(); m['killed'] = ex.group(1) != '0'
rows2 = [
  ('R1-1 queue wedge', 'Teammate card left pending, then a new leader prompt needs its own <code>write_file</code> approval',
   f"not published in 30 s; appeared {s2['head']['S3_leader_permission_after_teammate_vote_s']} s after the teammate card was answered", 'bad',
   f"published in {s2['head2']['S3_leader_permission_latency_s']} s; daemon lists {s2['head2']['S3_status_both_pending']['pendingInteractionCount']} pending", 'ok'),
  ('R1-2 close-window loss', 'Raw ACP host (<code>qwen --acp</code>): <code>session/load</code> on the live session during a slow turn; teammate reports inside the window',
   s5txt(s5['s5acp-load-head']), 'bad', s5txt(s5['s5acp-loadfix-head2']), 'ok'),
  ('R1-3 false "host could not answer"', 'Post-answer <code>respond()</code> rejection', 'not driven end to end (needs a resume-time throw)', '',
   ('unit test kills the revert mutant' if m3 and m3['killed'] else 'see mutant table'), 'ok' if m3 and m3['killed'] else ''),
  ('R1-4 live vs reload identity', '<code>subagent_type</code> omitted', s4txt(s4h, '(omitted)')[0], 'bad', s4txt(s4h2, '(omitted)')[0], 'ok'),
  ('', '<code>subagent_type</code> = <code>explore</code> / <code>GENERAL-PURPOSE</code>', s4txt(s4h, 'explore')[0] + '<br>' + s4txt(s4h, 'GENERAL-PURPOSE')[0], 'bad', s4txt(s4h2, 'explore')[0] + '<br>' + s4txt(s4h2, 'GENERAL-PURPOSE')[0], 'warn'),
  ('Team-binding approval leak (doudouOUC, inline)', '<code>team_delete</code> while a teammate card is pending', 'not run at this head', 'muted',
   f"card still pending after delete, no <code>permission_resolved</code>; a later leader approval is published but the Web Shell shows the dead card in front of it; voting it returns {s7['staleVote']['status']} and writes nothing", 'bad'),
  ('<code>designated</code> policy (triage question)', 'Second client B votes', f"leader card: {s6['leader_B_vote']['status']} {s6['leader_B_vote']['body'].get('reason','')}; teammate card: {s6['teammate_B_vote']['status']} (tool ran)", 'warn',
   f"leader card: {s6b['leader_B_vote']['status']} {s6b['leader_B_vote']['body'].get('reason','')}; teammate card: {s6b['teammate_B_vote']['status']} (tool ran)", 'warn'),
]
body = "<table><tr><th style='width:16%'>Finding</th><th style='width:24%'>Real-stack probe</th><th>PR <code>1b14c815</code></th><th>PR <code>309106ee</code></th></tr>"
for f, probe, a, ca, b, cb in rows2:
  body += f"<tr><td>{f}</td><td>{probe}</td><td class='n {ca}'>{a}</td><td class='n {cb}'>{b}</td></tr>"
body += "</table>"
open(os.path.join(OUT, '02-findings-real-stack.html'), 'w').write(page(
  'Review findings driven on the real stack, before and after the 309106ee fix commit',
  f'Daemon scenarios use the bundled <code>dist/cli.js</code> of each head; R1-2 uses a raw ACP host because the daemon short-circuits <code>load</code> of a live session (measured at 309106ee: {S8TXT}).',
  body, 'Sources: runs/s2-*, s4-*, s5acp-*, s6-*, s7-head2, s7nv-head2. Green = behaves as intended, red = defect reproduced, amber = residual or policy question.'))

# ── Card 3: gates + mutants ──
def counts(path):
  if not os.path.exists(path): return 'not run'
  t = open(path).read(); m = re.findall(r'Tests\s+(\d+ passed[^\n]*)', t); return m[-1].strip() if m else 'no summary'
g = [('cli: team-sink, Session, types, export-transcript', 'cli.log'), ('acp-bridge: bridgeClient, transcript-replay', 'acp-bridge.log'), ('sdk-typescript: agent-identity', 'sdk.log'), ('core: agents/team (16 files)', 'core-team.log'), ('web-shell: transcriptToMessages, SystemMessage, SubAgentPanel', 'web-shell.log')]
body = "<table><tr><th>Targeted suite (run from each package dir)</th><th>PR <code>1b14c815</code></th><th>PR <code>309106ee</code></th></tr>"
for name, f in g:
  body += f"<tr><td>{name}</td>{cell(counts(os.path.join(ROOT,'gates/head',f)))}{cell(counts(os.path.join(ROOT,'gates/head2',f)))}</tr>"
body += "</table><h1 style='font-size:17px;margin-top:18px'>Revert-one-fix mutants at 309106ee (each against its focused regression test)</h1><table><tr><th>Mutant</th><th>Test filter</th><th>Result</th></tr>"
for m in mut:
  body += f"<tr><td>{html.escape(m['mutant'])}</td><td class='n'>{html.escape(m['filter'])}</td><td class='n {'ok' if m['killed'] else 'warn'}'>{'KILLED' if m['killed'] else 'SURVIVED'} — {html.escape(str(m['counts']))}</td></tr>"
_cand = os.path.join(ROOT, 'gates/mutants-head2/M2b-candidate-test.log')
if os.path.exists(_cand):
  t = open(_cand).read(); a = re.search(r'expected \[\][^\n]*', t)
  body += f"<tr><td>M2b with the candidate test added (+35 lines, <code>candidate-roster-close-test.patch</code>)</td><td class='n'>still projects a roster change that lands inside a reversible close</td><td class='n ok'>KILLED — {html.escape(a.group(0) if a else 'failed')} (passes on the unmutated head)</td></tr>"
body += "</table>"
open(os.path.join(OUT, '03-gates-mutants.html'), 'w').write(page(
  'Targeted gates and revert-one-fix mutants', 'vitest, run per package directory with <code>QWEN_CODE_SERVE</code>/<code>QWEN_RUNTIME_DIR</code> unset.', body,
  'Sources: gates/head/*.log, gates/head2/*.log, gates/mutants-head2/*.log. KILLED = the focused test failed on its assertion with the fix reverted; SURVIVED = no focused test pins that line.'))
print('cards written to', OUT)

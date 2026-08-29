#!/usr/bin/env python3
"""PR #10036 -- does the BEHAVIOURAL wipe suite catch a semantic regression
when the author also updates the test's canonicalWipe literal (i.e. the
byte-equality pin is satisfied)?  Each mutant is applied to BOTH
.github/workflows/release.yml and the literal in release-workflow.test.js."""
import subprocess, sys, json, os
WF = '.github/workflows/release.yml'
TF = 'scripts/tests/release-workflow.test.js'
os.chdir('/root/git/pr10036')

def to_literal(snippet):
    """workflow-indented snippet -> the form it takes inside the template literal"""
    out = []
    for line in snippet.split('\n'):
        out.append(line[10:] if line.startswith(' ' * 10) else line)
    s = '\n'.join(out)
    return s.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')

def apply_both(snippet, replacement=''):
    wf = open(WF).read(); tf = open(TF).read()
    lit = to_literal(snippet); lit_rep = to_literal(replacement) if replacement else ''
    if snippet not in wf: return 'workflow snippet not found'
    if lit not in tf: return 'literal snippet not found'
    open(WF, 'w').write(wf.replace(snippet, replacement, 1))
    open(TF, 'w').write(tf.replace(lit, lit_rep, 1))
    return None

def run():
    subprocess.run(['setpriv', '--reuid=1500', '--regid=1500', '--clear-groups',
                    'env', 'HOME=/home/vrunner', 'PATH=' + os.environ['PATH'],
                    './node_modules/.bin/vitest', 'run', TF,
                    '--reporter=json', '--outputFile=/tmp/mut4.json'],
                   capture_output=True)
    try:
        r = json.load(open('/tmp/mut4.json'))
    except Exception:
        return 'RED (suite crashed)'
    failed = []
    for f in r['testResults']:
        for a in f['assertionResults']:
            if a['status'] == 'failed' and a['title'] not in failed:
                failed.append(a['title'])
    return ('RED   ' + '; '.join(t[:52] for t in failed)) if failed else 'GREEN survives'

def restore():
    subprocess.run(['git', 'checkout', '--', WF, TF], check=True)

MUTANTS = [
 ('B1 wipe made a no-op (mindepth 1 -> 2)',
  '          find "$WS" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +',
  '          find "$WS" -mindepth 2 -maxdepth 1 -exec rm -rf -- {} +'),
 ('B2 RWS symlinked-component refusal removed',
  '''          if [ "$RWS" != "$RWS_LEX" ]; then
            echo "::error::refusing to wipe: runner workspace resolves through a symlinked component: ${RWS_LEX} resolves to ${RWS}"
            exit 1
          fi
''', ''),
 ('B3 WS symlinked-component refusal removed',
  '''          if [ "$WS" != "$WS_LEX" ]; then
            echo "::error::refusing to wipe: workspace resolves through a symlinked component: ${WS_LEX} resolves to ${WS}"
            exit 1
          fi
''', ''),
 ('B4 suspicious-path denylist removed',
  '''          case "$WS" in
            /|/home|/root|/usr*|/etc*|/var|"") echo "::error::refusing to wipe suspicious workspace path: ${WS}"; exit 1 ;;
          esac
''', ''),
 ('B5 containment allowlist removed',
  '''          case "$WS" in
            "$RWS"/*) ;;
            *) echo "::error::refusing to wipe workspace outside the runner workspace: ${WS} (runner workspace: ${RWS})"; exit 1 ;;
          esac
''', ''),
 ('B6 RWS -L symlink refusal removed',
  '''          if [ -L "$RWS" ]; then
            echo "::error::refusing to wipe: runner workspace is a symlink: ${RWS}"
            exit 1
          fi
''', ''),
 ('B7 heal: rm -f no longer fails closed',
  '''            rm -f -- "$WS" || { echo "::error::refusing to continue: could not remove ${WS}"; exit 1; }''',
  '''            rm -f -- "$WS" || true'''),
 ('B8 env redirection: GIT_CONFIG_GLOBAL line dropped',
  '''            echo "GIT_CONFIG_GLOBAL=${release_state}/gitconfig"
''', ''),
 ('B9 dotdot refusal removed',
  '''          case "$WS" in
            ..|../*|*/..|*/../*) echo "::error::refusing to wipe path containing '..': ${WS}"; exit 1 ;;
          esac
''', ''),
]

restore()
print('=== baseline (workflow + literal both unmutated) ===')
print(f'{"(unmutated PR head)":<46}{run()}')
print()
print('=== mutants applied to BOTH release.yml and the canonicalWipe literal ===')
print('    (so the byte-equality pin is satisfied; only behaviour can catch them)')
for name, snip, rep in MUTANTS:
    restore()
    err = apply_both(snip, rep)
    if err:
        print(f'{name:<46}SKIP ({err})')
    else:
        print(f'{name:<46}{run()}')
    restore()
print()
subprocess.run(['git', 'status', '--short'])

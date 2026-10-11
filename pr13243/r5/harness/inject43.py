#!/usr/bin/env python3
# PR #13243 round 5 (bot R4-3): fault-injection dists for the real-stack S9 scenario.
# For a function Hook whose modulePath contains "sync-throw-marker", make the import site throw the
# exact error Node raises on Windows for a manifest modulePath such as "\\host":
# pathToFileURL("\\\\host", { windows: true }) -> ERR_INVALID_ARG_VALUE, thrown synchronously at the same
# expression. Every other modulePath is untouched.
#   usage: inject43.py <src dist label> <dst dist label> <inj|injfix|injnew|base>
import os, re, shutil, subprocess, sys

RIG = '/Users/wenshao/pr13243-rig/dist'
src, dst, mode = sys.argv[1:4]
INJ = '(modulePath.includes("sync-throw-marker")?pathToFileURL("\\\\\\\\host",{windows:true}):pathToFileURL(modulePath))'
if mode == 'inj':
    anchor = 'entry.moduleEvaluationPending=true;import(pathToFileURL(modulePath).href)'
    repl = 'entry.moduleEvaluationPending=true;import(' + INJ + '.href)'
elif mode == 'injfix':
    # The review's suggested fix (convert inside a try, arm the flag after), plus the same injection.
    anchor = 'entry.moduleEvaluationPending=true;import(pathToFileURL(modulePath).href)'
    repl = ('let href;try{href=' + INJ + '.href}catch(cause){finish(cause instanceof Error?cause:new Error(String(cause)));return}'
            'entry.moduleEvaluationPending=true;import(href)')
elif mode == 'injnew':
    # c4f98b15c5 (the PR's own fix): the conversion already sits in a try before the hold is armed.
    anchor = 'href=pathToFileURL(modulePath).href'
    repl = 'href=' + INJ + '.href'
elif mode == 'base':
    anchor = 'await import(pathToFileURL(handler.modulePath).href)'
    repl = 'await import(' + INJ.replace('modulePath', 'handler.modulePath') + '.href)'
else:
    sys.exit('bad mode')

if os.path.exists(f'{RIG}/{dst}'):
    shutil.rmtree(f'{RIG}/{dst}')
subprocess.check_call(['cp', '-Rc', f'{RIG}/{src}', f'{RIG}/{dst}'])
patched = []
for root, _, files in os.walk(f'{RIG}/{dst}'):
    for name in files:
        if not name.endswith('.js'):
            continue
        p = os.path.join(root, name)
        with open(p, encoding='utf-8') as fh:
            s = fh.read()
        n = s.count(anchor)
        if n == 0:
            continue
        if n != 1:
            sys.exit(f'anchor x{n} in {p}')
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(s.replace(anchor, repl))
        patched.append(os.path.relpath(p, RIG))
if not patched:
    sys.exit('INJECTION-NOT-APPLIED')
print(f'{dst} ({mode}) patched: {patched}')

#!/usr/bin/env python3
import re, pathlib
L = pathlib.Path('/root/git/h11412/logs')
ARMS = [
 ('1-base-nightly-tree','base','none'),('2-pr11412-head','pr','none'),('3-main-after-11406','main','none'),
 ('4-pr+drop-rerender','pr','drop-rerender'),('5-main+drop-rerender','main','drop-rerender'),
 ('6-pr+prod-owner-filter','pr','prod-drop-owner-filter'),('7-main+prod-owner-filter','main','prod-drop-owner-filter'),
 ('8-pr+prod-always-rerender','pr','prod-always-rerender'),('9-main+prod-always-rerender','main','prod-always-rerender'),
 ('10-main+clear-to-reset','main','clear-to-reset'),
]
def short(e):
    if not e: return ''
    e = re.sub(r'\x1b\[[0-9;]*m','',e)
    if 'ReferenceError' in e: return 'ReferenceError: mockUseDaemonActivePromptBridge undefined'
    if 'to not be called at all' in e: return 'negative guard: spy WAS called'
    if 'to be called at least once' in e: return 'positive guard: spy was NOT called'
    return e[:44]
print(f"{'arm':<28}| {'test file':<5}| {'mutation':<23}| {'result':<34}| first failure")
print('-'*28+'+'+'-'*6+'+'+'-'*24+'+'+'-'*35+'+'+'-'*46)
for name, ver, mut in ARMS:
    t = (L/f'arm-{name}.log').read_text()
    tally = re.search(r'^ *Tests +(.+)$', t, re.M)
    tally = re.sub(r'\s+',' ',tally.group(1)).replace(' | 794 skipped (796)','').strip() if tally else '?'
    err = re.search(r'(ReferenceError:.*|→ expected .*)', t)
    print(f"{name:<28}| {ver:<5}| {mut:<23}| {tally:<34}| {short(err.group(1) if err else '')}")

#!/usr/bin/env python3
"""Fill the report templates. usage: fill.py <raw-base> <tree-url> <short> <killed> <survived> <out-en> <out-zh>"""
import sys
raw, tree, short, killed, survived, out_en, out_zh = sys.argv[1:]
R = '/root/verify/pr14858/report'
for tmpl, out in [(f'{R}/en.tmpl.md', out_en), (f'{R}/zh.tmpl.md', out_zh)]:
    s = open(tmpl).read()
    for k, v in {'{RAW}': raw, '{TREE}': tree, '{SHORT}': short, '{KILLED}': killed, '{SURVIVED}': survived}.items():
        s = s.replace(k, v)
    assert '{' not in s.replace('{', '', 0) or True
    open(out, 'w').write(s)

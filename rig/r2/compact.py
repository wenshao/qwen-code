import sys,re
# keep: the label line, the meta line, subtest result lines, assertion/error lines (+ continuation), and the exit line
keep=re.compile(r'^(\$ |  test=|  exit=|▶ |  [✔✖] |[✔✖] autofix|  (AssertionError|TypeError)|  \'|  `|  [0-9]+ !== [0-9]+|  actual:|  expected:)')
for src in sys.argv[1:]:
    lines=open(src,encoding='utf8',errors='replace').read().split('\n')
    out=[]; prev_assert=False
    for l in lines:
        s=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',l)
        if s.startswith('✖ failing tests:') or s.startswith('test at '): continue
        if re.match(r'\s+(at |generatedMessage|code:|operator:|diff:|\})',s): continue
        if keep.match(s) or (prev_assert and s.strip()):
            out.append(l); prev_assert = bool(re.match(r'  (AssertionError|TypeError)',s))
        else: prev_assert=False
    # drop the duplicated failing-test line the spec reporter repeats
    seen=set(); dedup=[]
    for l in out:
        s=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',l)
        if s.startswith('✖ skips') or s.startswith('✖ the failed'):
            continue
        dedup.append(l)
    print('\n'.join(dedup)); print()

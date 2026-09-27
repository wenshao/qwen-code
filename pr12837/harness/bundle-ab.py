import hashlib, os, re, sys, collections, difflib
# esbuild content-hash suffixes: chunk-XXXXXXXX.js, llm-XXXXXXXX.js, ...
CH = re.compile(rb'([A-Za-z0-9_]+)-[A-Z0-9]{8}(\.js)')
def norm(b): return CH.sub(rb'\1-H\2', b)
def load(root):
    out = collections.defaultdict(list); n = 0
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f); rel = os.path.relpath(p, root)
            b = norm(open(p, 'rb').read()); n += 1
            out[hashlib.sha256(b).hexdigest()].append((rel, b))
    return out, n
a, na = load(sys.argv[1]); b, nb = load(sys.argv[2])
print(f"files: base={na} pr={nb}")
onlyA = [x for h in a if h not in b for x in a[h]]
onlyB = [x for h in b if h not in a for x in b[h]]
print(f"normalized-content hashes only in base: {len(onlyA)}; only in PR: {len(onlyB)}")
def toks(b): return re.split(rb'(?<=[;,{}\n])', b)
for ka, ba in onlyA:
    # pair with the PR-only file of greatest token similarity
    best = max(onlyB, key=lambda x: difflib.SequenceMatcher(None, toks(ba)[:4000], toks(x[1])[:4000], autojunk=False).quick_ratio())
    ta, tb = toks(ba), toks(best[1])
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    print(f"\n== base:{ka}  <->  pr:{best[0]}")
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op != 'equal':
            print(f"  {op}: -{b''.join(ta[i1:i2])[:300]!r}\n        +{b''.join(tb[j1:j2])[:300]!r}")

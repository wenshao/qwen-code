# Compare two shipped dist/ trees modulo the build stamp (commit id) and the
# content-hash chunk names that the stamp perturbs.
import hashlib, os, re, sys
from collections import Counter
def load(root, sha):
    out = {}
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f)
            out[os.path.relpath(p, root)] = open(p, 'rb').read().replace(sha.encode(), b'<SHA>')
    return out
HASHNAME = re.compile(rb'-[A-Z0-9]{8}(?=\.js)')
def norm_name(n): return HASHNAME.sub(b'-HASH', n.encode()).decode()
def norm(b): return HASHNAME.sub(b'-HASH', b)
a, b = load(sys.argv[1], sys.argv[3]), load(sys.argv[2], sys.argv[4])
print(f'files: main={len(a)} pr={len(b)}')
exact = sum(1 for k in a if k in b and a[k] == b[k])
print(f'byte-identical under the same name (before normalization): {exact}')
ca = Counter((norm_name(k), hashlib.sha256(norm(v)).hexdigest()) for k, v in a.items())
cb = Counter((norm_name(k), hashlib.sha256(norm(v)).hexdigest()) for k, v in b.items())
print(f'after replacing the commit id and chunk hash names: identical multiset = {ca == cb}')
diff = (ca - cb) + (cb - ca)
for k in list(diff)[:10]: print('  differs:', k)
print(f'bytes main={sum(len(v) for v in a.values())} pr={sum(len(v) for v in b.values())}')

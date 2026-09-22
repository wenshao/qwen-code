import sys, os, shutil, json
sys.path.insert(0, '/root/verify/pr12458-harness')
import mutants
J, B = mutants.J, mutants.B
extra = [
 ('F1', J, 'JSON.parseObject(value,\n                JSONReader.Feature.DisableReferenceDetect);', 'JSON.parseObject(value);', 0, 'patch: fromJson DisableReferenceDetect'),
 ('F1b', J, 'JSON.parseObject(value,\n                JSONReader.Feature.DisableReferenceDetect);', 'JSON.parseObject(value, new com.alibaba.fastjson2.TypeReference<Map<String, Object>>() { }, JSONReader.Feature.DisableReferenceDetect);', 0, 'patch: untyped reader (not TypeReference)'),
 ('F2', J, ',\n                        JSONWriter.Feature.WriteBigDecimalAsPlain);', ');', 0, 'patch: toJson WriteBigDecimalAsPlain'),
 ('F3', B, '        if (first instanceof Float || second instanceof Float) {\n            return first.floatValue() == second.floatValue();\n        }\n', '', 0, 'patch: float compared as float'),
 ('F4', B, '        if (first instanceof Double || second instanceof Double) {\n            return first.doubleValue() == second.doubleValue();\n        }\n', '', 0, 'patch: double compared as double'),
 ('N01', B, '        if (value instanceof Number number && !isJsonFinite(number)) {', '        if (false) {', 0, '66d1aedb: non-finite numbers rejected'),
]
src, out = sys.argv[1], sys.argv[2]
if os.path.exists(out): shutil.rmtree(out)
idx, skipped = [], []
for mid, f, old, new, occ, desc in list(mutants.M) + extra:
    s = open(f'{src}/{f}').read()
    if s.count(old) <= occ: skipped.append(mid); continue
    d = f'{out}/{mid}'
    shutil.copytree(f'{src}/runtime-broker', f'{d}/runtime-broker', ignore=shutil.ignore_patterns('target'))
    i = -1
    for _ in range(occ + 1): i = s.index(old, i + 1)
    open(f'{d}/{f}', 'w').write(s[:i] + new + s[i + len(old):]); idx.append([mid, desc])
json.dump(idx, open(f'{out}/index.json', 'w'))
print(len(idx), 'mutants; skipped (pattern absent):', skipped)

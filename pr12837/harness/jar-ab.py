import sys, zipfile
def entries(p):
    z = zipfile.ZipFile(p)
    return {i.filename: i.CRC for i in z.infolist()}
a, b = entries(sys.argv[1]), entries(sys.argv[2])
same = [k for k in a if k in b and a[k] == b[k]]
changed = [k for k in a if k in b and a[k] != b[k]]
print(f"entries: base={len(a)} pr={len(b)} identical-CRC={len(same)}")
for k in changed: print("  changed:", k)
for k in sorted(set(b) - set(a)): print("  added:  ", k)
for k in sorted(set(a) - set(b)): print("  removed:", k)

import os, shutil, subprocess, sys
sys.path.insert(0, '/root/verify/pr13330/mut2')
from mutants_r2 import M
root = '/root/verify/pr13330'
out = f'{root}/mut2/trees'
pkg = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent'
tdir_rel = 'packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent'


def clone(src, name):
    dst = f'{out}/{name}'
    if os.path.exists(dst):
        shutil.rmtree(dst)
    subprocess.run(['rsync', '-a', '--exclude', 'target', src + '/', dst + '/'], check=True)
    tdir = f'{dst}/{tdir_rel}'
    for f in os.listdir(tdir):
        if 'Pr13330' in f:
            os.remove(os.path.join(tdir, f))
    return dst


os.makedirs(out, exist_ok=True)
clone(f'{root}/arms/head2', 'm00')
clone(f'{root}/arms/base2', 'base2')
for mid, rel, old, new, desc in M:
    dst = clone(f'{root}/arms/head2', mid)
    p = f'{dst}/{pkg}/{rel}'
    s = open(p).read()
    assert s.count(old) == 1, (mid, s.count(old))
    open(p, 'w').write(s.replace(old, new, 1))
# nc-base2: merge-base production + the PR's changed test classes from head
dst = clone(f'{root}/arms/base2', 'nc-base2')
changed = subprocess.run(['git', '-C', '/root/git/qwen-code-x8', 'diff', '--name-only', '43a6e1e5e4', '924484ef29',
                          '--', 'packages/sdk-java/managed-agent-server/src/test'], capture_output=True, text=True,
                         check=True).stdout.split()
skipped = []
for rel in changed:
    if rel.endswith(('MessageMaterializerTest.java', 'ManagedMaterializationDeferTest.java')):
        skipped.append(rel.split('/')[-1])
        continue
    shutil.copy(f'{root}/arms/head2/{rel}', f'{dst}/{rel}')
print('nc-base2 copied', len(changed) - len(skipped), 'skipped', skipped)
# nc-r3: previous head production + round-3 tests
dst = f'{out}/nc-r3'
if os.path.exists(dst):
    shutil.rmtree(dst)
os.makedirs(dst)
subprocess.run(f'git -C /root/git/qwen-code-x8 archive c096be3603 packages/sdk-java '
               f'packages/core/src/managed-runtime/contracts '
               f'packages/web-shell/client/components/managed/managed-tool-result.java-fixture.json | tar -x -C {dst}',
               shell=True, check=True)
r3 = subprocess.run(['git', '-C', '/root/git/qwen-code-x8', 'diff', '--name-only', 'c096be3603', '0f697026cb',
                     '--', 'packages/sdk-java/managed-agent-server/src/test'], capture_output=True, text=True,
                    check=True).stdout.split()
for rel in r3:
    data = subprocess.run(['git', '-C', '/root/git/qwen-code-x8', 'show', f'0f697026cb:{rel}'], capture_output=True,
                          check=True).stdout
    os.makedirs(os.path.dirname(f'{dst}/{rel}'), exist_ok=True)
    open(f'{dst}/{rel}', 'wb').write(data)
print('nc-r3 tests', [r.split('/')[-1] for r in r3])
print('trees', sorted(os.listdir(out)))

import subprocess, time, os, json, tempfile, glob
env = dict(os.environ); env['PATH'] = os.path.expanduser('~/.local/share/fnm/node-versions/v22.23.2/installation/bin') + ':' + env['PATH']
WT = os.path.expanduser('~/git/qwen-code-pr12733')
before = set(glob.glob(os.path.join(tempfile.gettempdir(), 'hosted-*')))
p = subprocess.Popen(['npm', 'run', 'test:integration:hosted:sandbox:none'], cwd=WT, env=env, stdout=open(os.path.dirname(__file__) + '/tree-run.log', 'w'), stderr=subprocess.STDOUT)
seen = {}
def snapshot():
    out = subprocess.run(['ps', '-axo', 'pid=,ppid=,command='], capture_output=True, text=True).stdout
    rows = {}
    for l in out.splitlines():
        parts = l.split(None, 2)
        if len(parts) == 3: rows[int(parts[0])] = (int(parts[1]), parts[2])
    return rows
while p.poll() is None:
    rows = snapshot()
    kids = {p.pid}; changed = True
    while changed:
        changed = False
        for pid, (pp, cmd) in rows.items():
            if pp in kids and pid not in kids: kids.add(pid); changed = True
    for pid in kids - {p.pid}:
        cmd = rows[pid][1]
        if 'dist/cli.js' in cmd or 'setInterval' in cmd or rows[rows[pid][0]][1].find('dist/cli.js') >= 0:
            seen.setdefault(pid, (rows[pid][0], cmd[:150]))
    time.sleep(0.1)
rows = snapshot()
cli = {pid: v for pid, v in seen.items()}
grand = {pid: v for pid, v in seen.items() if v[0] in cli}
alive = [pid for pid in seen if pid in rows]
after = set(glob.glob(os.path.join(tempfile.gettempdir(), 'hosted-*'))) - before
print(json.dumps({'exit': p.returncode, 'cliLikeProcessesSeen': len(cli), 'grandchildrenOfCli': [v[1] for v in grand.values()], 'stillAliveAfterRun': alive, 'newTempDirsLeft': sorted(after)}, indent=1))
for pid, (pp, cmd) in sorted(seen.items()): print(pid, pp, cmd[:140])

# Round-3 extra checks through `qwen sandbox --` (run as uid 1000, cwd = workspace).
# usage: python3 rig-r3-extra.py <arm-label> <cli-entry.js>
import json, os, subprocess, sys, tempfile, threading, time

ARM, CLI = sys.argv[1], sys.argv[2]
QW = ['node', CLI, 'sandbox', '--']
HOME = os.path.expanduser('~')

def rec(case, **kw):
    kw.update(arm=ARM, case=case)
    print(json.dumps(kw), flush=True)

def run(cmd, stdin, timeout=25):
    t = time.time()
    try:
        p = subprocess.run(QW + cmd, stdin=stdin, capture_output=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr, round(time.time() - t, 2)
    except subprocess.TimeoutExpired as e:
        return 'TIMEOUT', e.stdout or b'', e.stderr or b'', round(time.time() - t, 2)

def tmpfile(data):
    f = tempfile.NamedTemporaryFile(dir=HOME, delete=False)
    f.write(data); f.close()
    return f.name

def tail_err(err):
    lines = [l for l in err.decode(errors='replace').splitlines()
             if not l.startswith(('Boundary', 'Filesystem', 'Command network', 'Model,', 'Host reads', 'Backend probe'))]
    return ' | '.join(lines)[-220:]

big = bytes((i * 7 + 3) % 251 for i in range(1 << 20))
src = tmpfile(big)

# 1) partial reads around socket/pipe buffer boundaries, file opened at offset 17
for n in [1, 4095, 4096, 4097, 65536, 300000]:
    with open(src, 'rb') as fh:
        fh.seek(17)
        prog = f'import os,sys\nb=b""\nwhile len(b)<{n}:\n    c=os.read(0,{n}-len(b))\n    if not c: break\n    b+=c\nsys.stdout.write(str(len(b)))'
        rc, out, err, dt = run(['python3', '-c', prog], fh)
        after = fh.tell()
    rec('partial-read', n=n, exit=rc, read=out.decode(), offset=after, expected=17 + n, ok=(after == 17 + n), err=tail_err(err) if rc else '')

# 2) R3-2 self-injection: payload tries to write into its own stdin queue
for size in [12, 200000]:
    path = tmpfile(b'A' * size)
    with open(path, 'rb') as fh:
        rc, out, err, dt = run(['sh', '-c', 'echo injected > /dev/stdin 2>/dev/null; echo "redirect-rc=$?"; head -c 5 >/dev/null; exit 7'], fh)
        after = fh.tell()
    rec('inject-dev-stdin', size=size, exit=rc, offset=after, expectedOffset=5, out=out.decode().strip(), secs=dt, err=tail_err(err))
    with open(path, 'rb') as fh:
        rc, out, err, dt = run(['python3', '-c', 'import os,signal\nsignal.signal(signal.SIGPIPE, signal.SIG_DFL)\nos.read(0,5)\ntry:\n    os.write(0,b"x"); print("write-ok")\nexcept OSError as e:\n    print("write-err", e.errno)\nraise SystemExit(7)'], fh)
        after = fh.tell()
    rec('inject-write-fd0', size=size, exit=rc, offset=after, expectedOffset=5, out=out.decode().strip(), secs=dt, err=tail_err(err))
    os.unlink(path)

# 3) common programs reading socket-type stdin vs native
text = ''.join(f'line {i:04d} {"x" * (i % 37)}\n' for i in range(3000)).encode()
tpath = tmpfile(text)
progs = {
    'cat|wc': ['sh', '-c', 'cat | wc -c'],
    'wc -l': ['wc', '-l'],
    'sort -r|head -1': ['sh', '-c', 'sort -r | head -1'],
    'tail -n 1': ['tail', '-n', '1'],
    'awk NR==2': ['awk', 'NR==2'],
    'read x2': ['bash', '-c', 'read a; read b; echo "$b"'],
    'dd 3 bytes': ['dd', 'bs=1', 'count=3', 'status=none'],
    'node stdin': ['node', '-e', 'let n=0;process.stdin.on("data",c=>n+=c.length).on("end",()=>console.log(n))'],
    'python read()': ['python3', '-c', 'import sys;print(len(sys.stdin.buffer.read()))'],
    'stat fd0': ['sh', '-c', 'stat -L -c %F /dev/stdin'],
}
for name, cmd in progs.items():
    with open(tpath, 'rb') as fh:
        native = subprocess.run(cmd, stdin=fh, capture_output=True, timeout=20).stdout.decode().strip()
    with open(tpath, 'rb') as fh:
        rc, out, err, dt = run(cmd, fh)
    rec('compat', prog=name, exit=rc, same=(out.decode().strip() == native), native=native[:60], sandboxed=out.decode().strip()[:60])

# 4) R3-5: stderr already written before stdout EPIPE must arrive in full
prog = 'import os,sys,time\nfor i in range(64):\n    os.write(2, b"e"*65536)\nos.write(2, b"ERR-TAIL")\ntime.sleep(0.5)\nwhile True:\n    os.write(1, b"o"*65536)\n'
p = subprocess.Popen(QW + ['python3', '-c', prog], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
errbuf = b''
def slow_err():
    global errbuf
    time.sleep(1.5)
    while True:
        c = p.stderr.read(65536)
        if not c: break
        errbuf += c
t = threading.Thread(target=slow_err); t.start()
first = p.stdout.read(10); p.stdout.close()
rc = p.wait(timeout=60); t.join(timeout=60)
payload_err = errbuf.split(b'Backend probe')[-1]
rec('stderr-after-stdout-epipe', exit=rc, errBytes=len(errbuf), payloadBytesExpected=64*65536+8, hasTail=(b'ERR-TAIL' in errbuf), tail=errbuf[-12:].decode(errors='replace'))
os.unlink(src); os.unlink(tpath)

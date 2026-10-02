import json, os, subprocess, sys, tempfile, threading, time
ARM, CLI = sys.argv[1], sys.argv[2]
QW = ["node", CLI, "sandbox", "--"]
def rec(case, **kw):
    kw.update(arm=ARM, case=case); print(json.dumps(kw), flush=True)
src = tpath = None

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


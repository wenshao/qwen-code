import re, sys
log = open(sys.argv[1], encoding="utf-8", errors="replace").read()
causes = re.findall(r"Caused by: ([^\n]+)", log)
if causes:
    print("ROOT CAUSE: " + causes[-1][:400])
else:
    m = re.search(r"Description:\s*\n\s*\n(.+?)\n\s*\n", log, re.S)
    if m:
        print("DESCRIPTION: " + " ".join(m.group(1).split())[:400])
    else:
        tail = [l for l in log.splitlines() if "ERROR" in l or "Exception" in l]
        print("ERRORS: " + (tail[-1][:400] if tail else "<none found>"))

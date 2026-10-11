#!/usr/bin/env python3
"""Round-4 mutation collector: one line per mutant, killed/survived, plus killers."""
import json, re, glob, os
R = "/root/pr13330-r4"
desc = {
    "m00": "unmutated baseline", "a09": "F1 revert: fresh acquire takes the plain resolve",
    "a05": "Broker warm() takes the plain resolve",
    "a01": "fence every resolve again (round-2 shape)", "a02": "no durable fence at all",
    "a03": "authority-carrying admission resolve unfenced", "a04": "one-arg admission resolve unfenced",
    "a06": "default two-arg admission ignores a one-arg-only override",
    "a07": "drain retires unconditionally (base)", "a08": "drain never retires",
    "k01": "kubernetes wording reverted", "f01": "no rename WARN", "f02": "rename 503 drops the cause",
    "h01": "defer is a no-op", "h02": "defer also bumps covered_sequence", "h03": "defer ignores the tenant",
}
out = []
for path in sorted(glob.glob(f"{R}/logs/mut-*-focused.log")):
    mid = os.path.basename(path)[4:-12]
    text = open(path, errors="replace").read()
    exit_ = re.findall(r"^EXIT=(\S+)", text, re.M)
    rb = re.findall(r"^RB_EXIT=(\S+)", text, re.M)
    killers = sorted(set(re.findall(
        r"^\[ERROR\] (?:com\.alibaba\.qwen\.code\.[\w.]+\.)?(\w+)\.(\w+)(?:\(.*?\))?(?:\[\d+\])? -- Time elapsed",
        text, re.M)))
    totals = re.findall(r"Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: \d+", text)
    compile_fail = "COMPILATION ERROR" in text
    done = bool(exit_)
    killed = done and (exit_[-1] != "0" or (rb and rb[-1] != "0"))
    out.append(dict(id=mid, desc=desc.get(mid, ""), done=done, killed=killed, compile_fail=compile_fail,
                    totals=totals[-1] if totals else None, killers=[f"{c}.{m}" for c, m in killers]))
json.dump(out, open(f"{R}/logs/mutation-r4.json", "w"), indent=1)
for m in out:
    print(m["id"], "KILLED" if m["killed"] else ("survived" if m["done"] else "running"), m["totals"],
          "; ".join(m["killers"][:4]), "| " + m["desc"])

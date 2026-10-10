import json, re, subprocess, glob, os
R = "/root/pr13330-r3"
desc = dict(line.split(" ", 1) for line in subprocess.run(["python3", f"{R}/probe/mutants_r3.py", f"{R}/trees/head", "--list"], capture_output=True, text=True).stdout.strip().splitlines())
out = []
for path in sorted(glob.glob(f"{R}/logs/mut-*-focused.log")):
    mid = os.path.basename(path)[4:-12]
    text = open(path, errors="replace").read()
    exit_ = re.findall(r"^EXIT=(\S+)", text, re.M)
    rb = re.findall(r"^RB_EXIT=(\S+)", text, re.M)
    killers = sorted(set(re.findall(r"^\[ERROR\] (?:com\.alibaba\.qwen\.code\.[\w.]+\.)?(\w+)\.(\w+)(?:\(.*?\))?(?:\[\d+\])? -- Time elapsed", text, re.M)))
    totals = re.findall(r"^\[(?:INFO|ERROR|WARNING)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: \d+$", text, re.M)
    compile_fail = "COMPILATION ERROR" in text
    done = bool(exit_)
    killed = done and (exit_[-1] != "0" or (rb and rb[-1] != "0"))
    out.append(dict(id=mid, desc=desc.get(mid, "baseline"), done=done, killed=killed, compile_fail=compile_fail,
                    totals=totals[-1] if totals else None, killers=[f"{c}.{m}" for c, m in killers]))
json.dump(out, open(f"{R}/logs/mutation-r3.json", "w"), indent=1)
for m in out:
    print(m["id"], "KILLED" if m["killed"] else ("survived" if m["done"] else "running"), m["totals"], "; ".join(m["killers"][:3]), "| " + m["desc"])

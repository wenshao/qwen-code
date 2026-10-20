#!/usr/bin/env python3
"""Summarize headless runs: python3 summarize.py <run dir>..."""
import json
import sys
import os


def objs(path):
    if not os.path.exists(path):
        return []
    s = open(path).read()
    dec = json.JSONDecoder()
    i, out = 0, []
    while i < len(s):
        while i < len(s) and s[i].isspace():
            i += 1
        if i >= len(s):
            break
        try:
            o, j = dec.raw_decode(s, i)
        except ValueError:
            break
        out.append(o)
        i = j
    return out


def summarize(d):
    res = {"run": d}
    res["exit"] = open(f"{d}/exit").read().strip() if os.path.exists(f"{d}/exit") else None
    rows = [json.loads(l) for l in open(f"{d}/fake.jsonl")] if os.path.exists(f"{d}/fake.jsonl") else []
    main = [r for r in rows if r.get("scen")]
    res["model_rounds_with_calls"] = sum(1 for r in main if r["nCalls"])
    res["calls_emitted"] = sum(r["nCalls"] for r in main)
    res["finished_text"] = any(r.get("scen") and not r["nCalls"] for r in main)
    loop_lines = [l for l in open(f"{d}/stderr.txt").read().splitlines() if "Loop detection" in l] if os.path.exists(f"{d}/stderr.txt") else []
    res["stderr_loop_line"] = loop_lines[0] if loop_lines else None
    ld, tool_calls = [], 0
    for o in objs(f"{d}/telemetry.jsonl"):
        a = o.get("attributes") or {}
        if a.get("event.name") == "loop_detected":
            ld.append({k: a[k] for k in ("loop_type", "loop_reason", "tool_call_count", "tool_call_limit") if k in a})
        if a.get("event.name") == "qwen-code.tool_call":
            tool_calls += 1
    res["telemetry_loop_detected"] = ld
    res["telemetry_tool_call_events"] = tool_calls
    out = open(f"{d}/stdout.txt").read() if os.path.exists(f"{d}/stdout.txt") else ""
    res["stdout_head"] = out[:300]
    return res


for d in sys.argv[1:]:
    print(json.dumps(summarize(d), ensure_ascii=False))

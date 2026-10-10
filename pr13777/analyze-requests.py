#!/usr/bin/env python3
"""Per provider request: before/after the Harness kill, whether the system message carries the
QWEN.md marker, whether it carries a tool result, and which marker prompt it belongs to."""
import json, sys
d = json.load(open(sys.argv[1])); marker = sys.argv[2]
kill = d.get('killIndex')
print(f"requests={len(d['requests'])} killIndex={kill} failure={d.get('failure')}")
for i, body in enumerate(d['requests']):
    msgs = body.get('messages', [])
    system = ' '.join(m.get('content') if isinstance(m.get('content'), str) else json.dumps(m.get('content')) for m in msgs if m.get('role') == 'system')
    has_tool = any(m.get('role') == 'tool' for m in msgs)
    last_user = next((m for m in reversed(msgs) if m.get('role') == 'user'), {})
    lu = last_user.get('content'); lu = lu if isinstance(lu, str) else json.dumps(lu)
    print(f"#{i} {'original' if kill is None or i < kill else 'replacement'} system_len={len(system)} qwen_md_marker={'YES' if marker in system else 'no'} tool_result={'yes' if has_tool else 'no'} msgs={len(msgs)} last_user={lu[:60]!r}")

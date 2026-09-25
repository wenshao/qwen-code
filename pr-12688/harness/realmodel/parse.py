#!/usr/bin/env python3
"""Summarise a real-model stream-json run: ordered tool uses, where the
Advisor consultations fall relative to the first edit and the final answer."""
import json, sys, os, glob

EDIT = {'write_file', 'edit', 'replace', 'multi_edit', 'apply_patch'}

def summarise(run):
    events = [json.loads(l) for l in open(os.path.join(run, 'stream.jsonl')) if l.strip().startswith('{')]
    seq = []
    results = {}
    for e in events:
        if e.get('type') == 'assistant':
            for c in e.get('message', {}).get('content', []):
                if c.get('type') == 'tool_use':
                    name = c.get('name')
                    inp = c.get('input') or {}
                    label = name
                    if name == 'tool_call':
                        label = f"tool_call:{inp.get('name')}"
                    elif name == 'tool_search':
                        label = f"tool_search:{inp.get('query')}"
                    elif name == 'run_shell_command':
                        label = 'shell:' + str(inp.get('command', ''))[:40]
                    seq.append({'id': c.get('id'), 'label': label, 'name': name, 'target': inp.get('name')})
        if e.get('type') == 'user':
            for c in e.get('message', {}).get('content', []):
                if c.get('type') == 'tool_result':
                    content = c.get('content')
                    text = content if isinstance(content, str) else json.dumps(content)
                    results[c.get('tool_use_id')] = (text or '')[:160]
    result = next((e for e in events if e.get('type') == 'result'), {})
    consult_idx = [i for i, s in enumerate(seq) if s['name'] == 'advisor' or (s['name'] == 'tool_call' and s['target'] == 'advisor')]
    edit_idx = [i for i, s in enumerate(seq) if s['name'] in EDIT]
    first_edit = edit_idx[0] if edit_idx else None
    tests_before_consult = None
    return {
        'run': os.path.basename(run),
        'steps': len(seq),
        'consults': len(consult_idx),
        'consult_positions': consult_idx,
        'first_edit': first_edit,
        'last_edit': edit_idx[-1] if edit_idx else None,
        'consult_before_first_edit': bool(consult_idx and first_edit is not None and consult_idx[0] < first_edit),
        'consult_after_last_edit': bool(consult_idx and edit_idx and consult_idx[-1] > edit_idx[-1]),
        'consult_results': [results.get(seq[i]['id'], '')[:120] for i in consult_idx],
        'sequence': ' → '.join(s['label'] for s in seq),
        'result_subtype': result.get('subtype'),
        'num_turns': result.get('num_turns'),
        'duration_ms': result.get('duration_ms'),
        'usage': result.get('usage'),
        'modelUsage': result.get('modelUsage') or result.get('model_usage'),
    }

if __name__ == '__main__':
    runs = sorted(glob.glob(f"/root/verify/pr12688/realmodel/{os.environ.get('RUNS','runs')}/*-*"))
    out = [summarise(r) for r in runs if os.path.exists(os.path.join(r, 'stream.jsonl'))]
    for o in out:
        print(json.dumps({k: o[k] for k in ('run', 'steps', 'consults', 'consult_positions', 'first_edit', 'last_edit', 'consult_before_first_edit', 'consult_after_last_edit', 'result_subtype', 'duration_ms')}))
        print('   ', o['sequence'][:600])
        for r in o['consult_results']:
            print('    advice:', r.replace('\n', ' ')[:120])
    json.dump(out, open(f"/root/verify/pr12688/realmodel/summary-{os.environ.get('RUNS','runs')}.json", 'w'), indent=2)

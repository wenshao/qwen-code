#!/usr/bin/env python3
"""Summarise one rig run: checkpoint calls grouped into checks, plus the
goal-state timeline the CLI emitted."""
import json
import sys
import os
from datetime import datetime

RUNS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'runs')


def load(arm, name='ledger.jsonl'):
    p = os.path.join(RUNS, arm, name)
    if not os.path.exists(p):
        return []
    out = []
    for line in open(p):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out


def ts(row):
    return datetime.fromisoformat(row['ts'].replace('Z', '+00:00'))


def checks(arm, stdout='cli.stdout.jsonl'):
    """Group consecutive ckpt calls into checks: a check ends when a main
    request happens after it."""
    rows = load(arm)
    groups = []
    cur = []
    for r in rows:
        if r['kind'] == 'ckpt':
            cur.append(r)
        elif cur:
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return groups


def goal_states(arm, name):
    p = os.path.join(RUNS, arm, name)
    if not os.path.exists(p):
        return []
    out = []
    prev = None
    for line in open(p):
        try:
            d = json.loads(line)
        except Exception:
            continue
        ev = d.get('event') or {}
        if d.get('type') == 'stream_event' and ev.get('type') == 'goal_state':
            g = ev['goal_state']['goal']
            row = {
                'status': g.get('status'),
                'turnCount': g.get('turnCount'),
                'checkpointStalls': g.get('checkpointStalls'),
                'lastCheckpointFailure': g.get('lastCheckpointFailure'),
                'cursor': (g.get('evidenceCursor') or {}).get('recordId'),
                'hasCheckpoint': bool(g.get('evidenceCheckpoint')),
                'lastReason': g.get('lastReason'),
            }
            if row != prev:
                out.append(row)
            prev = row
    return out


def report(arm, stdout='cli.stdout.jsonl'):
    print(f'### {arm}')
    groups = checks(arm)
    for i, g in enumerate(groups, 1):
        sizes = [r['evidenceCount'] for r in g]
        prevs = [r['previousClaimsCount'] for r in g]
        outs = [r['outcome'] for r in g]
        byts = [r['payloadBytes'] for r in g]
        span = (ts(g[-1]) - ts(g[0])).total_seconds() + (
            g[-1].get('durationMs', 0) / 1000
        )
        print(
            f'  check {i}: calls={len(g)} records={sizes} prevClaims={prevs} '
            f'bytes={byts} sum={sum(byts)} outcomes={sorted(set(outs))} '
            f'span={span:.1f}s phase={g[0].get("phase","")}'
        )
    for row in goal_states(arm, stdout):
        f = (row['lastCheckpointFailure'] or '')[:70]
        print(
            f'  state: {row["status"]:<14} turn={row["turnCount"]} '
            f'stalls={row["checkpointStalls"]} cp={row["hasCheckpoint"]} '
            f'cursor={(row["cursor"] or "")[:8]} failure={f}'
        )
        if row['lastReason']:
            print(f'         reason: {row["lastReason"][:160]}')
    w = os.path.join(RUNS, arm, 'wall-seconds')
    if os.path.exists(w):
        print('  wall seconds:', open(w).read().strip())
    print()


if __name__ == '__main__':
    for arm in sys.argv[1:]:
        if arm.startswith('D'):
            report(arm, 'p1.stdout.jsonl')
            report(arm, 'p2.stdout.jsonl')
        else:
            report(arm)

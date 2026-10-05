#!/usr/bin/env python3
"""Env-gated: a 'resource-503-burst' fault (pass the first 3 resource GETs, then 503 every one),
and keep logging Store requests for 3 s after the armed javaLoad answers. Local only."""
import sys
p = sys.argv[1]
s = open(p).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:70]
    s = s.replace(old, new)
rep("""const VERIFY_PLAN: Record<string, { kind: string; action: string; times: number }> = {""",
"""let verifyLogUntil = 0;
const VERIFY_PLAN: Record<string, { kind: string; action: string; times: number; skip?: number }> = {
  'resource-503-burst': { kind: 'resource', action: '503', times: Infinity, skip: 3 },""")
rep("""    if (hits <= verifyPlan.times) verifyAction = verifyPlan.action;""",
"""    const skip = verifyPlan.skip ?? 0;
    if (hits > skip && hits - skip <= verifyPlan.times) verifyAction = verifyPlan.action;""")
rep("""  if (verifyArmed)
    verifyNote({ store: true,""", """  if (verifyArmed || Date.now() < verifyLogUntil)
    verifyNote({ afterEnd: !verifyArmed, store: true,""")
rep("""    if (verifyArmed) {
      verifyArmed = false;""", """    if (verifyArmed) {
      verifyArmed = false;
      verifyLogUntil = Date.now() + 3000;""")
open(p, 'w').write(s)
print('patched burst')

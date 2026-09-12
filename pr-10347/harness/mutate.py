#!/usr/bin/env python3
"""Apply one named mutant to the PR worktree. Usage: mutate.py <M1..M5>"""
import sys, pathlib
T = pathlib.Path('/root/git/wt10347')
CLS = T/'packages/core/src/utils/retryErrorClassification.ts'
CHAT = T/'packages/core/src/core/llm-chat.ts'

MUT = {
 'M1': (CLS,
   """      if (
        providerCode === undefined &&
        providerMessage === undefined &&
        hasNetworkFailureCause(error)
      ) {""",
   """      if (
        hasNetworkFailureCause(error)
      ) {"""),
 'M2': (CLS,
   "const NETWORK_FAILURE_MESSAGE_RE = /network error for request /i;",
   "const NETWORK_FAILURE_MESSAGE_RE = /EOF/i;"),
 'M3': (CLS,
   """        return {
          kind: 'transport',
          diagnosis: 'retryable',
          reason: 'network-error',
          ...common,
        };""",
   """        return {
          kind: 'http',
          diagnosis: 'retryable',
          reason: 'network-error',
          ...common,
        };"""),
 'M4': (CLS,
   """        return {
          kind: 'transport',
          diagnosis: 'retryable',
          reason: 'network-error',
          ...common,
        };""",
   """        return {
          kind: 'transport',
          diagnosis: 'retryable',
          reason: 'network-error',
          transportCode: 'ECONNRESET',
          ...common,
        };"""),
 'M6': (CLS,
   """      if (
        providerCode === undefined &&
        providerMessage === undefined &&
        hasNetworkFailureCause(error)
      ) {""",
   """      if (
        providerMessage === undefined &&
        hasNetworkFailureCause(error)
      ) {"""),
 'M5': (CHAT,
   """        if (status === 400) {""",
   """        if (status === 400) {
          return true;"""),
}

name = sys.argv[1]
path, old, new = MUT[name]
s = path.read_text()
assert s.count(old) == 1, f'{name}: anchor count {s.count(old)}'
path.write_text(s.replace(old, new))
print(f'{name} applied to {path.name}')

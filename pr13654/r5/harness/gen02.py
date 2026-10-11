# Card 2 generator: fixed columns, every body row carries a 3-char colour prefix plus the same indent.
W1, W2 = 40, 46
def row(p, a, b='', c=''):
    return f"{p} {'   ' + a:<{W1}}{b:<{W2}}{c}".rstrip()
L = ["PR #13654 round 5: the bot's round-8 findings, probed at fe0ae13e",
     "H2 and MySQL 8.4.7 agree on every probe line. Probes use the PR's own fixture (claimTimeout 2 s, so the read-loop heartbeat is due after ~667 ms)",
     "## R8-1 entrance A: a fence lands while the verifier reads an object-backed segment",
     row('==', 'fence during the read', 'read stalled 900 ms (heartbeat due)', 'no stall (heartbeat not due)'),
     row('++', 'none', 'SUCCEEDED, VERIFIED', '-'),
     row('--', 'recovery blocked (blockRecovery)', 'FAILED 400, QUARANTINED, bytes intact', 'FAILED 400, CANDIDATE, bytes intact'),
     row('--', 'writer lease lapsed', 'FAILED 400, QUARANTINED, bytes intact', 'FAILED 400, CANDIDATE, bytes intact'),
     row('--', 'takeover', 'FAILED 400, QUARANTINED, bytes intact', '-'),
     row('++', 'grant expired only', 'PENDING (deferred, the R5-1 path)', '-'),
     "## Same fence on the packaged stack: Session recovery blocked while the segment readback is held",
     row('--', 'async, 12 s hold (heartbeat due)', 'FAILED 400, QUARANTINED', 'OSS bytes match the catalog sha256'),
     row('==', 'async, 4 s hold', 'FAILED 400, CANDIDATE', 'OSS bytes match the catalog sha256'),
     row('==', 'async off (same jar), ~17 s hold', 'sync request refused, CANDIDATE', 'OSS bytes match the catalog sha256'),
     row('++', 'control: async, 12 s hold, no change', '14 ops SUCCEEDED, 13 objects VERIFIED'),
     "## R8-1 entrance B: recovery blocked before the claim",
     row('==', 'segment', 'FAILED 400 (never read)'),
     row('==', 'object terminal', 'FAILED 400; object deleted; producer_used_bytes 70194 -> 0'),
     row('==', 'leave the block via the product', 'blockRecovery(READY) -> 400; blockRecovery(BLOCKED_RESOURCE) -> 409'),
     row('==', 'READY written by direct SQL', 'scan skips the row; stays FAILED; the same request again -> FAILED'),
     row('==', 'sync publish while blocked', 'refused at once: "Original Session owner is fenced"; nothing stored'),
     "## R6-1 (fix-induced): the orphaned terminal object",
     row('!!', 'finish: read-back + DELETE denied', 'FAILED 403; object stays in the bucket; producer_used_bytes 0'),
     row('==', 'recoverOperation(finish)', '409 managed_tool_publication_failed'),
     row('!!', 'finish-2, different bytes', 'FAILED 400 (reads the stale object); its release deletes that object'),
     row('++', 'finish-3, different bytes', 'SUCCEEDED, 70002-char result'),
]
open(__file__.replace('gen02.py', '02-bot-round-8.txt'), 'w').write('\n'.join(L) + '\n')

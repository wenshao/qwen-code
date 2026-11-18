# pr17663-r3 — SSE admission row pr-ui-verify evidence (head 23675ccc128e)

Re-run of the four row states at head 23675ccc128e (round-3 fixes + PR1 round-3 merge):

- paired.png — head bundle daemon (cap 204) + 6 held REST streams: 6 / 204
- cap-only.png — base-commit b2bdf590191a daemon (cap, no occupancy): exact 204
- unlimited.png — head bundle --max-sse-connections 0: 0 / unlimited
- no-row.png — global qwen 0.28.0 (pre-#17502): row absent

Zero page errors; driver ui-row-states.mjs; G5 API suite 13/13 at same head.

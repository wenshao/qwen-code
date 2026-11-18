# pr17663-r2 — SSE admission row pr-ui-verify evidence

Bound to head 1e86fc1d386a (PR #17663). Four row states against real daemons:

- paired.png — bundle daemon (cap 204) + 6 held REST streams: row reads 6 / 204
- cap-only.png — base-commit b2bdf590191a daemon (#17502, no streamOccupancy): row reads 204
- unlimited.png — bundle daemon --max-sse-connections 0: row reads 0 / unlimited
- no-row.png — global qwen 0.28.0 (pre-#17502): row absent

Driver: .qwen/e2e-tests/sse-unified-admission-occupancy/ui-row-states.mjs (DOM assertions + screenshots, zero page errors).

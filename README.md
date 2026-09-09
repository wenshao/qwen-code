# PR #11435 — local verification evidence

Artefacts produced while verifying `fix(deps): Bump sharp to 0.35.4 to resolve
high-severity libheif CVE` at head `c1711d20f84734d1f6a2cce395689d755bf1072b`
against merge-base `88b0afaeb1`.

Host: Linux 6.12.63 x86_64, Node 22.22.2, npm 10.9.7, pnpm 11.24.0 (corepack).
Both trees are real `npm ci --ignore-scripts --no-audit` installs of their own
committed lockfile; no mocks, no stubbed registry.

## Figures

| file | what it shows |
| --- | --- |
| `fig1.png` | `npm audit --omit=dev --audit-level=high` A/B — base exits 1 on `sharp <0.35.4`, head exits 0 |
| `fig2.png` | `sharp.versions` read from each tree's installed native binary, plus the libheif advisory chain |
| `fig3.png` | `renderImageOverview()` / `renderNormalizedImageCrop()` A/B — 9/9 artefacts byte-identical, with a negative control |
| `fig4.png` | pnpm `--frozen-lockfile` A/B, the real `scripts/setup-worktree.js` bootstrap, and the vendored mobile-mcp lockfile residual |
| `fig5.png` | reachability of the libheif path from the repo's own entry points, and what the published tarball pins |

## Logs (verbatim stdout)

`log-audit-base.txt`, `log-audit-head.txt`, `log-audit-mobile-mcp-vendored.txt`,
`log-sharp-versions-base.txt`, `log-sharp-versions-head.txt`,
`log-pnpm-frozen-stale.txt`, `log-pnpm-frozen-head.txt`,
`log-setup-worktree-head.txt`, `log-vitest-core-base.txt`,
`log-vitest-core-head.txt`, `log-heif-reachability.txt`.

## Harnesses

- `harness-ab-render.mts` — drives `packages/core/src/utils/image-view.ts` with
  whichever sharp the worktree installed; `MUTATE=1` paints a 24×24 patch into
  the source as a negative control.
- `harness-heif-reach.mts` — builds a HEIF container with sharp itself, then
  feeds it to the real `renderImageOverview()` to show libheif parses it before
  the PNG/JPEG/WebP allowlist rejects it.
- `harness-lockdiff.js` — enumerates every resolved `path -> version` in two npm
  lockfiles and reports changed / added / removed entries.

## Raw A/B render reports

`render-ab-base.json`, `render-ab-head.json`, `render-ab-negative-control.json`.

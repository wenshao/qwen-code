# PR 18105 verification harness (round 1)

Head: `00b0c34f448d3167795dec7bd9df62d983fa59c2` (parent/base:
`42a71daa914cdfa1c5b48ebb2862404f7670de5f`). The PR touches only two design
docs and one stylesheet test; `WebShellSidebar.module.css` is byte-identical
at base and head, so the A/B varies only the test file.

## Rebuild the inputs

From a qwen-code checkout:

```bash
D=$PWD/tmp/pr18105-verify
mkdir -p "$D/pkg"
git show 00b0c34f448d3167795dec7bd9df62d983fa59c2:packages/web-shell/client/components/sidebar/WebShellSidebar.css.test.ts > "$D/pkg/head.css.test.ts"
git show 42a71daa914cdfa1c5b48ebb2862404f7670de5f:packages/web-shell/client/components/sidebar/WebShellSidebar.css.test.ts > "$D/pkg/base.css.test.ts"
git show 00b0c34f448d3167795dec7bd9df62d983fa59c2:packages/web-shell/client/components/sidebar/WebShellSidebar.module.css > "$D/pkg/WebShellSidebar.module.css"
cp "$D/pkg/WebShellSidebar.module.css" "$D/pkg/css.orig"
printf "%s\n" "import { defineConfig } from 'vitest/config';" "export default defineConfig({ test: { environment: 'node', include: ['*.test.ts'] } });" > "$D/pkg/vitest.config.mts"
git show 42a71daa914cdfa1c5b48ebb2862404f7670de5f:docs/design/web-shell-sidebar-background-work-indicator.md > "$D/base-en.md"
git show 00b0c34f448d3167795dec7bd9df62d983fa59c2:docs/design/web-shell-sidebar-background-work-indicator.md > "$D/head-en.md"
git show 42a71daa914cdfa1c5b48ebb2862404f7670de5f:docs/design/web-shell-sidebar-background-work-indicator.zh-CN.md > "$D/base-zh.md"
git show 00b0c34f448d3167795dec7bd9df62d983fa59c2:docs/design/web-shell-sidebar-background-work-indicator.zh-CN.md > "$D/head-zh.md"
```

Copy `mutations.mjs`, `run-matrix.mjs`, `docs-check.mjs`, `browser-oracle.mjs`
and `assertions.mjs` next to `$D/pkg/`, then adjust the two absolute path
constants for your checkout: `VITEST_BIN` in `run-matrix.mjs` (was
`/root/git/qwen-code-verify/node_modules/.bin/vitest`) and `REPO`/`HEAD` in
`docs-check.mjs`.

## Run

```bash
node run-matrix.mjs        # 10 CSS mutants x {base,head} test file -> matrix.json
node docs-check.mjs head   # 22 claim/structure/code rows on the head docs
node docs-check.mjs base   # same rows on the base docs (12 must go red)
node browser-oracle.mjs    # Chromium computed colors -> browser-oracle.json
node assertions.mjs        # encodes expectations -> assertions.json
```

`run-matrix.mjs` restores `css.orig` after every cell and re-hashes it; the
restored sha256 is `c0c770fecbee8b7a0a5368faffae80dc21a62a49a01bbaf5deec8f9d75f2f82a`.
Raw outputs archived in `../evidence/`.

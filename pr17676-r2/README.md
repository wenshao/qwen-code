# PR #17676 — round 2 verification (review fixes)

Head verified: `7840cc733582` (round 1 was `d6447396ed0b`).

## The screenshots did not change

Round 2 fixed naming, guards and the details status — none of which is visible
in a still frame. Re-capturing the same two rows with the same A/B method
produced **byte-identical PNGs** to round 1 (sha256 compared for all six files),
and the same pixel diffs:

| Pair | Size | Changed pixels | Diff bounding box |
| --- | --- | --- | --- |
| `bgonly-row` | 550×68 | 216 (0.58%) | x 506–530, y 22–46 |
| `turn-row` | 550×68 | 398 (1.06%) | x 260–530, y 22–46 |
| `context` | 582×220 | 614 (0.48%) | x 276–546, y 82–178 |

So the visual evidence stays in [`pr17676-r1/`](../pr17676-r1/README.md); this
round adds the facts a screenshot cannot carry.

## What round 2 verified in the real browser

Same setup as round 1: one dev server from the PR worktree proxied to a live
daemon, two real sessions (`#17676 | …` with a turn in flight plus a background
shell; `🧵 bg-status-probe` with its turn finished and a background shell
running). No response interception.

| Check | Round 1 head | Round 2 head |
| --- | --- | --- |
| Background-only row, accessible name | marker and dot both named `Background tasks running` | row AX tree: `button "Background tasks running 🧵 bg-status-probe Pin More actions"` containing a single `img "Background tasks running"` |
| Background-only marker attributes | `aria-label` and `title` both set | `aria-label: null`, `title: null` |
| Turn + background marker | `aria-label="Running"`, `title="Running · Background tasks running"`, amber | unchanged |
| Archive on a background-only row | enabled | menu item `aria-disabled="true"`, `data-disabled`, title "A running session cannot be archived; archiving would stop its work" |
| Details popover, turn + background | `Running · Background tasks running` | unchanged |
| Background-only row hover | marker opacity 0, actions opacity 1 | unchanged |
| Page errors | none | none |

The AX tree was read from Chromium's real accessibility tree, not inferred from
attributes.

### The faded marker does not swallow clicks

A first attempt to click the row's "More actions" button timed out with
`<span class="sessionLoading sessionLoadingBackground"> intercepts pointer
events`. That is a Playwright actionability artifact: it hit-tests before
moving the pointer, so the action overlay is still `pointer-events: none` at
that moment. A real user's pointer crosses the row first, which reveals the
overlay. Hovering the row and then hit-testing the button's centre returns the
button's own icon (`hitIsButton: true`), and the click then opens the menu —
which is how the disabled Archive item above was read.

## Method note

The A/B swap replaces the three production files with their `origin/main`
blobs, reloads, captures, then restores. Round 2 ran this on a **committed**
tree so the restore returns the PR's own code. Pixel comparisons disable CSS
animations and park the pointer outside the sidebar.

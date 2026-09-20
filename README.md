# PR #11963 — local verification figures

Figures produced while verifying
[QwenLM/qwen-code#11963](https://github.com/QwenLM/qwen-code/pull/11963)
("fix(ci): synthesize bold in the verify-capture renderer") at head
`3140b0c5bb56b6e35fdd4353ac66ae4b02523a8e`, on 2026-09-20.

| file | what it shows |
| --- | --- |
| `pr11963-fig1-bold-ab.png` | Plain vs bold renders from both helper versions, on a font-less Linux host and on a host with DejaVu. On the font-less host, main's bold PNG is byte-identical to plain (277 B = 277 B); the PR's bold render carries 78.8% more ink. |
| `pr11963-fig2-suite-matrix.png` | `scripts/tests/verify-capture.test.js` across helper × tests × host font state — including the base-arm gate failure reproduced on a font-less host, and the darwin arm. |
| `pr11963-fig3-mutation-matrix.png` | Six mutation probes against the PR's own suite on three hosts. Five are killed; M2 (inverting the `cell.bold` ternary) survives everywhere. |
| `pr11963-fig4-m2-inversion.png` | What M2 actually produces: plain cells render bold and bold cells render plain, with the suite still reporting 27 passed (27). |
| `pr11963-fig5-nofont-legibility.png` | A real A/B evidence card rendered on a font-less host, before and after. The stroke does thicken the bold cells, but every glyph is a `.notdef` box either way. |

Environment: Debian 12 container (Node 22) and darwin arm64 (Node 24), both on
sharp 0.35.4 / libvips 8.18.6 / librsvg 2.62.91. Figures 2 and 3 were rendered
with the PR's own `scripts/verify-capture.mjs`.

# PR 15758 verification assets

Local maintainer round, 2026-10-28 (Beijing time).

- Head: `dce317f68584c45c0743355301af53ff7b2dfbdc`
- Base: `9acb3a5a1d68aad0705ad4d420830affb59cc95a`
- Machine: macOS 26.6.2, Apple M1 Max, Node 22.23.4
- Build: full `npm run build` in each detached worktree, EXIT=0

| File | Content |
| :-- | :-- |
| `01-head-headless-context.png` | Head, `qwen -p '/context'` (headless), window 1000.0k |
| `02-base-headless-context.png` | Base, same command and model, window 262.1k |
| `03-head-tui-context.png` | Head, interactive TUI after a real model turn, thresholds 980/830/850/977k |
| `04-base-tui-context.png` | Base, same flow, thresholds 242.1/202.8/222.8/239.1k |
| `05-gates-and-mutations.png` | Focused test A/B, 5-suite gate, 5/5 killed mutants, static checks |
| `06-corpus-no-collateral.png` | 48-id corpus comparison; only series ids move, output paths identical |

The model endpoint was the repository's own `integration-tests/fake-openai-server.ts`,
serving an OpenAI-compatible API at localhost. No invite-model credentials were used.
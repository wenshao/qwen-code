# PR #12252: mobile composer screenshots

Screenshots for https://github.com/QwenLM/qwen-code/pull/12252.

- before-quick-actions.png: global qwen 0.23.3 baseline, showing the legacy action grid and keyboard keys.
- after-composer.png: redesigned mobile toolbar after editing a draft and inserting a command.
- after-add-drawer.png: mobile Add drawer with explicit photo/camera/file actions and secondary commands.
- after-expanded-editor.png: expanded draft editor with keyboard dismissal and Done.

Captured during implementation verification on 2026-09-19 using Chromium touch emulation at a 390 x 844 CSS-pixel viewport. PNG files retain the original device-scale resolution. The before image uses the real global CLI; after images use deterministic mock-daemon UI verification with sample draft text. These are original, unedited screenshots. This branch is an asset host and is not intended to merge into main.

## Restored mobile history navigation

Follow-up screenshots for PR #12252, implementation commit `462b9836f2d343eb4eca390c4fb0a4ee77166054`. Captured from built Web Shell assets using deterministic mock daemon routes and Chromium touch emulation. These are original browser screenshots with sample input, without pixel editing or compositing.

- `pr-12252/after-composer.png`: updated full 390×844 viewport with history arrows and the restored draft.
- `pr-12252/history-previous-390.png`: native composer-element capture after recalling the newest saved input at 390px.
- `pr-12252/history-draft-390.png`: native composer-element capture after returning to the multiline draft at 390px.
- `pr-12252/history-previous-240.png`: native composer-element capture at 240px, showing the editing controls wrapping without overflow.

The earlier before, Add drawer, and expanded-editor screenshots are retained.

## Review follow-up

Original browser screenshots for PR #12252 at implementation `71df8f08d185ea647b8f0021ca56560f6ad6ed22`, captured from built Web Shell assets with deterministic mock daemon routes and Chromium touch emulation (390×844). No pixel editing or compositing.

- `pr-12252/review-expanded-paste.png`: native expanded-dialog screenshot while a long paste is already accepted as one attachment; the dialog stays open.
- `pr-12252/review-commands.png`: native command-drawer screenshot showing a slash-prefixed query and shared command argument hints.

Earlier before/after and history-navigation screenshots are preserved.

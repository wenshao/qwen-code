# PR #12491 — maintainer verification evidence

Local two-arm verification of `fix(review): Move trusted state outside workspaces`.

- head `6769a9cbf537b988a1efcaf49d0a725a5e371371`
- merge base `99bf4ce86b32010644538046ea37b0ef0ad23921`
- Node 22.22.2, Linux 6.12.63 x86_64, bubblewrap 0.12.0, ext4 `casefold` loop mount

`REPORT.md` / `REPORT.zh-CN.md` are the published comment text.
`harness/` holds every script used; `data/` holds the raw captured output;
`suggested-tests.diff` is the +28-line test patch that closes the two surviving mutants.

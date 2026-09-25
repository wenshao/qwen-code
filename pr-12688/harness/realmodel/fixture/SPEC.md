# duration.js contract

- `parseDuration(str)` accepts one or more `<integer><unit>` groups, units `d`, `h`, `m`, `s`, each unit at most once and in that order (largest first). Anything else — empty input, stray characters, a repeated unit, units out of order — throws `RangeError`.
- `formatDuration(ms)` returns the canonical form; zero is `0s`.
- Do not edit `duration.test.js`.

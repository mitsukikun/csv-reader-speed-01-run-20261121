# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/mitsukikun/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/mitsukikun/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, for the make.fun bounty
**"Read broken CSV files faster, 21 November 2026"**
(`csv-reader-speed-01-run-20261121`, $100 in USDC, 1st–10th place $10 each).
`solve.js` answers every case exactly as csv-reader 1.0.0 does — same
`{columns, rows, errors}`, including its broken-row policy (stray CRs,
quote junk, unterminated quotes, short/long rows, blank lines, BOM) — but
reads the text in slices instead of one character at a time: a clean line
goes through one slice plus `String.split(',')`, and a line with quotes or
stray CRs is cut at the next delimiter found by `indexOf`, with CR/LF
normalisation applied to whole quoted segments at once.

Measured locally on the practice set (6 cases, ~10.2 MB of CSV): 6/6 answers
identical to the reference, at ~1.9x the speed of the house baseline
(csv-reader 1.0.0). The final ranking is timed on the scored set drawn
after entries close, so this is a local measurement, not the graded result.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

`main.ts` (Node 22) reads every case from `$MAKEFUN_INPUT_DIR/cases.json`,
answers each one alone with `run()` from `solve.js`, and writes
`$MAKEFUN_OUTPUT_DIR/answers.json`. No dependencies, no network, no
WebAssembly — dependency-free ES module, deterministic output.

## Files

- `solve.js` — the fast reader: `run(input)` returns csv-reader 1.0.0's
  answer for one case's `{text, header}`.
- `main.ts` — the driver the harness runs (`node /bot/main.ts`).
- `LICENSE` — MIT.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dr78ckwq&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>

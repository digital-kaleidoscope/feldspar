# JS worker spike: benchmark harness and results

Compares the stock Pyodide worker (`public/py_worker.js` + `port` wheel) with the
JavaScript worker (`src/js_worker/`, built with `VITE_WORKER=js`) running the same demo
flow. Both builds pass the same scenario and produce identical donations.

- `bench-timed.cjs`: `tests/memory-benchmark.cjs` plus per-phase wall-clock timings.
- `bench-items.cjs`: the same, accepting the TikTok-shaped fixture below (one JSON file,
  so the delete/undo step, which needs several rows, is skipped).
- `gen_items_zip.py`: one large `user_data.json` with N small watch-history-like records.
- `bench.sh <dist> <fixture.zip> [cap]`: runs a benchmark in the Playwright 1.63 image,
  memory-capped (default 3g) so an OOM kills the container rather than the host.

```sh
pnpm run build:py                        # python dist (needs the port wheel in public/)
pnpm --filter @eyra/feldspar build
(cd packages/data-collector && npx vite build && cp -r dist /tmp/dist-py)
(cd packages/data-collector && VITE_WORKER=js npx vite build && cp -r dist /tmp/dist-js)
python3 tests/generate_memory_zip.py /tmp/fx/mem_64.zip --mib 64
python3 tests/js-worker-spike/gen_items_zip.py /tmp/fx/items_1m.zip --items 1000000
tests/js-worker-spike/bench.sh /tmp/dist-js /tmp/fx/mem_64.zip
BENCH=bench-items.cjs tests/js-worker-spike/bench.sh /tmp/dist-js /tmp/fx/items_1m.zip
```

## Results (2026-10-05, 2-vCPU VPS, Chromium under Xvfb, one run each)

Peak = summed RSS of the Chromium process tree, as upstream's benchmark measures it.

| Fixture | Worker | Startup | Upload → review | End to end | Peak RSS |
|---|---|---|---|---|---|
| 64 MiB text, 256 rows | Python | 5.1 s | 5.3 s | 16.0 s | 2.72 GiB |
| 64 MiB text, 256 rows | JS | 0.3 s | 5.2 s | 9.8 s | 2.60 GiB |
| 1M records (97 MB JSON) | Python | 5.0 s | 6.5 s | 11.5 s | 1.75 GiB |
| 1M records (97 MB JSON) | JS | 0.3 s | 2.0 s | 2.3 s | 1.45 GiB |
| 3M records (291 MB JSON) | Python | 4.5 s | 19.4 s | 24.0 s | 2.64 GiB |
| 3M records (291 MB JSON) | JS | 0.3 s | 4.5 s | 4.9 s | 1.99 GiB |

The demo sleeps 10 ms per zip entry in both versions (2.6 s of the 64 MiB rows' review time).
The 64 MiB fixture's peak is dominated by the UI holding and rendering a 64 MiB table, which
the worker does not affect. The JS script still `JSON.parse`s each file whole; a streaming
parser is the next lever for memory on large single-file exports.

## TikTok flow on a real export (2026-10-05)

`VITE_WORKER=tiktok`, `bench-tiktok.cjs`, 3.5 GB cap. A real ~300 MB `user_data_tiktok.json`
(about two million watch-history rows; neither the file nor anything derived from its contents is
in the repo). The scripted participant
inspects watch history, pages, deletes two rows, searches all rows, excludes logins, donates.

| Phase | Time | Peak RSS |
|---|---|---|
| Startup | 0.3 s | 0.99 GiB |
| Upload → consent page (read, parse, extract) | 8.4 s | 2.10 GiB |
| Inspect, delete, search (0.8 s), exclude | 1.1 s | 2.03 GiB |
| Donate (192 MiB JSON) | 1.7 s | 3.32 GiB |

The donation step is the peak: the single donation string is built in the worker, then
copied to the page and again to the host.

### With streaming parse for files over 50 MB

Same run, after streaming large exports (only the paths extractors declare are kept). Output is
identical to the whole-file parse (all categories compared row by row, JSON and zip input).

| | Whole parse | Streamed |
|---|---|---|
| Node, read + extract: time / peak RSS | 3.9 s / 1,649 MiB | 7.7 s / 858 MiB |
| Browser, upload → consent page: time / peak RSS | 8.4 s / 2.10 GiB | 12.5 s / 1.51 GiB |
| Browser, donate peak RSS (varies run to run with GC) | 3.32 GiB | 2.29–2.97 GiB |

The progress bar now moves through the whole read (98 steps on this file): reads give the event
loop a turn every 50 ms so progress pages can be shown while reading continues.

### Performance follow-ups (2026-10-05)

- **Done: parse mode by device memory.** Above 50 MB, stream only if a whole parse (about 4x the
  file) would exceed a quarter of `navigator.deviceMemory`, or if the browser doesn't report it
  (Firefox, Safari). E.g. 300 MB: whole on 8 GiB, streamed on 4 GiB or unknown.
- **Done: rows built while streaming.** List-shaped categories give a per-item `row()`, so a
  streamed parse keeps rows, never items. Identical output. Node, ~300 MB export, streamed:
  858 → ~665 MiB peak, but 7.7 → 8.8 s (the parser calls back once per item). Kept because the
  streamed path is only taken when memory is tight.
- **Open: measure on real devices** (a mid-range laptop and phone, Chrome and Safari) before
  optimising further. All numbers so far are from a 2-vCPU VPS running Chromium under Xvfb.

### Donation sent in pieces (2026-10-05)

`VITE_WORKER=tiktok VITE_DEMO_HOST=1`, URL `?latency=30&failRate=0.05`: the demo host plays the
server, failing 5% of uploads on purpose. Same real export and scripted participant.

- Complete and exactly once: every category's received rows and pieces match the manifest
  (watch history: about two million rows in 51 pieces); 4 injected failures were retried, no duplicates.
- Donating adds about 0.3 GiB over the consent page (was about 1.2 GiB as one string). Pieces are
  at most 3.8 MB. In Node, live heap grows 12 MiB during the whole upload.
- The upload progress bar moves through 52 steps; the thank-you page appears only once the
  manifest is confirmed.
- Node simulation also covers: no failures, 5% failures, and every upload failing with the
  participant declining to retry (stops cleanly, no manifest).

This run parsed the file whole: Chromium in the container reports 8 GiB of device memory.

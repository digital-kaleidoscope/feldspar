#!/bin/bash
# Usage: bench.sh <dist-dir> <fixture.zip> [memory-cap]
# Runs upstream's memory-benchmark.cjs (plus phase timings, bench-timed.cjs) against a
# static build, inside a memory-capped container so an OOM kills the container, not the VPS.
set -euo pipefail
S=$(dirname "$(realpath "$0")")
DIST=$(realpath "$1"); FIXTURE=$(realpath "$2"); CAP=${3:-3g}
docker run --rm --init --memory="$CAP" --memory-swap="$CAP" --ipc=host \
  -v ~/work/feldspar-js:/repo:ro -v "$DIST":/site:ro -v "$(dirname "$FIXTURE")":/fixtures:ro \
  -v "$S":/bench:ro -e NODE_PATH=/repo/node_modules -w /repo \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -c "python3 -m http.server 4173 -d /site >/dev/null 2>&1 & sleep 1;
           xvfb-run -a node /bench/${BENCH:-bench-timed.cjs} http://localhost:4173/ /fixtures/$(basename "$FIXTURE")"

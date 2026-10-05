#!/usr/bin/env python3
"""TikTok-shaped fixture for the unmodified demo script: one large JSON file whose
"items" list holds many small watch-history-like records. Stresses JSON parsing and
per-object overhead (the TikTok failure mode), not UI rendering of a big table."""

import argparse
import json
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("output")
parser.add_argument("--items", type=int, default=1_000_000)
args = parser.parse_args()

metadata = {"format": "feldspar-demo-items-1", "items": args.items}
with zipfile.ZipFile(args.output, "x", zipfile.ZIP_DEFLATED) as archive:
    archive.comment = json.dumps(metadata).encode("ascii")
    with archive.open("user_data.json", "w", force_zip64=True) as f:
        f.write(b'{"user":{"name":"synthetic","id":7},"items":[')
        for i in range(args.items):
            item = {"Date": f"2024-{1 + i % 12:02d}-{1 + i % 28:02d} {i % 24:02d}:{i % 60:02d}:{i % 59:02d}",
                    "Link": f"https://www.tiktokv.com/share/video/{7000000000000000000 + i * 7919}/"}
            f.write((b"," if i else b"") + json.dumps(item, separators=(",", ":")).encode())
        f.write(b"]}")
    size = archive.getinfo("user_data.json").file_size
print(json.dumps({**metadata, "json_bytes": size}))

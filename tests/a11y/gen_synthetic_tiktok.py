#!/usr/bin/env python3
"""A small, entirely synthetic TikTok-shaped export, for screenshots and accessibility checks."""
import json, random, sys
random.seed(7)
def date(i): return f"2025-{1 + i % 12:02d}-{1 + i % 28:02d} {i % 24:02d}:{i % 60:02d}:{i % 59:02d}"
doc = {
  "Your Activity": {
    "Watch History": {"VideoList": [{"Date": date(i), "Link": f"https://www.tiktokv.com/share/video/{7300000000000000000 + i * 104729}/"} for i in range(1200)]},
    "Share History": {"ShareHistoryList": [{"Date": date(i * 7), "SharedContent": "video", "Link": f"https://www.tiktokv.com/share/video/{7310000000000000000 + i}/", "Method": random.choice(["Copy link", "Instagram", "WhatsApp"])} for i in range(40)]},
    "Login History": {"LoginHistoryList": [{"Date": date(i * 13), "IP": "203.0.113.7", "DeviceModel": "Pixel 7", "DeviceSystem": "Android", "NetworkType": random.choice(["Wi-Fi", "4G"]), "Carrier": "Example"} for i in range(60)]},
    "Activity Summary": {"ActivitySummaryMap": {"note": "x", "videosCommentedOnSinceAccountRegistration": 12, "videosSharedSinceAccountRegistration": 40, "videosWatchedToTheEndSinceAccountRegistration": 900}},
  },
  "Post": {"Posts": {"VideoList": [{"Date": date(i * 31), "Likes": str(i * 3), "Link": "https://example.invalid/"} for i in range(9)]}},
  "Profile And Settings": {"Profile Info": {"ProfileMap": {"userName": "synthetic_user_42"}}},
}
json.dump(doc, open(sys.argv[1], "w"))

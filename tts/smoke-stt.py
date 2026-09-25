#!/usr/bin/env python3
"""Round trip: synthesize a sentence with the sidecar, transcribe it back, and check the words survived."""
import json
import sys
import time
import urllib.parse
import urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7333"
sentence = "The quick brown fox jumps over the lazy dog near the river bank."
with urllib.request.urlopen(f"{base}/tts?" + urllib.parse.urlencode({"text": sentence, "voice": "am_michael"})) as r:
    wav = r.read()
t0 = time.time()
req = urllib.request.Request(f"{base}/stt", data=wav, headers={"Content-Type": "audio/wav"}, method="POST")
with urllib.request.urlopen(req) as r:
    text = json.loads(r.read())["text"]
elapsed = time.time() - t0
words = {w.strip(".,").lower() for w in sentence.split()}
got = {w.strip(".,").lower() for w in text.split()}
overlap = len(words & got) / len(words)
assert overlap >= 0.8, f"only {overlap:.0%} of words came back: {text!r}"
print(f"ok: {overlap:.0%} match in {elapsed:.2f}s -> {text!r}")

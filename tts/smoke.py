#!/usr/bin/env python3
"""Synthesize one sentence through a running sidecar and check the result is real audio."""
import io
import sys
import time
import urllib.parse
import urllib.request

import soundfile as sf

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7333"
voice = sys.argv[2] if len(sys.argv) > 2 else "am_michael"
text = "Good evening. All systems are functioning within normal parameters."
t0 = time.time()
with urllib.request.urlopen(f"{base}/tts?" + urllib.parse.urlencode({"text": text, "voice": voice})) as r:
    assert r.headers["Content-Type"] == "audio/wav", r.headers["Content-Type"]
    wav = r.read()
elapsed = time.time() - t0
samples, rate = sf.read(io.BytesIO(wav))
seconds = len(samples) / rate
assert seconds > 1.0, f"suspiciously short audio: {seconds:.2f}s"
print(f"ok: {seconds:.1f}s of audio at {rate} Hz in {elapsed:.2f}s ({seconds/elapsed:.1f}x realtime), {len(wav)} bytes, voice {voice}")

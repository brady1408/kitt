#!/usr/bin/env python3
"""KITT text-to-speech sidecar: Kokoro via ONNX Runtime, loopback HTTP, returns WAV.

  GET /healthz            -> "ok"
  GET /voices             -> JSON list of voice ids
  GET /tts?text=..&voice=..&speed=..  -> audio/wav
  POST /tts  {"text","voice","speed"}  -> audio/wav
"""
import io
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("KITT_TTS_MODEL", os.path.join(HERE, "models", "kokoro-v1.0.onnx"))
VOICES = os.environ.get("KITT_TTS_VOICES", os.path.join(HERE, "models", "voices-v1.0.bin"))
HOST = os.environ.get("KITT_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("KITT_TTS_PORT", "7333"))
DEFAULT_VOICE = os.environ.get("KITT_TTS_VOICE", "am_michael")
MAX_CHARS = 4000

kokoro = Kokoro(MODEL, VOICES)
VOICE_IDS = sorted(kokoro.get_voices())
# English voices first, American male first among those: the KITT register.
def _rank(v: str) -> tuple:
    return (0 if v.startswith("am_") else 1 if v.startswith("a") else 2 if v.startswith("b") else 3, v)
VOICE_IDS.sort(key=_rank)


def synthesize(text: str, voice: str, speed: float) -> bytes:
    lang = "en-gb" if voice.startswith("b") else "en-us"
    samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "kitt-tts/0.1"

    def _send(self, status: int, body: bytes, ctype: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _speak(self, text: str, voice: str, speed: float) -> None:
        text = (text or "").strip()
        if not text:
            return self._send(400, b"text is required", "text/plain")
        if len(text) > MAX_CHARS:
            return self._send(413, b"text too long", "text/plain")
        if voice not in VOICE_IDS:
            return self._send(400, f"unknown voice {voice}".encode(), "text/plain")
        speed = min(1.5, max(0.6, speed))
        try:
            wav = synthesize(text, voice, speed)
        except Exception as e:  # noqa: BLE001
            print(f"synthesis failed: {e}", file=sys.stderr)
            return self._send(500, b"synthesis failed", "text/plain")
        self._send(200, wav, "audio/wav")

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path == "/healthz":
            return self._send(200, b"ok", "text/plain")
        if url.path == "/voices":
            body = json.dumps({"voices": VOICE_IDS, "default": DEFAULT_VOICE if DEFAULT_VOICE in VOICE_IDS else VOICE_IDS[0]}).encode()
            return self._send(200, body, "application/json")
        if url.path == "/tts":
            q = parse_qs(url.query)
            return self._speak(q.get("text", [""])[0], q.get("voice", [DEFAULT_VOICE])[0], float(q.get("speed", ["1.0"])[0]))
        self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/tts":
            return self._send(404, b"not found", "text/plain")
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, b"invalid json", "text/plain")
        self._speak(str(body.get("text", "")), str(body.get("voice", DEFAULT_VOICE)), float(body.get("speed", 1.0)))

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        if self.path.startswith("/healthz"):
            return
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    print(f"kitt-tts listening on http://{HOST}:{PORT} ({len(VOICE_IDS)} voices, default {DEFAULT_VOICE})", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

import { parseVoiceChoice, pickVoice } from "./voice";
import { bandLevels } from "./spectrum";
/**
 * Global audio meter. Any audio the app outputs (speech, <audio>/<video> elements)
 * or captures (mic) feeds a level (0..1) that the voice box renders.
 */
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let buf: Uint8Array<ArrayBuffer> | null = null;
let freq: Uint8Array<ArrayBuffer> | null = null;
let speaking = false; // browser speech synthesis in progress (cannot be tapped, so the envelope is faked)
const hooked = new WeakSet<HTMLMediaElement>();

function ensure() {
  if (ctx) return;
  ctx = new AudioContext();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
}

export function resumeAudio() {
  ensure();
  void ctx!.resume();
}

/** Route any media element through the meter (and still out to speakers). */
export function hookMedia(el: HTMLMediaElement) {
  if (hooked.has(el)) return;
  ensure();
  try {
    const src = ctx!.createMediaElementSource(el);
    src.connect(analyser!);
    src.connect(ctx!.destination);
    hooked.add(el);
  } catch {
    /* cross-origin or already hooked */
  }
}

let micStream: MediaStream | null = null;
let micSrc: MediaStreamAudioSourceNode | null = null;
export async function startMic() {
  ensure();
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micSrc = ctx!.createMediaStreamSource(micStream);
  micSrc.connect(analyser!);
}
export function stopMic() {
  micSrc?.disconnect();
  micStream?.getTracks().forEach((t) => t.stop());
  micSrc = null;
  micStream = null;
}

export function setSpeaking(v: boolean) {
  speaking = v;
}

function fakeEnvelope(): number {
  const t = performance.now() / 1000;
  const syl = Math.abs(Math.sin(t * 9)) * 0.6 + Math.abs(Math.sin(t * 23)) * 0.3;
  return 0.25 + syl * (0.6 + Math.random() * 0.25);
}

/** Per-band levels (low, mid, high) of whatever is playing through the meter: the server voice, or the mic while listening. */
export function getLevels(): [number, number, number] {
  if (speaking) {
    const e = fakeEnvelope();
    return [Math.min(1, e * 0.8), Math.min(1, e), Math.min(1, e * 0.7)];
  }
  if (!analyser || !freq || !ctx) return [0, 0, 0];
  analyser.getByteFrequencyData(freq);
  return bandLevels(freq, ctx.sampleRate, analyser.fftSize);
}

export function getLevel(): number {
  let lvl = 0;
  if (analyser && buf) {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i]! - 128) / 128;
      sum += v * v;
    }
    lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }
  if (speaking) lvl = Math.max(lvl, fakeEnvelope());
  return Math.min(1, lvl);
}

/** Auto-hook every audio/video element that appears on the page. */
export function watchMediaElements() {
  const scan = () => document.querySelectorAll("audio,video").forEach((el) => {
    el.addEventListener("play", () => { resumeAudio(); hookMedia(el as HTMLMediaElement); }, { once: true });
  });
  scan();
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });
  return () => mo.disconnect();
}

const VOICE_KEY = "kitt.voice";

export function listVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
}

export function getVoiceName(): string | null {
  try { return localStorage.getItem(VOICE_KEY); } catch { return null; }
}

export function setVoiceName(name: string | null) {
  try { name ? localStorage.setItem(VOICE_KEY, name) : localStorage.removeItem(VOICE_KEY); } catch { /* storage unavailable */ }
}

export function currentVoice(): SpeechSynthesisVoice | null {
  const choice = parseVoiceChoice(getVoiceName());
  return pickVoice(listVoices(), choice?.kind === "browser" ? choice.name : null);
}

let playing: HTMLAudioElement | null = null;

/** Plays a WAV blob through the meter so the voice matrix follows it. Resolves when playback ends. */
export function playBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    ensure();
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    el.crossOrigin = "anonymous";
    hookMedia(el);
    playing = el;
    const done = () => {
      if (playing === el) playing = null;
      URL.revokeObjectURL(url);
      resolve();
    };
    el.onended = done;
    el.onerror = done;
    el.onpause = () => { if (el.ended === false && playing !== el) done(); };
    el.play().catch(done);
  });
}

export function stopPlayback() {
  const el = playing;
  playing = null;
  if (el) { el.pause(); el.src = ""; }
}

export function speak(text: string, { queue = false }: { queue?: boolean } = {}) {
  if (!("speechSynthesis" in window)) return;
  const clean = text.replace(/[*#`_>\[\]()]/g, "").trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.voice = currentVoice();
  // Measured and unhurried: KITT never sounds rushed.
  u.rate = 0.95;
  u.pitch = 0.85;
  u.onstart = () => setSpeaking(true);
  u.onend = u.onerror = () => setSpeaking(false);
  if (!queue) speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

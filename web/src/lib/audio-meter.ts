/**
 * Global audio meter. Any audio the app outputs (speech, <audio>/<video> elements)
 * or captures (mic) feeds a level (0..1) that the voice box renders.
 */
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let buf: Uint8Array<ArrayBuffer> | null = null;
let speaking = false;
const hooked = new WeakSet<HTMLMediaElement>();

function ensure() {
  if (ctx) return;
  ctx = new AudioContext();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
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
  if (speaking) {
    // Browser speech can't be tapped directly; synthesise a speech-like envelope.
    const t = performance.now() / 1000;
    const syl = Math.abs(Math.sin(t * 9)) * 0.6 + Math.abs(Math.sin(t * 23)) * 0.3;
    lvl = Math.max(lvl, 0.25 + syl * (0.6 + Math.random() * 0.25));
  }
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

export function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  const clean = text.replace(/[*#`_>\[\]()]/g, "");
  const u = new SpeechSynthesisUtterance(clean);
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|george|arthur/i.test(v.name)) ?? voices.find((v) => /en-GB/i.test(v.lang)) ?? null;
  u.rate = 1.02;
  u.pitch = 0.9;
  u.onstart = () => setSpeaking(true);
  u.onend = u.onerror = () => setSpeaking(false);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

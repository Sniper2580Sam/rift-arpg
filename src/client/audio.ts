// Tiny WebAudio synth: every sound is generated in code. Loot is deliberately loud.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
    } catch { ctx = null; }
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
  if (ctx && master) master.gain.value = muted ? 0 : 0.35;
}
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.35; return muted; }
export function setMuted(v: boolean) { muted = v; if (master) master.gain.value = muted ? 0 : 0.35; }

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.3, slideTo?: number, delay = 0) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol = 0.3, freq = 1200, delay = 0) {
  if (!ctx || !master || muted) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
}

let lastHit = 0;
export const sfx = {
  swing: () => noise(0.08, 0.15, 2500),
  hit: (crit: boolean) => {
    const now = performance.now(); if (now - lastHit < 35) return; lastHit = now;
    noise(0.07, crit ? 0.4 : 0.25, crit ? 800 : 1400); if (crit) tone(220, 0.08, "square", 0.12, 110);
  },
  kill: () => { noise(0.12, 0.2, 500); tone(180, 0.1, "triangle", 0.15, 60); },
  bigKill: () => { noise(0.35, 0.5, 300); tone(90, 0.4, "sawtooth", 0.25, 30); },
  lance: () => tone(300, 0.18, "sawtooth", 0.12, 900),
  dash: () => noise(0.15, 0.25, 600),
  summon: () => { tone(200, 0.3, "triangle", 0.2, 600); tone(300, 0.3, "triangle", 0.15, 900, 0.05); },
  hurt: () => { tone(140, 0.15, "square", 0.25, 70); },
  slam: () => { noise(0.3, 0.45, 200); tone(70, 0.3, "sine", 0.4, 35); },
  explosion: () => { noise(0.25, 0.35, 400); },
  pickup: () => { tone(880, 0.06, "square", 0.12); tone(1320, 0.08, "square", 0.1, undefined, 0.05); },
  drop: (rarity: string) => {
    if (rarity === "legendary") {
      tone(110, 0.9, "sawtooth", 0.35, 55); noise(0.6, 0.5, 250);
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.9, "triangle", 0.28, undefined, 0.08 + i * 0.07));
    } else if (rarity === "set" || rarity === "mythic") {
      tone(98, 0.9, "sawtooth", 0.35, 49); noise(0.6, 0.5, 250);
      [587, 740, 880, 1175, 1480].forEach((f, i) => tone(f, 0.9, "triangle", 0.28, undefined, 0.08 + i * 0.07));
    } else if (rarity === "rare") {
      [784, 988, 1175].forEach((f, i) => tone(f, 0.35, "triangle", 0.18, undefined, i * 0.05));
    } else if (rarity === "magic") { tone(660, 0.2, "triangle", 0.12); tone(880, 0.2, "triangle", 0.1, undefined, 0.05); }
    else tone(440, 0.08, "triangle", 0.08);
  },
  guardian: () => { tone(55, 1.6, "sawtooth", 0.35, 40); tone(82, 1.6, "sawtooth", 0.25, 60); noise(1.2, 0.3, 150); },
  complete: () => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.6, "triangle", 0.25, undefined, i * 0.12)); },
  death: () => { tone(300, 0.8, "sawtooth", 0.3, 40); },
  ui: () => tone(600, 0.04, "square", 0.08),
  shout: () => { tone(160, 0.35, "sawtooth", 0.25, 90); noise(0.3, 0.25, 500); },
};

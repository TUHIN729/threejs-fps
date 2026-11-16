// Procedural sound: every effect is synthesised with WebAudio, so the game ships no
// audio files and makes no network request. Created lazily on first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration, type = 'lowpass', frequency = 1200, gain = 0.8, decay = 0.08 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(duration + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter).connect(amp).connect(master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  function tone({ frequency = 440, end = null, duration = 0.1, type = 'sine', gain = 0.3 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (end !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(kind) {
      // kind: 'rifle' | 'smg' | 'shotgun' | 'pistol' | 'enemy'
      if (kind === 'shotgun') burst({ duration: 0.22, frequency: 900, gain: 1.0, decay: 0.16 });
      else if (kind === 'rifle') burst({ duration: 0.14, frequency: 1600, gain: 0.85, decay: 0.1 });
      else if (kind === 'smg') burst({ duration: 0.09, frequency: 2200, gain: 0.6, decay: 0.07 });
      else if (kind === 'enemy') burst({ duration: 0.12, frequency: 1100, gain: 0.35, decay: 0.09 });
      else burst({ duration: 0.1, frequency: 1900, gain: 0.7, decay: 0.08 });
      tone({ frequency: 180, end: 55, duration: 0.09, type: 'triangle', gain: 0.5 });
    },
    dryFire() {
      tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ frequency: 900, duration: 0.04, type: 'square', gain: 0.15 });
      setTimeout(() => tone({ frequency: 600, duration: 0.05, type: 'square', gain: 0.18 }), 220);
      setTimeout(() => tone({ frequency: 1100, duration: 0.04, type: 'square', gain: 0.15 }), 520);
    },
    hit(kill) {
      tone({ frequency: kill ? 1320 : 990, duration: kill ? 0.12 : 0.06, type: 'sine', gain: 0.35 });
    },
    hurt() {
      tone({ frequency: 220, end: 110, duration: 0.16, type: 'sawtooth', gain: 0.3 });
    },
    step() {
      burst({ duration: 0.05, frequency: 500, gain: 0.08, decay: 0.05 });
    },
    beep(final = false) {
      tone({ frequency: final ? 1560 : 1040, duration: 0.09, type: 'sine', gain: 0.3 });
    },
    plant() {
      tone({ frequency: 520, end: 1040, duration: 0.35, type: 'sine', gain: 0.3 });
    },
    explosion() {
      burst({ duration: 1.1, frequency: 320, gain: 1.2, decay: 0.9 });
      tone({ frequency: 90, end: 28, duration: 0.9, type: 'sine', gain: 0.9 });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone({ frequency: f, duration: 0.18, gain: 0.3 }), i * 130));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ frequency: f, duration: 0.2, gain: 0.28 }), i * 140));
    },
    buy() {
      tone({ frequency: 880, duration: 0.06, type: 'sine', gain: 0.25 });
      setTimeout(() => tone({ frequency: 1174, duration: 0.08, type: 'sine', gain: 0.25 }), 70);
    },
    denied() {
      tone({ frequency: 180, duration: 0.12, type: 'square', gain: 0.2 });
    },
    grenade() {
      burst({ duration: 0.1, frequency: 3000, gain: 0.3, decay: 0.06 });
    },
  };
}

// Atlas Tycoon - sound effects synthesised with the Web Audio API (no audio files).
(function () {
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem('atlas.mute') === '1'; } catch { /* storage unavailable */ }

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Browsers only allow audio after a user gesture.
  ['pointerdown', 'keydown'].forEach((e) => document.addEventListener(e, () => ac(), { passive: true }));

  // One oscillator note with a quick attack and exponential release.
  function tone(freq, at, dur, opt) {
    const o = Object.assign({ type: 'sine', vol: 0.25, to: null, vibrato: 0 }, opt);
    const c = ctx, t = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    if (o.vibrato) {
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 6;
      lg.gain.value = o.vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A short burst of filtered noise: rattles, thuds and whooshes.
  function noise(at, dur, opt) {
    const o = Object.assign({ vol: 0.2, freq: 2000, q: 1, type: 'bandpass', to: null }, opt);
    const c = ctx, t = c.currentTime + at;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q;
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  const SOUNDS = {
    click() { tone(1400, 0, 0.035, { type: 'square', vol: 0.04 }); },
    hop() { tone(480 + Math.random() * 80, 0, 0.07, { type: 'triangle', vol: 0.1, to: 760 }); },
    dice() {
      for (let i = 0; i < 9; i++) noise(i * 0.075 + Math.random() * 0.03, 0.04, { vol: 0.35, freq: 2400 + Math.random() * 1500, q: 3 });
    },
    diceLand() {
      noise(0, 0.06, { vol: 0.5, freq: 1800, q: 2 });
      noise(0.09, 0.05, { vol: 0.35, freq: 2200, q: 2 });
      tone(170, 0, 0.12, { vol: 0.25, to: 90 });
    },
    coin() {
      tone(1319, 0, 0.07, { type: 'square', vol: 0.07 });
      tone(1760, 0.06, 0.22, { type: 'square', vol: 0.07 });
    },
    gain() {
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.06, 0.18, { type: 'triangle', vol: 0.16 }));
    },
    lose() {
      tone(392, 0, 0.32, { type: 'sawtooth', vol: 0.09, to: 196 });
      tone(294, 0.1, 0.36, { type: 'sawtooth', vol: 0.07, to: 147 });
      noise(0, 0.25, { vol: 0.12, freq: 600, q: 0.7, type: 'lowpass' });
    },
    pay() {
      for (let i = 0; i < 6; i++) {
        tone(1568 + (i % 2) * 300, i * 0.07, 0.09, { type: 'square', vol: 0.05 });
        noise(i * 0.07, 0.03, { vol: 0.12, freq: 6000, q: 4 });
      }
      tone(330, 0, 0.35, { type: 'sawtooth', vol: 0.06, to: 220 });
    },
    buy() {
      tone(784, 0, 0.12, { type: 'triangle', vol: 0.2 });
      tone(1047, 0.1, 0.14, { type: 'triangle', vol: 0.2 });
      tone(1568, 0.2, 0.35, { type: 'sine', vol: 0.18 });
      noise(0.2, 0.08, { vol: 0.1, freq: 7000, q: 5 });
    },
    build() {
      tone(140, 0, 0.18, { vol: 0.45, to: 60 });
      noise(0, 0.12, { vol: 0.3, freq: 400, q: 0.8, type: 'lowpass' });
      [1568, 2093, 2637].forEach((f, i) => tone(f, 0.14 + i * 0.07, 0.18, { type: 'sine', vol: 0.08 }));
    },
    sell() {
      noise(0, 0.4, { vol: 0.25, freq: 800, q: 0.6, type: 'lowpass', to: 200 });
      tone(523, 0.05, 0.25, { type: 'triangle', vol: 0.1, to: 262 });
    },
    card() {
      noise(0, 0.22, { vol: 0.18, freq: 1200, q: 0.8, type: 'highpass', to: 5000 });
      tone(880, 0.12, 0.25, { type: 'sine', vol: 0.12 });
      tone(1320, 0.2, 0.3, { type: 'sine', vol: 0.1 });
    },
    turn() {
      tone(660, 0, 0.18, { type: 'sine', vol: 0.1 });
      tone(990, 0.09, 0.25, { type: 'sine', vol: 0.08 });
    },
    myTurn() {
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.22, { type: 'triangle', vol: 0.2 }));
    },
    tick() { tone(1046, 0, 0.05, { type: 'square', vol: 0.06 }); },
    bankrupt() {
      // A sad, sliding "wah wah wah waaah".
      [[392, 0], [370, 0.38], [349, 0.76]].forEach(([f, at]) => tone(f, at, 0.34, { type: 'sawtooth', vol: 0.12, to: f * 0.94 }));
      tone(330, 1.14, 1.1, { type: 'sawtooth', vol: 0.13, to: 300, vibrato: 7 });
      noise(1.14, 0.9, { vol: 0.08, freq: 500, q: 0.6, type: 'lowpass' });
    },
    win() {
      [[523, 0, 0.16], [659, 0.15, 0.16], [784, 0.3, 0.16], [1047, 0.45, 0.6]].forEach(([f, at, d]) => tone(f, at, d, { type: 'triangle', vol: 0.22 }));
      [523, 659, 784].forEach((f) => tone(f, 0.45, 0.9, { type: 'sine', vol: 0.08 }));
    },
  };

  window.ATSfx = {
    play(name) {
      if (muted || !SOUNDS[name]) return;
      try { if (ac()) SOUNDS[name](); } catch { /* audio unavailable */ }
    },
    get muted() { return muted; },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('atlas.mute', muted ? '1' : '0'); } catch { /* storage unavailable */ }
    },
  };
})();

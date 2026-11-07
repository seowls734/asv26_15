// PK.Music — chiptune BGM: look-ahead scheduler (setInterval + audioCtx.currentTime) driving
// short-lived oscillators/noise per note. One loop per map (0..5) plus title (-1).
// Songs are compact data: chord per bar, lead in 8ths, bass/arp/drum 16-step patterns.
// API: init(ctx, dest), play(id), stop(), setIntensity(0..1), setLastLap(on), setMuted(on), muted.
window.PK = window.PK || {};
(function (PK) {
  'use strict';

  // ---------------------------------------------------------------------------
  // song data
  // lead: 8 tokens per bar (8th notes): note name | '-' hold | '.' rest
  // bass: 16 steps: R root, O octave, F fifth, T third, '-' hold, '.' rest
  // arp: 16 steps: digit = chord-tone index (wraps up an octave), '.' rest
  // drums k/s/h: 16 steps: x hit, o soft, '.' rest
  // ---------------------------------------------------------------------------
  const SONGS = {
    // title / menus — calm, catchy, F major
    '-1': {
      bpm: 104, lw: 'triangle', bw: 'triangle', aw: 'pulse', lv: 0.26, arpMin: 0, arpOct: 5, echo: 0.22,
      chords: ['Fmaj7', 'Am7', 'Bbmaj7', 'C', 'Dm7', 'Bbmaj7', 'Gm7', 'C7',
        'Bbmaj7', 'C', 'Am7', 'Dm7', 'Gm7', 'C', 'Fmaj7', 'C7'],
      lead: [
        'A5 - C6 - . A5 G5 F5', 'E5 - - C5 E5 - G5 .', 'F5 - D5 F5 A5 - Bb5 A5', 'G5 - - - E5 - . .',
        'F5 - A5 - D6 - C6 A5', 'Bb5 - A5 F5 D5 - F5 .', 'G5 - Bb5 - A5 G5 F5 E5', 'G5 - - - - - . .',
        'D6 - - C6 Bb5 - A5 F5', 'E5 - G5 - C6 - Bb5 .', 'A5 - G5 E5 C5 - E5 G5', 'F5 - - - A5 - C6 .',
        'Bb5 - A5 G5 D5 - G5 A5', 'G5 - E5 - C5 - E5 G5', 'F5 - - - A5 - C6 -', 'E6 - - - . . . .'],
      bass: 'R---..O.F---..O.',
      arp: '0123210301232103',
      k: 'x.......x.......', s: '............o...', h: '..o...o...o...o.'
    },
    // 0 슈퍼마트 서킷 — bright, upbeat, C major four-on-the-floor
    0: {
      bpm: 148, lw: 'pulse', bw: 'triangle', aw: 'square', lv: 0.22, arpMin: 0.35, arpOct: 5,
      chords: ['C', 'G', 'Am', 'F', 'C', 'F', 'G', 'G',
        'F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'C'],
      lead: [
        'E5 G5 C6 G5 E5 - D5 E5', 'D5 - B4 D5 G5 - F5 D5', 'C5 E5 A5 - G5 E5 C5 E5', 'F5 - A5 G5 F5 - E5 D5',
        'E5 G5 C6 - D6 C6 G5 E5', 'F5 A5 C6 A5 F5 - G5 A5', 'B5 - A5 G5 F5 G5 A5 B5', 'D6 - - - C6 - B5 .',
        'A5 - F5 A5 C6 - A5 F5', 'G5 - D5 G5 B5 - A5 G5', 'E5 G5 B5 G5 E5 - G5 B5', 'C6 - B5 A5 E5 - A5 B5',
        'D6 - C6 A5 F5 - A5 C6', 'B5 - G5 B5 D6 C6 B5 G5', 'C6 - G5 E5 C5 E5 G5 B5', 'C6 - - - . . G5 .'],
      bass: 'R.O.R.OR.O.R.FO.',
      arp: '0120120120120124',
      k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.'
    },
    // 1 냉동 코너 — icy, sparkly, D major with echo bells
    1: {
      bpm: 132, lw: 'triangle', bw: 'pulse', aw: 'pulse', lv: 0.28, arpMin: 0, arpOct: 6, echo: 0.35, sparkle: 0.14,
      chords: ['Dmaj7', 'A', 'Bm7', 'Gmaj7', 'Em7', 'A', 'Dmaj7', 'A7',
        'Gmaj7', 'F#m7', 'Em7', 'A', 'Bm7', 'Gmaj7', 'Em7', 'A7'],
      lead: [
        'F#5 - A5 - C#6 - A5 E5', 'E5 - - C#5 E5 A5 - .', 'D5 F#5 B5 - A5 F#5 D5 F#5', 'G5 - F#5 D5 B4 - D5 .',
        'E5 G5 B5 - D6 - B5 G5', 'A5 - C#6 - E6 - C#6 .', 'F#6 - E6 C#6 A5 - F#5 A5', 'E5 - - - G5 - A5 .',
        'B5 - D6 - F#6 - D6 B5', 'A5 - F#5 - C#6 - A5 .', 'G5 - E5 G5 B5 - D6 B5', 'C#6 - - A5 E5 - C#6 .',
        'D6 - B5 F#5 D5 - F#5 B5', 'D6 - - B5 G5 - F#5 G5', 'E5 - G5 B5 D6 - C#6 B5', 'A5 - - - - - . .'],
      bass: 'R-..R-..F-..O-..',
      arp: '0124214012424210',
      k: 'x.......x.x.....', s: '....x.......x...', h: 'o.o.o.o.o.o.o.o.'
    },
    // 2 청과 시장 — sunny, bouncy, G major with a light swing
    2: {
      bpm: 140, swing: 0.12, lw: 'pulse', bw: 'square', aw: 'triangle', lv: 0.22, arpMin: 0.4, arpOct: 5,
      chords: ['G', 'C', 'D', 'G', 'Em', 'C', 'D', 'G',
        'C', 'D', 'Bm', 'Em', 'Am', 'D', 'G', 'G'],
      lead: [
        'D5 G5 . G5 B5 . A5 G5', 'E5 - G5 E5 C5 . E5 G5', 'F#5 A5 . A5 D6 . C6 A5', 'B5 - G5 - D5 . . .',
        'E5 G5 B5 . B5 C6 B5 G5', 'A5 - E5 - C6 . A5 G5', 'F#5 G5 A5 . D5 E5 F#5 A5', 'G5 - - . D5 . G4 .',
        'C6 . C6 B5 A5 . G5 E5', 'F#5 . A5 F#5 D5 - . D5', 'D5 F#5 B5 . A5 . F#5 D5', 'E5 - G5 . B5 . E6 .',
        'C6 - B5 A5 G5 . E5 G5', 'A5 . D6 . C6 . A5 F#5', 'G5 B5 D6 B5 G5 . A5 B5', 'G5 - - - . . . .'],
      bass: 'R.O.R.O.F.O.R.OT',
      arp: '0.12.0.21.20.1.2',
      k: 'x.....x.x.......', s: '....x.......x..o', h: '..x...x...x...x.'
    },
    // 3 옥상 주차장 — dusk city, cool swung groove, E minor
    3: {
      bpm: 118, swing: 0.2, lw: 'square', bw: 'sawtooth', aw: 'pulse', lv: 0.17, arpMin: 0.3, arpOct: 4, echo: 0.2,
      chords: ['Em7', 'A7', 'Em7', 'A7', 'Cmaj7', 'B7', 'Em7', 'D',
        'Am7', 'D7', 'Gmaj7', 'Cmaj7', 'Am7', 'B7', 'Em7', 'B7'],
      lead: [
        'B4 . D5 E5 . G5 - E5', 'C#5 - E5 . G5 F#5 E5 .', 'D5 E5 . B4 - . D5 E5', 'G5 - A5 G5 E5 - . .',
        'E5 G5 B5 - . A5 G5 E5', 'D#5 - F#5 . A5 - F#5 D#5', 'E5 - - G5 F#5 E5 D5 B4', 'D5 - F#5 A5 - . . .',
        'A5 . G5 E5 . C5 E5 G5', 'F#5 - A5 . C6 - A5 F#5', 'G5 B5 D6 . F#6 - D6 B5', 'E6 - - D6 B5 - G5 .',
        'C6 . B5 A5 . G5 E5 G5', 'A5 - F#5 D#5 B4 - D#5 F#5', 'G5 - F#5 E5 D5 - B4 D5', 'E5 - - - . . . .'],
      bass: 'R..R..O.R.F..OR.',
      arp: '0.2.1.3.0.2.1.3.',
      k: 'x..x..x...x..x..', s: '....x.......x..o', h: 'x.x.x.x.x.x.x.x.'
    },
    // 4 유령 묘지 서킷 — spooky D harmonic minor, vibrato lead, bells
    4: {
      bpm: 100, lw: 'triangle', bw: 'triangle', aw: 'pulse', lv: 0.3, arpMin: 0.25, arpOct: 4, echo: 0.4, vib: 22, bells: true,
      chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Gm', 'A7', 'Dm',
        'Bb', 'F', 'Gm', 'A', 'Dm', 'Bb', 'Edim', 'A7'],
      lead: [
        'D5 - F5 - A5 - G#5 A5', 'Bb5 - A5 - F5 - D5 .', 'G5 - Bb5 - D6 - C#6 D6', 'E6 - - - C#6 - A5 .',
        'F5 - E5 F5 A5 - F5 D5', 'Bb5 - A5 G5 D5 - G5 Bb5', 'A5 - C#6 E6 G5 - F5 E5', 'D5 - - - - - . .',
        'D6 - Bb5 - F5 - Bb5 D6', 'C6 - A5 - F5 - A5 C6', 'Bb5 - G5 D5 Bb5 - A5 G5', 'A5 - - C#6 E6 - - .',
        'F6 - E6 D6 A5 - D6 F6', 'D6 - C6 Bb5 F5 - - .', 'E5 G5 Bb5 - C#6 - Bb5 G5', 'A5 - - - C#5 - E5 .'],
      bass: 'R---..R.F---..O.',
      arp: '0.1.2.1.0.1.2.3.',
      k: 'x.......x.......', s: '........x.......', h: '.....o.......o..'
    },
    // 5 글리치 월드 — chaotic C# minor, bit-crushed bus, stutters & pitch glitches
    5: {
      bpm: 160, lw: 'square', bw: 'sawtooth', aw: 'pulse', lv: 0.18, arpMin: 0, arpOct: 5, glitch: true,
      chords: ['C#m', 'A', 'F#m', 'G#', 'C#m', 'D', 'C#m', 'G#7',
        'A', 'B', 'G#m', 'C#m', 'D', 'C', 'G#', 'G#'],
      lead: [
        'C#5 E5 G#5 C#6 . G#5 E5 C#5', 'E5 - A5 E5 C#6 - B5 A5', 'F#5 A5 C#6 . F#6 . C#6 A5', 'G#5 - C6 - D#6 - C6 G#5',
        'C#6 . C#6 . E6 D#6 C#6 B5', 'D6 - A5 F#5 D5 - F#5 A5', 'G#5 E5 C#5 E5 G#5 C#6 E6 G#6', 'G#5 - - . F#5 G5 G#5 .',
        'A5 C#6 E6 . E6 C#6 A5 E5', 'B5 D#6 F#6 . F#6 D#6 B5 F#5', 'G#5 B5 D#6 - D#6 - B5 G#5', 'C#6 - - E6 - - G#6 .',
        'D6 . A5 . F#5 . D6 C#6', 'C6 . G5 . E5 . C6 B5', 'C6 - D#6 - G#6 - F#6 D#6', 'C6 - - - G#5 . . .'],
      bass: 'RORORFROR.ROFORO',
      arp: '0123012301230123',
      k: 'x...x...x..xx...', s: '....x.......x.x.', h: 'x.xxx.xxx.xxx.xx'
    }
  };

  // ---------------------------------------------------------------------------
  // parsing (done once per song, lazily)
  // ---------------------------------------------------------------------------
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6, 9] };
  function pc(s) { let n = NOTE[s[0]]; if (s[1] === '#') n++; else if (s[1] === 'b') n--; return n; }
  function midi(tok) { // "C#5" -> 73
    const m = /^([A-G][#b]?)(-?\d)$/.exec(tok);
    return m ? pc(m[1]) + 12 * (+m[2] + 1) : -1;
  }
  function chord(name) {
    const m = /^([A-G][#b]?)(.*)$/.exec(name) || ['', 'C', ''];
    return { root: (pc(m[1]) + 12) % 12, tones: QUAL[m[2]] || QUAL[''] };
  }
  function prep(s) {
    if (s._p) return s;
    s._chords = s.chords.map(chord);
    s._lead = s.lead.map(function (bar) {
      const t = bar.split(/\s+/), out = [];
      for (let i = 0; i < 8; i++) {
        const n = midi(t[i] || '.');
        if (n < 0) { out.push(null); continue; }
        let len = 1; while (t[i + len] === '-') len++;
        out.push({ n: n, len: len });
      }
      return out;
    });
    s._bars = Math.max(s._chords.length, s._lead.length);
    s._p = true;
    return s;
  }
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ---------------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------------
  let ac = null, out = null, noiseBuf = null, pulse = null, crushCurve = null;
  let cur = null, timer = null;
  let intensity = 0, lastLap = false, muted = false;
  const LOOK = 0.12, TICK = 25, VOL = 0.35;

  function init(ctx, dest) {
    if (ac || !ctx) return;
    try {
      ac = ctx;
      out = ac.createGain(); out.gain.value = muted ? 0 : VOL; out.connect(dest || ac.destination);
      const len = (ac.sampleRate * 0.5) | 0;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // 25% pulse wave (classic NES-ish timbre)
      if (ac.createPeriodicWave) {
        const N = 32, re = new Float32Array(N), im = new Float32Array(N);
        for (let n = 1; n < N; n++) { re[n] = Math.sin(2 * Math.PI * n * 0.25) / n; im[n] = (1 - Math.cos(2 * Math.PI * n * 0.25)) / n; }
        try { pulse = ac.createPeriodicWave(re, im); } catch (e) { pulse = null; }
      }
      // staircase curve for the glitch bus (amplitude bit-crush)
      crushCurve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; crushCurve[i] = Math.round(x * 7) / 7; }
    } catch (e) { ac = null; out = null; }
  }

  // ---------------------------------------------------------------------------
  // per-song graph: bus -> (crusher) -> out ; optional echo send, vibrato LFO, drum filters
  // ---------------------------------------------------------------------------
  function buildGraph(s, t0, fadeIn) {
    const g = { nodes: [], oscs: [] };
    const bus = ac.createGain(); g.bus = bus; g.nodes.push(bus);
    bus.gain.setValueAtTime(fadeIn ? 0.0001 : 1, t0);
    if (fadeIn) bus.gain.linearRampToValueAtTime(1, t0 + 0.35);
    if (s.glitch && ac.createWaveShaper) {
      const pre = ac.createGain(); pre.gain.value = 2.2;
      const sh = ac.createWaveShaper(); sh.curve = crushCurve;
      const post = ac.createGain(); post.gain.value = 0.45;
      bus.connect(pre); pre.connect(sh); sh.connect(post); post.connect(out);
      g.nodes.push(pre, sh, post);
    } else bus.connect(out);
    g.dry = bus;
    if (s.echo && ac.createDelay) {
      const dl = ac.createDelay(1), fb = ac.createGain(), wet = ac.createGain();
      dl.delayTime.value = Math.min(0.9, 3 * 15 / s.bpm); // dotted 8th
      fb.gain.value = 0.35; wet.gain.value = s.echo;
      dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(bus);
      g.echo = dl; g.nodes.push(dl, fb, wet);
    }
    if (s.vib) {
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 5.2; lg.gain.value = s.vib;
      lfo.connect(lg); lfo.start(t0);
      g.vib = lg; g.oscs.push(lfo); g.nodes.push(lfo, lg);
    }
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; hp.connect(bus);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8; bp.connect(bus);
    g.hat = hp; g.snr = bp; g.nodes.push(hp, bp);
    return g;
  }
  function killGraph(g, t) {
    try {
      g.bus.gain.cancelScheduledValues(t);
      g.bus.gain.setValueAtTime(g.bus.gain.value || 1, t);
      g.bus.gain.linearRampToValueAtTime(0.0001, t + 0.3);
    } catch (e) { /* ignore */ }
    setTimeout(function () {
      for (const o of g.oscs) { try { o.stop(); } catch (e) { /* ignore */ } }
      for (const n of g.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    }, 700);
  }

  // ---------------------------------------------------------------------------
  // voices
  // ---------------------------------------------------------------------------
  function cleanup(src, gn, vib) {
    src.onended = function () {
      try { if (vib) vib.disconnect(src.detune); } catch (e) { /* ignore */ }
      try { src.disconnect(); gn.disconnect(); } catch (e) { /* ignore */ }
    };
  }
  function voice(g, t, n, dur, wave, vol, opt) {
    const o = ac.createOscillator(), gn = ac.createGain();
    if (wave === 'pulse' && pulse) o.setPeriodicWave(pulse); else o.type = wave === 'pulse' ? 'square' : wave;
    o.frequency.setValueAtTime(mtof(n), t);
    if (opt && opt.det) o.detune.setValueAtTime(opt.det, t);
    if (opt && opt.slide) o.frequency.exponentialRampToValueAtTime(mtof(n + opt.slide), t + dur);
    const rel = Math.min(0.08, dur * 0.4);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.004);
    gn.gain.setValueAtTime(vol * 0.7, t + Math.max(0.01, dur - rel));
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(g.dry);
    if (opt && opt.echo && g.echo) gn.connect(g.echo);
    const vib = opt && opt.vib && g.vib;
    if (vib) g.vib.connect(o.detune);
    cleanup(o, gn, vib ? g.vib : null);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function kick(g, t, v) {
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    gn.gain.setValueAtTime(0.5 * v, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(gn); gn.connect(g.dry); cleanup(o, gn);
    o.start(t); o.stop(t + 0.16);
  }
  function hit(g, t, dest, dur, vol) {
    const s = ac.createBufferSource(), gn = ac.createGain();
    s.buffer = noiseBuf;
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(gn); gn.connect(dest); cleanup(s, gn);
    s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------------------
  // scheduler
  // ---------------------------------------------------------------------------
  function stepDur(s) { return 60 / (s.bpm * (lastLap ? 1.1 : 1)) / 4; }

  function playStep(c, t) {
    const s = c.s, g = c.g, sd = stepDur(s);
    const i = c.step % 16, bar = ((c.step / 16) | 0) % s._bars;
    const ch = s._chords[bar % s._chords.length];
    const lastBar = bar === s._bars - 1;
    if (s.swing && (i & 3) === 2) t += s.swing * sd;
    const gl = s.glitch;

    // lead (8ths)
    if ((i & 1) === 0) {
      const ev = s._lead[bar % s._lead.length][i >> 1];
      if (ev) {
        let n = ev.n, det = 0;
        if (gl && Math.random() < 0.12) n += Math.random() < 0.5 ? 12 : -12;
        if (gl && Math.random() < 0.1) det = (Math.random() * 2 - 1) * 60;
        const dur = ev.len * 2 * sd * 0.92;
        const wave = lastLap && s.lw === 'triangle' ? 'pulse' : s.lw;
        voice(g, t, n, dur, wave, s.lv * (lastLap ? 1.1 : 1), { echo: true, vib: !!s.vib, det: det, slide: gl && Math.random() < 0.06 ? -24 : 0 });
        if (lastLap) voice(g, t, n + 12, dur, 'square', s.lv * 0.28, { det: 6 });
        c.lastN = n;
      } else if (gl && c.lastN && Math.random() < 0.15) {
        // glitch stutter: retrigger last pitch as a 16th blip
        voice(g, t, c.lastN + (Math.random() < 0.5 ? 0 : 7), sd * 0.5, 'square', s.lv * 0.8, {});
      }
    }

    // bass
    const bc = s.bass[i];
    if (bc && bc !== '.' && bc !== '-') {
      let len = 1; while (s.bass[i + len] === '-') len++;
      const root = 36 + ch.root;
      const n = bc === 'O' ? root + 12 : bc === 'F' ? root + 7 : bc === 'T' ? root + ch.tones[1] : root;
      voice(g, t, n, len * sd * 0.9, s.bw, 0.3, {});
    }

    // arpeggio (fades in with intensity)
    const ac2 = s.arp[i];
    if (ac2 && ac2 !== '.' && intensity >= s.arpMin) {
      const k = +ac2, tn = ch.tones;
      const n = 12 * (s.arpOct + 1) + ch.root + tn[k % tn.length] + 12 * ((k / tn.length) | 0);
      const v = 0.07 + 0.05 * Math.min(1, intensity + (lastLap ? 0.3 : 0));
      voice(g, t, gl && Math.random() < 0.08 ? n + 1 : n, sd * 0.7, s.aw, v, { echo: !!s.echo });
    }

    // sparkles (icy) / bells (haunted)
    if (s.sparkle && Math.random() < s.sparkle) {
      const tn = ch.tones;
      voice(g, t, 84 + ch.root + tn[(Math.random() * tn.length) | 0], 0.12, 'triangle', 0.08, { echo: true });
    }
    if (s.bells && i === 0 && (bar & 1) === 0) voice(g, t, 72 + ch.root + ch.tones[2], 1.2, 'triangle', 0.1, { echo: true, vib: true });

    // drums
    const kc = s.k[i], sc = s.s[i], hc = s.h[i];
    if (kc !== '.') kick(g, t, kc === 'x' ? 1 : 0.6);
    else if (intensity > 0.8 && i === 14) kick(g, t, 0.6);
    if (lastBar && i >= 12) hit(g, t, g.snr, 0.08, 0.14 + 0.04 * (i - 12));
    else if (sc !== '.') hit(g, t, g.snr, sc === 'x' ? 0.12 : 0.06, sc === 'x' ? 0.3 : 0.12);
    if (hc !== '.') hit(g, t, g.hat, 0.035, hc === 'x' ? 0.12 : 0.06);
    else if (intensity > 0.55) hit(g, t, g.hat, 0.025, 0.04 + 0.04 * intensity);
    if (gl && Math.random() < 0.04) hit(g, t, g.dry, 0.05, 0.12); // raw static burst
  }

  function tick() {
    try {
      const c = cur;
      if (!c || !ac) return;
      const now = ac.currentTime;
      if (c.next < now - 0.25) c.next = now + 0.05; // tab was throttled: resync, don't burst
      let guard = 64;
      while (c.next < now + LOOK && guard-- > 0) {
        if (!muted) playStep(c, c.next);
        c.next += stepDur(c.s);
        c.step++;
        // glitch: occasionally jump back half a beat (stutter loop)
        if (c.s.glitch && (c.step & 3) === 0 && Math.random() < 0.05) c.step -= 2;
      }
    } catch (e) { /* never throw from the timer */ }
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  function play(id) {
    if (!ac || !out) return;
    try {
      let key = String(id);
      if (!SONGS[key]) key = '0';
      if (cur && cur.key === key) return;
      const now = ac.currentTime, fade = !!cur;
      if (cur) killGraph(cur.g, now);
      lastLap = false;
      const s = prep(SONGS[key]);
      cur = { key: key, s: s, g: buildGraph(s, now, fade), step: 0, next: now + (fade ? 0.08 : 0.05), lastN: 0 };
      if (!timer) timer = setInterval(tick, TICK);
      tick();
    } catch (e) { cur = null; }
  }
  function stop() {
    try {
      if (timer) { clearInterval(timer); timer = null; }
      if (cur && ac) killGraph(cur.g, ac.currentTime);
    } catch (e) { /* ignore */ }
    cur = null;
  }
  function setIntensity(x) { x = +x; intensity = x > 0 ? (x < 1 ? x : 1) : 0; }
  function setLastLap(on) { lastLap = !!on; }
  function setMuted(on) {
    muted = !!on;
    try { if (ac && out) out.gain.setTargetAtTime(muted ? 0 : VOL, ac.currentTime, 0.03); } catch (e) { /* ignore */ }
  }

  PK.Music = {
    init: function (ctx, dest) { try { init(ctx, dest); } catch (e) { /* ignore */ } },
    play: play, stop: stop, setIntensity: setIntensity, setLastLap: setLastLap, setMuted: setMuted,
    get muted() { return muted; }
  };
})(window.PK);

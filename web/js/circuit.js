'use strict';
(function (WB) {
  // ------------------------------------------------------------------
  // Topology: union-find over every pin. Pins are connected by wires,
  // by a part's internal connections (breadboard strips, button legs),
  // and by being at the same location (a leg plugged into a hole).
  // Node 0 is the common ground (all board GND pins).
  // ------------------------------------------------------------------
  function build(project) {
    const parent = new Map();
    const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
    const find = (k) => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(k) !== r) { const n = parent.get(k); parent.set(k, r); k = n; }
      return r;
    };
    const union = (a, b) => {
      add(a); add(b);
      const ra = find(a), rb = find(b);
      if (ra === rb) return;
      if (ra === 'GND0') parent.set(rb, ra); else parent.set(ra, rb);
    };
    add('GND0');
    const byPos = new Map();
    for (const part of project.parts) {
      const def = WB.PARTS[part.type];
      if (!def) continue;
      for (const p of WB.worldPins(part)) {
        const k = part.id + ':' + p.id;
        add(k);
        const pk = Math.round(p.x) + ',' + Math.round(p.y);
        let list = byPos.get(pk);
        if (!list) byPos.set(pk, (list = []));
        list.push({ k, part: part.id, hole: !!def.holes });
      }
      for (const g of def.groups(part.props || {})) for (let i = 1; i < g.length; i++) union(part.id + ':' + g[0], part.id + ':' + g[i]);
      const gp = typeof def.groundPins === 'function' ? def.groundPins(part.props || {}) : def.groundPins || [];
      for (const g of gp) union(part.id + ':' + g, 'GND0');
    }
    // No board or earthed instrument: the − terminal of the first battery / power supply is the reference.
    if (![...parent.keys()].some((k) => k !== 'GND0' && find(k) === find('GND0'))) {
      const src = project.parts.find((pt) => WB.PARTS[pt.type] && WB.PARTS[pt.type].refPin);
      if (src) union(src.id + ':' + WB.PARTS[src.type].refPin, 'GND0');
    }
    const occupied = new Set();
    for (const list of byPos.values()) {
      if (list.length < 2) continue;
      for (let i = 1; i < list.length; i++) union(list[0].k, list[i].k);
      for (const it of list) if (it.hole && list.some((o) => o.part !== it.part)) occupied.add(it.k);
    }
    for (const w of project.wires) {
      const ka = w.a.part + ':' + w.a.pin, kb = w.b.part + ':' + w.b.pin;
      if (!parent.has(ka) || !parent.has(kb)) continue;
      union(ka, kb);
      occupied.add(ka); occupied.add(kb);
    }
    const nodeOf = new Map();
    const rootIdx = new Map([[find('GND0'), 0]]);
    const nets = [[]];
    let n = 1;
    for (const k of parent.keys()) {
      if (k === 'GND0') continue;
      const r = find(k);
      let idx = rootIdx.get(r);
      if (idx === undefined) { idx = n++; rootIdx.set(r, idx); nets.push([]); }
      nodeOf.set(k, idx);
      nets[idx].push(k);
    }
    return { nodeOf, nodeCount: n, nets, occupied };
  }

  // ------------------------------------------------------------------
  // Nodal analysis. Every element is reduced to conductances and
  // current injections (voltage sources use their Norton equivalent).
  // LEDs are piecewise-linear (off, or Vf + series resistance) and
  // solved iteratively. PWM is averaged over 16 phases.
  // ------------------------------------------------------------------
  function gauss(A, b, n) {
    for (let k = 0; k < n; k++) {
      let piv = k, max = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > max) { max = v; piv = i; } }
      if (max < 1e-30) continue;
      if (piv !== k) {
        for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[piv * n + j]; A[piv * n + j] = t; }
        const t = b[k]; b[k] = b[piv]; b[piv] = t;
      }
      const d = A[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i * n + k] / d;
        if (f === 0) continue;
        for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
        b[i] -= f * b[k];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
      const d = A[i * n + i];
      x[i] = Math.abs(d) < 1e-30 ? 0 : s / d;
    }
    return x;
  }

  const srcV = (e, phase) => (e.duty != null ? (phase < e.duty ? e.v : 0) : e.v);
  // Source voltage at time t (s). shape: 1 sine, 2 square, 3 triangle, 4 sawtooth; PWM uses freq.
  const frac = (x) => x - Math.floor(x);
  function srcAt(e, t) {
    switch (e.shape | 0) {
      case 1: return e.v + e.amp * Math.sin(2 * Math.PI * e.freq * t);
      case 2: return e.v + (frac(t * e.freq) < 0.5 ? e.amp : -e.amp);
      case 3: { const p = frac(t * e.freq); return e.v + e.amp * (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4); }
      case 4: return e.v + e.amp * (2 * frac(t * e.freq) - 1);
      default:
        if (e.duty != null) return frac(t * (e.freq > 0 ? e.freq : 490)) < e.duty ? e.v : 0;
        return e.v;
    }
  }
  // m: { phase } for a DC solve, { t, dt } for one transient step.
  const value = (e, m) => (m.dt ? srcAt(e, m.t) : srcV(e, m.phase));

  const rwOf = (e) => Math.max(1e-3, e.rw || 0);
  // Discretised derivative of a capacitor voltage / inductor current y (same as wb-core's
  // companion()): X·dy/dt ≈ g·y_new − hist. BDF2 (Gear-2) from the last two values y, y1;
  // backward Euler when y1 is unknown (first step, or after the time step changed).
  function companion(x, y, y1, dt) {
    y = y || 0;
    if (Number.isFinite(y1)) { const h = x / (2 * dt); return [3 * h, h * (4 * y - y1)]; }
    const g = x / dt;
    return [g, g * y];
  }
  function assemble(N, els, m) {
    const n = N - 1;
    const V = new Float64Array(N);
    if (n <= 0) return V;
    const A = new Float64Array(n * n), b = new Float64Array(n);
    const g2 = (p, q, g) => {
      if (p > 0) A[(p - 1) * n + p - 1] += g;
      if (q > 0) A[(q - 1) * n + q - 1] += g;
      if (p > 0 && q > 0) { A[(p - 1) * n + q - 1] -= g; A[(q - 1) * n + p - 1] -= g; }
    };
    const inj = (p, q, cur) => { if (p > 0) b[p - 1] += cur; if (q > 0) b[q - 1] -= cur; };
    for (let i = 0; i < n; i++) A[i * n + i] += 1e-9;
    for (const e of els) {
      if ((e.cond && !e.cOn) || e.off) continue;
      if (e.t === 'R') g2(e.ca, e.cb, 1 / e.r);
      else if (e.t === 'G') {
        // voltage-controlled current source: i(a→b) = gm·(V[p] − V[q]) + i0
        const a = e.ca - 1, b2 = e.cb - 1, p = e.cp - 1, q = e.cq - 1;
        if (a >= 0) { if (p >= 0) A[a * n + p] += e.gm; if (q >= 0) A[a * n + q] -= e.gm; b[a] -= e.i0 || 0; }
        if (b2 >= 0) { if (p >= 0) A[b2 * n + p] -= e.gm; if (q >= 0) A[b2 * n + q] += e.gm; b[b2] += e.i0 || 0; }
      }
      else if (e.t === 'V') { const g = 1 / e.r; g2(e.ca, e.cb, g); inj(e.ca, e.cb, value(e, m) * g); }
      else if (e.t === 'C') {
        if (m.dt) { const [g, hist] = companion(e.c, e.vc, e.vc1, m.dt); g2(e.ca, e.cb, g); inj(e.ca, e.cb, hist); }
        else g2(e.ca, e.cb, 1e-9);
      }
      else if (e.t === 'D') {
        if (e.on) { const g = 1 / e.rs; g2(e.ca, e.cb, g); inj(e.ca, e.cb, e.vf * g); }
        else if (e.rev) { const g = 1 / e.rs; g2(e.ca, e.cb, g); inj(e.ca, e.cb, -e.vz * g); } // zener breakdown
        else g2(e.ca, e.cb, 1e-9);
      }
      else if (e.t === 'L') {
        // v = Rw·i + L·di/dt with L·di/dt ≈ k·i − hist  =>  i = g·v + g·hist; a short through Rw in DC
        if (m.dt) { const [k, hist] = companion(e.l, e.il, e.il1, m.dt), g = 1 / (rwOf(e) + k); g2(e.ca, e.cb, g); inj(e.ca, e.cb, -g * hist); }
        else g2(e.ca, e.cb, 1 / rwOf(e));
      }
    }
    const x = gauss(A, b, n);
    for (let i = 0; i < n; i++) V[i + 1] = x[i];
    return V;
  }

  function current(e, V, m) {
    if ((e.cond && !e.cOn) || e.off) return 0;
    const vd = V[e.ca] - V[e.cb];
    if (e.t === 'G') return e.gm * (V[e.cp] - V[e.cq]) + (e.i0 || 0);
    if (e.t === 'R') return vd / e.r;
    if (e.t === 'V') return (value(e, m) - vd) / e.r;
    if (e.t === 'C') { if (!m.dt) return 0; const [g, hist] = companion(e.c, e.vc, e.vc1, m.dt); return g * vd - hist; }
    if (e.t === 'D') return e.on ? (vd - e.vf) / e.rs : e.rev ? (vd + e.vz) / e.rs : 0;
    if (e.t === 'L') { if (!m.dt) return vd / rwOf(e); const [k, hist] = companion(e.l, e.il, e.il1, m.dt); return (vd + hist) / (rwOf(e) + k); }
    return 0;
  }

  // Solve one operating point, iterating diode states until they settle (same as wb-core).
  // Behavioural parts (transistors, op-amps, logic chips) re-decide their state in e.upd(v),
  // where v(node) reads a node voltage; e.commit(v) runs once per solved point (clock edges).
  let curMap = null;
  const reader = (V) => (node) => { if (node === 0) return 0; const c = node > 0 && curMap ? curMap.get(node) : undefined; return c === undefined ? 0 : V[c] || 0; };
  function commitAll(nl, V) { let rd = null; for (const e of nl) if (e.commit) e.commit(rd || (rd = reader(V))); }
  function solvePoint(N, els, nl, m, maxIter) {
    let V = assemble(N, els, m);
    for (let it = 0; it < maxIter; it++) {
      let changed = false;
      let rd = null;
      for (const e of nl) {
        if (e.upd && e.upd(rd || (rd = reader(V)), m)) changed = true;
        if (e.t === 'D') {
          const vd = V[e.ca] - V[e.cb], on = vd > e.vf, rev = e.vz > 0 && -vd > e.vz;
          if (on !== !!e.on || rev !== !!e.rev) { e.on = on; e.rev = rev; changed = true; }
        }
        if (e.cond) { const on = V[e.cc1] - V[e.cc2] >= e.cond.min; if (on !== !!e.cOn) { e.cOn = on; changed = true; } }
      }
      if (!changed) break;
      V = assemble(N, els, m);
    }
    return V;
  }

  // Which nodes have a conductive path to ground (others are floating)? Capacitors count.
  function reachable(N, els) {
    const adj = Array.from({ length: N }, () => []);
    for (const e of els) {
      const conductive = e.off ? false : e.t === 'R' ? e.r < 1e7 : e.t === 'V' ? !(e.cond && !e.cOn) : e.t === 'D' ? e.on || e.rev : e.t === 'C' || e.t === 'L';
      if (conductive) { adj[e.ca].push(e.cb); adj[e.cb].push(e.ca); }
    }
    const reach = new Uint8Array(N);
    const stack = [0];
    reach[0] = 1;
    while (stack.length) { const u = stack.pop(); for (const v of adj[u]) if (!reach[v]) { reach[v] = 1; stack.push(v); } }
    return reach;
  }

  function solveNetwork(N, els) {
    const nl = els.filter((e) => e.t === 'D' || e.cond || e.upd || e.commit);
    const pwm = els.some((e) => e.duty != null && e.duty > 0 && e.duty < 1);
    const K = pwm ? 16 : 1;
    const Vavg = new Float64Array(N);
    const phases = [];
    for (const e of els) { e.i = 0; e.ipk = 0; e.i2 = 0; }
    for (let k = 0; k < K; k++) {
      const m = { phase: (k + 0.5) / K };
      const V = solvePoint(N, els, nl, m, 60);
      commitAll(nl, V);
      for (const e of els) {
        const i = current(e, V, m);
        e.i += i / K;
        e.i2 += (i * i) / K;
        if (Math.abs(i) > Math.abs(e.ipk)) e.ipk = i;
      }
      for (let j = 0; j < N; j++) Vavg[j] += V[j] / K;
      if (K > 1) phases.push(V);
    }
    return { V: Vavg, reach: reachable(N, els), phases };
  }

  // Time-domain run (BDF2), the same algorithm as wb-core's transient().
  // Capacitor voltages / inductor currents (e.vc / e.il, and e.vc1 / e.il1 one step earlier)
  // carry the state; samples = flat [t, V(probe)...] every decim steps.
  function transientNetwork(N, els, t0, dt, steps, probes, decim) {
    const nl = els.filter((e) => e.t === 'D' || e.cond || e.upd || e.commit);
    steps = Math.max(1, steps); decim = Math.max(1, decim);
    const Vavg = new Float64Array(N);
    const samples = [];
    for (const e of els) { e.i = 0; e.ipk = 0; e.i2 = 0; }
    const w = 1 / steps;
    for (let k = 0; k < steps; k++) {
      const m = { t: t0 + (k + 1) * dt, dt };
      const V = solvePoint(N, els, nl, m, 30);
      commitAll(nl, V);
      for (const e of els) {
        const i = current(e, V, m);
        e.i += i * w;
        e.i2 += i * i * w;
        if (Math.abs(i) > Math.abs(e.ipk)) e.ipk = i;
        if (e.t === 'C') { e.vc1 = e.vc || 0; e.vc = V[e.ca] - V[e.cb]; }
        else if (e.t === 'L') { e.il1 = e.il || 0; e.il = i; }
      }
      for (let j = 0; j < N; j++) Vavg[j] += V[j] * w;
      if ((k + 1) % decim === 0) { samples.push(m.t); for (const p of probes) samples.push(V[p] || 0); }
    }
    return { V: Vavg, reach: reachable(N, els), samples };
  }

  function solve(topo, project, sim, opts) {
    opts = opts || {};
    let next = topo.nodeCount;
    const els = [];
    const partEls = {};
    const nodeFn = (part) => (pin) => { const v = topo.nodeOf.get(part.id + ':' + pin); return v === undefined ? -1 : v; };
    for (const part of project.parts) {
      const def = WB.PARTS[part.type];
      if (!def || !def.elements) continue;
      const state = sim.partState[part.id] || (sim.partState[part.id] = {});
      const ctx = { part, props: part.props || {}, sim, state, ui: (opts.transient && opts.transient[part.id]) || {}, n: nodeFn(part), newNode: () => next++ };
      const list = (def.elements(ctx) || []).filter((e) => e.a >= 0 && e.b >= 0 && e.a !== undefined && e.b !== undefined && !(e.cond && (e.cond.a < 0 || e.cond.b < 0)) && !(e.t === 'G' && (!(e.p >= 0) || !(e.q >= 0))));
      for (const e of list) { e.part = part.id; els.push(e); }
      partEls[part.id] = list;
    }
    // Compact node numbering (only nodes touched by an element)
    const map = new Map([[0, 0]]);
    const cn = (node) => { let c = map.get(node); if (c === undefined) { c = map.size; map.set(node, c); } return c; };
    for (const e of els) {
      e.ca = cn(e.a); e.cb = cn(e.b);
      if (e.cond) { e.cc1 = cn(e.cond.a); e.cc2 = cn(e.cond.b); }
      if (e.t === 'G') { e.cp = cn(e.p); e.cq = cn(e.q); }
      if (e.w) for (const node of e.w) if (node >= 0) cn(node);
    }
    const N = map.size;
    curMap = map;
    // the Rust solver handles R, V, D, C, L; behavioural parts use the JavaScript solver
    const behavioural = els.some((e) => e.t === 'G' || e.upd || e.commit || e.off !== undefined);
    const native = WB.Native && WB.Native.ready && WB.Native.transient && !opts.forceJS && !behavioural;
    // Circuits with capacitors or function generators are simulated through time.
    const an = opts.analog;
    const timeDomain = !!an && els.some((e) => e.t === 'C' || e.t === 'L' || e.shape);
    let cV, reach, cPh = null, analog = null;
    if (timeDomain) {
      // Time step: fine enough for the scope's screen and for every waveform in the circuit.
      let dt = an.res || 1e-3;
      for (const e of els) {
        if (e.shape && e.freq > 0) dt = Math.min(dt, 1 / e.freq / 100);
        else if (e.duty != null && e.duty > 0 && e.duty < 1) dt = Math.min(dt, 1 / (e.freq || 490) / 50);
      }
      dt = WB.clamp(dt, 1e-7, 1e-3);
      // Steps per call are limited so the UI stays smooth; if that is not enough
      // to keep up with real time, the analog part runs in slow motion.
      const budget = N <= 12 ? 4000 : N <= 25 ? 2000 : 800;
      const elapsed = WB.clamp(an.elapsed || 0, 0, 0.05);
      const steps = WB.clamp(Math.ceil(elapsed / dt - 1e-9), 1, budget);
      const decim = an.fine ? 1 : Math.max(1, Math.round((an.res || dt) / dt));
      const probes = (an.probes || []).map((node) => (node === 0 ? 0 : map.get(node) || 0));
      // BDF2 history (vc1 / il1) is only valid with the same time step as last time
      for (const e of els) {
        const same = !!e.st && e.st.dt === dt;
        if (e.t === 'C') { e.vc = (e.st && e.st.vc) || 0; e.vc1 = same ? e.st.vc1 : NaN; }
        else if (e.t === 'L') { e.il = (e.st && e.st.il) || 0; e.il1 = same ? e.st.il1 : NaN; }
      }
      const r = native ? WB.Native.transient(N, els, an.t, dt, steps, probes, decim) : transientNetwork(N, els, an.t, dt, steps, probes, decim);
      for (const e of els) {
        if (!e.st) continue;
        if (e.t === 'C') { e.st.vc = e.vc; e.st.vc1 = e.vc1; e.st.dt = dt; }
        else if (e.t === 'L') { e.st.il = e.il; e.st.il1 = e.il1; e.st.dt = dt; }
      }
      an.t += steps * dt;
      cV = r.V; reach = r.reach;
      analog = { samples: r.samples, nProbes: probes.length, dt, steps, speed: elapsed > 0 ? Math.min(1, (steps * dt) / elapsed) : 1 };
    } else {
      ({ V: cV, reach, phases: cPh } = native ? WB.Native.solve(N, els) : solveNetwork(N, els));
    }
    // PWM waveform of a node (for the oscilloscope): { hi, lo, duty, periodMs } or null when the node is steady.
    // Frequency of a node's waveform = that of the nearest PWM source (breadth-first over the circuit).
    const pwmEls = els.filter((e) => e.duty != null && e.duty > 0 && e.duty < 1);
    let adj = null;
    const nodeFreq = (c) => {
      if (!pwmEls.length) return 490;
      if (!adj) {
        adj = Array.from({ length: N }, () => []);
        for (const e of els) { if (e.t === 'R' && e.r > 1e5) continue; adj[e.ca].push(e); adj[e.cb].push(e); }
      }
      const seen = new Uint8Array(N);
      let frontier = [c];
      seen[c] = 1;
      while (frontier.length) {
        const next = [];
        for (const u of frontier) for (const e of adj[u]) {
          if (e.duty != null && e.duty > 0 && e.duty < 1) return e.freq || 490;
          const v = e.ca === u ? e.cb : e.ca;
          if (v !== 0 && !seen[v]) { seen[v] = 1; next.push(v); }
        }
        frontier = next;
      }
      return pwmEls[0].freq || 490;
    };
    const wave = (node) => {
      const c = node === 0 ? 0 : map.get(node);
      if (!cPh || !cPh.length || c === undefined) return null;
      const periodMs = 1000 / nodeFreq(c);
      let hi = -Infinity, lo = Infinity;
      for (const ph of cPh) { hi = Math.max(hi, ph[c]); lo = Math.min(lo, ph[c]); }
      if (hi - lo < 0.02) return null;
      const mid = (hi + lo) / 2;
      const duty = cPh.filter((ph) => ph[c] > mid).length / cPh.length;
      return { hi, lo, duty, periodMs };
    };
    const V = new Float64Array(next);
    const floating = new Set();
    for (let node = 1; node < next; node++) {
      const c = map.get(node);
      if (c === undefined) { floating.add(node); continue; }
      V[node] = cV[c];
      if (!reach[c]) floating.add(node);
    }
    const warnings = [];
    const vis = {};
    const boardId = opts.boardId;
    for (const part of project.parts) {
      const def = WB.PARTS[part.type];
      if (!def || !def.visualize) continue;
      const n = nodeFn(part);
      const ctx = {
        part, name: part.name || def.label, props: part.props || {}, sim, state: sim.partState[part.id], els: partEls[part.id] || [], n,
        V: (pin) => { const k = n(pin); return k > 0 ? V[k] : 0; },
        boardNode: (pinName) => { if (!boardId) return -2; const v = topo.nodeOf.get(boardId + ':' + pinName); return v === undefined ? -2 : v; },
        warn: (m) => warnings.push(m),
      };
      vis[part.id] = def.visualize(ctx) || {};
    }
    return { V, floating, vis, warnings, elements: els, wave, analog };
  }

  WB.Circuit = { build, solve, solveNetwork, transientNetwork, srcAt };
})(window.WB);

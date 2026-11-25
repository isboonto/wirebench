'use strict';
// More parts: motors, lamps, relays, displays (7-segment, bar graph, LCD, NeoPixel), keypads,
// DIP switches, IR remote, extra sensors, transistors, MOSFETs, regulators, optocoupler and
// chips (555, op-amps, 74HC logic, 74HC595, CD4511, L293D).
//
// Transistors and chips are behavioural: their elements carry an upd(v) function that the
// solver calls while it iterates (v(node) reads a node voltage) to pick the element's state
// (off / active / saturated, output high / low ...). commit(v) runs once per solved point and
// is used for clock edges and latches.
(function (WB) {
  const LEG = WB.LEG;
  const T = (x, y, s, txt, fill, extra) => `<text x="${x}" y="${y}" font-size="${s}" text-anchor="middle" fill="${fill}" font-family="sans-serif"${extra || ''}>${txt}</text>`;
  const legs = (xs, y0, y1) => xs.map((x) => `<path d="M${x},${y0} V${y1}" ${LEG}/>`).join('');
  const clamp = WB.clamp;

  // ---------------------------------------------------------------- shared models
  // Push-pull logic output: a low element (OUT to GND) and a high element (OUT to VCC).
  // fn(v, sup) returns 1, 0 or null (output off / high impedance); unpowered chips float.
  function pushPull(c, out, vcc, gnd, fn, o) {
    o = o || {};
    const nO = c.n(out), nV = c.n(vcc), nG = c.n(gnd);
    const r = o.r || 25;
    const hiE = { t: 'V', a: nO, b: nV, v: -(o.dh != null ? o.dh : 0.05), r, off: true };
    const loE = { t: 'V', a: nO, b: nG, v: o.dl != null ? o.dl : 0.05, r, off: true };
    loE.upd = (v) => {
      const sup = v(nV) - v(nG);
      const lv = sup > (o.vmin || 2) ? fn(v, sup) : null;
      const h = lv === 1 || lv === true, l = lv === 0 || lv === false;
      if (hiE.off === !h && loE.off === !l) return false;
      hiE.off = !h; loE.off = !l;
      return true;
    };
    return [loE, hiE];
  }
  // Is an input pin high? (above half the chip's supply)
  const isHi = (v, c, pin, gnd, sup) => v(c.n(pin)) - v(c.n(gnd)) > sup / 2;

  // Collector–emitter path of a transistor (or the output of an optocoupler / phototransistor):
  // 'act' = controlled current source g, 'sat' = small voltage vsat, 'off'. from/to are the
  // nodes the current flows between (C→E for NPN, E→C for PNP); ic(v) is the current the control
  // side asks for.
  function ceSwitch(from, to, g, ic, vsat, rsat) {
    const s = { t: 'V', a: from, b: to, v: vsat, r: rsat, off: true, mode: 'off' };
    s.upd = (v) => {
      const i = ic(v), vce = v(from) - v(to);
      let mode = s.mode;
      if (i <= 1e-9) mode = 'off';
      else if (mode === 'sat') { if ((vce - vsat) / rsat > i) mode = 'act'; }
      else mode = vce < vsat ? 'sat' : 'act';
      if (mode === s.mode) return false;
      s.mode = mode; s.off = mode !== 'sat';
      if (g) g.off = mode !== 'act';
      return true;
    };
    return s;
  }
  function bjtEls(c, m, pol) {
    const B = c.n('B'), C = c.n('C'), E = c.n('E');
    const npn = pol > 0;
    const d = npn ? { t: 'D', a: B, b: E, vf: m.vf, rs: m.rs } : { t: 'D', a: E, b: B, vf: m.vf, rs: m.rs };
    const from = npn ? C : E, to = npn ? E : C;
    const g = { t: 'G', a: from, b: to, p: npn ? B : E, q: npn ? E : B, gm: m.beta / m.rs, i0: (-m.beta * m.vf) / m.rs, off: true };
    const ic = (v) => (m.beta * Math.max(0, (npn ? v(B) - v(E) : v(E) - v(B)) - m.vf)) / m.rs;
    return [d, g, ceSwitch(from, to, g, ic, m.vsat, m.rsat || 2)];
  }
  // MOSFET: off below Vth; above it either a resistor (Rds(on)) or a current source K·(Vgs−Vth),
  // whichever passes less current. Includes the body diode.
  function mosEls(c, m, pol) {
    const G = c.n('G'), D = c.n('D'), S = c.n('S');
    const n = pol > 0;
    const from = n ? D : S, to = n ? S : D;
    const g = { t: 'G', a: from, b: to, p: n ? G : S, q: n ? S : G, gm: m.k, i0: -m.k * m.vth, off: true };
    const r = { t: 'R', a: from, b: to, r: m.ron, off: true, mode: 'off' };
    r.upd = (v) => {
      const vgs = n ? v(G) - v(S) : v(S) - v(G);
      let mode = r.mode;
      if (vgs < m.vth) mode = 'off';
      else {
        const isat = m.k * (vgs - m.vth), vds = v(from) - v(to);
        if (mode === 'ohm') { if (vds / m.ron > isat) mode = 'sat'; }
        else mode = vds < isat * m.ron ? 'ohm' : 'sat';
      }
      if (mode === r.mode) return false;
      r.mode = mode; r.off = mode !== 'ohm'; g.off = mode !== 'sat';
      return true;
    };
    return [g, r, { t: 'D', a: to, b: from, vf: 0.8, rs: 0.05 }];
  }
  // Op-amp: linear (open-loop gain A, output resistance ro) or stuck at a rail.
  function opampEls(c, P, N, O, VP, VN, m) {
    const nP = c.n(P), nN = c.n(N), nO = c.n(O), nVP = c.n(VP), nVN = c.n(VN);
    const A = 1e5, ro = 50;
    const rl = { t: 'R', a: nO, b: 0, r: ro, off: true };
    const g = { t: 'G', a: 0, b: nO, p: nP, q: nN, gm: A / ro, i0: 0, off: true };
    const sh = { t: 'V', a: nO, b: nVP, v: -m.hr, r: ro, off: true };
    const sl = { t: 'V', a: nO, b: nVN, v: m.lr, r: ro, off: true, mode: 'dead' };
    sl.upd = (v) => {
      const vp = v(nVP), vn = v(nVN);
      let mode = sl.mode;
      if (vp - vn < 3) mode = 'dead';
      else {
        const vlin = A * (v(nP) - v(nN)), hiL = vp - m.hr, loL = vn + m.lr;
        if (mode === 'hi') { if (vlin < hiL) mode = 'lin'; }
        else if (mode === 'lo') { if (vlin > loL) mode = 'lin'; }
        else { const vo = mode === 'lin' ? v(nO) : vlin; mode = vo > hiL ? 'hi' : vo < loL ? 'lo' : 'lin'; }
      }
      if (mode === sl.mode) return false;
      sl.mode = mode;
      rl.off = g.off = mode !== 'lin'; sh.off = mode !== 'hi'; sl.off = mode !== 'lo';
      return true;
    };
    return [sl, rl, g, sh];
  }

  // ---------------------------------------------------------------- DIP chips
  // Pin 1 bottom-left; pins 1..n/2 along the bottom (y = 0), the rest along the top (y = −30)
  // right to left — so the chip straddles the breadboard's centre gap (rows e and f).
  function dipPins(n, labels) {
    const h = n / 2, pins = [];
    for (let k = 1; k <= n; k++) {
      const lb = labels[k - 1] || 'NC';
      const bottom = k <= h;
      pins.push({ id: String(k), label: `${k} · ${lb}`, x: bottom ? (k - 1) * 10 : (n - k) * 10, y: bottom ? 0 : -30, kind: /^(GND|VSS|V−)$/.test(lb) ? 'gnd' : /^(VCC|VDD|V\+|VCC1|VCC2)$/.test(lb) ? 'pwr' : undefined });
    }
    return pins;
  }
  function dipBody(n, title, sub) {
    const w = (n / 2 - 1) * 10, xs = [];
    for (let i = 0; i < n / 2; i++) xs.push(i * 10);
    return `${xs.map((x) => `<rect x="${x - 1.6}" y="-4" width="3.2" height="4" fill="#c8ccd2"/><rect x="${x - 1.6}" y="-30" width="3.2" height="4" fill="#c8ccd2"/>`).join('')}
      <rect x="-6" y="-27" width="${w + 12}" height="24" rx="2" fill="#26282c" stroke="#0b0b0b"/>
      <path d="M-6,-19 a4,4 0 0 1 0,8 z" fill="#0e0f11"/><circle cx="-1.5" cy="-7.5" r="1.4" fill="#5a5d63"/>
      ${T(w / 2, sub ? -15.5 : -13, 6.5, WB.esc(title), '#e6e8ec', ' font-family="monospace" font-weight="700"')}
      ${sub ? T(w / 2, -8, 4.2, WB.esc(sub), '#9aa0a8') : ''}`;
  }
  const dipBox = (n) => [-7, -33, (n / 2 - 1) * 10 + 14, 36];
  const chipQuiescent = (c, vcc, gnd, r) => ({ t: 'R', a: c.n(vcc), b: c.n(gnd), r: r || 100000 });
  function supplyWarn(c, vcc, gnd, max, what) {
    const s = c.V(vcc) - c.V(gnd);
    if (s > max) c.warn(`${c.name}: ${s.toFixed(1)} V on the supply pins — ${what} takes at most ${max} V.`);
    if (s < -0.5) c.warn(`${c.name}: the supply is connected backwards (VCC is below GND).`);
    return s;
  }

  // ---------------------------------------------------------------- Motors
  const MOTORS = {
    dc: { label: 'DC motor', r: 10, vr: 6, rpm: 9000 },
    gear: { label: 'Hobby gearmotor', r: 25, vr: 6, rpm: 200 },
  };
  const spin = new Map(); // part id → { a: angle, t: last time }
  function spinUpdate(p, g, app, mode) {
    const rot = g.querySelector('.rotor');
    if (!rot) return;
    const vis = app.results && app.results.vis[p.id];
    const now = performance.now();
    const s = spin.get(p.id) || { a: 0, t: now };
    const dt = Math.min(0.1, (now - s.t) / 1000);
    s.t = now;
    const rps = vis ? vis.rps || 0 : 0;
    if (mode === 'shake') {
      const k = Math.min(1, Math.abs(rps));
      rot.setAttribute('transform', k > 0.02 ? `translate(${((Math.random() - 0.5) * 3 * k).toFixed(2)},${((Math.random() - 0.5) * 3 * k).toFixed(2)})` : '');
    } else {
      // show a stroboscopic-looking but readable speed: cap the visible rotation rate
      s.a = (s.a + Math.sign(rps) * Math.min(Math.abs(rps), 3) * 360 * dt) % 360;
      const [cx, cy] = mode === 'gear' ? [-10, -30] : [10, -36];
      rot.setAttribute('transform', `rotate(${s.a.toFixed(1)} ${cx} ${cy})`);
    }
    spin.set(p.id, s);
  }
  WB.defPart('motor', {
    label: 'DC motor', category: 'Output', prefix: 'M', dynamic: true,
    defaults: { model: 'dc' },
    pins: () => [{ id: '+', label: '+ (red)', x: 0, y: 0 }, { id: '-', label: '− (black)', x: 20, y: 0 }],
    bbox: (pr) => (pr.model === 'gear' ? [-44, -62, 76, 65] : [-16, -64, 52, 67]),
    summary: (p) => `${(MOTORS[p.props.model] || MOTORS.dc).label}, ${(MOTORS[p.props.model] || MOTORS.dc).r} Ω`,
    inspector: [{ key: 'model', label: 'Type', type: 'select', options: Object.keys(MOTORS).map((k) => [k, `${MOTORS[k].label} (${MOTORS[k].vr} V, ${MOTORS[k].r} Ω)`]) }],
    elements: (c) => [{ t: 'R', a: c.n('+'), b: c.n('-'), r: (MOTORS[c.props.model] || MOTORS.dc).r }],
    visualize(c) {
      const m = MOTORS[c.props.model] || MOTORS.dc;
      const vd = c.V('+') - c.V('-');
      const rpm = Math.abs(vd) < 0.5 ? 0 : (vd / m.vr) * m.rpm;
      if (Math.abs(vd) > m.vr * 2) c.warn(`${c.name}: ${Math.abs(vd).toFixed(1)} V is far above the motor's ${m.vr} V rating.`);
      return { rpm: Math.round(rpm), rps: +(Math.sign(rpm) * Math.min(3, Math.abs(rpm) / 600 + (rpm ? 0.3 : 0))).toFixed(2) };
    },
    render(p, v) {
      const rpm = (v && v.rpm) || 0;
      const txt = rpm ? `${Math.abs(rpm)} rpm${rpm < 0 ? ' ↺' : ''}` : '';
      if (p.props.model === 'gear') {
        return `<path d="M0,0 V-10" stroke="#d62828" stroke-width="2"/><path d="M20,0 V-10" stroke="#222" stroke-width="2"/>
          <rect x="-4" y="-46" width="34" height="36" rx="4" fill="#f2c200" stroke="#a88500"/>
          <rect x="22" y="-40" width="10" height="24" rx="2" fill="#d8d8d8" stroke="#888"/>
          <g class="rotor"><circle cx="-10" cy="-30" r="22" fill="#2b2b2b" stroke="#111"/><circle cx="-10" cy="-30" r="15" fill="#f2c200" stroke="#a88500"/>
          <path d="M-10,-45 V-15 M-25,-30 H5" stroke="#a88500" stroke-width="2.5"/><circle cx="-10" cy="-30" r="3" fill="#555"/></g>
          ${T(13, -50, 6, txt, '#4a5566', ' font-family="monospace"')}`;
      }
      return `<path d="M0,0 V-12" stroke="#d62828" stroke-width="2"/><path d="M20,0 V-12" stroke="#222" stroke-width="2"/>
        <rect x="-8" y="-20" width="36" height="9" rx="2" fill="#d0d4da" stroke="#888"/>
        <circle cx="10" cy="-36" r="21" fill="#b8bec6" stroke="#6d747d"/><circle cx="10" cy="-36" r="15" fill="#9aa1aa"/>
        <g class="rotor"><path d="M10,-36 L10,-56 M10,-36 L27,-26 M10,-36 L-7,-26" stroke="#e8edf2" stroke-width="4" stroke-linecap="round"/><circle cx="10" cy="-36" r="4" fill="#555"/></g>
        ${T(10, -60, 6, txt, '#4a5566', ' font-family="monospace"')}`;
    },
    liveUpdate(p, g, app) { spinUpdate(p, g, app, p.props.model === 'gear' ? 'gear' : 'dc'); },
  });
  WB.defPart('vibmotor', {
    label: 'Vibration motor', category: 'Output', prefix: 'M', dynamic: true,
    pins: () => [{ id: '+', label: '+ (red)', x: 0, y: 0 }, { id: '-', label: '− (blue)', x: 10, y: 0 }],
    bbox: () => [-14, -42, 38, 45],
    summary: () => '3 V, 40 Ω',
    elements: (c) => [{ t: 'R', a: c.n('+'), b: c.n('-'), r: 40 }],
    visualize(c) { const vd = Math.abs(c.V('+') - c.V('-')); return { rps: vd < 0.8 ? 0 : +Math.min(1, vd / 3).toFixed(2) }; },
    render(p, v) {
      const on = v && v.rps > 0;
      return `<path d="M0,0 C0,-8 2,-10 2,-14" stroke="#d62828" stroke-width="1.6" fill="none"/><path d="M10,0 C10,-8 8,-10 8,-14" stroke="#2f5fd0" stroke-width="1.6" fill="none"/>
        <g class="rotor"><circle cx="5" cy="-27" r="13" fill="#c9ced6" stroke="#7b828c"/><circle cx="5" cy="-27" r="9" fill="#dfe3e8" stroke="#a0a6ae"/>
        ${T(5, -25, 5, 'VIB', '#59606a', ' font-weight="700"')}</g>
        ${on ? '<path d="M-12,-33 q-3,6 0,12 M22,-33 q3,6 0,12" stroke="#ffb020" stroke-width="1.4" fill="none"/>' : ''}`;
    },
    liveUpdate(p, g, app) { spinUpdate(p, g, app, 'shake'); },
  });

  // ---------------------------------------------------------------- Light bulb
  WB.defPart('bulb', {
    label: 'Light bulb', category: 'Output', prefix: 'LMP', dynamic: true,
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: '2', label: 'Pin 2', x: 20, y: 0 }],
    bbox: () => [-10, -54, 40, 57],
    summary: () => '6 V, 0.9 W (40 Ω)',
    elements: (c) => (c.state.burnt ? [] : [{ t: 'R', a: c.n('1'), b: c.n('2'), r: 40 }]),
    visualize(c) {
      if (c.state.burnt) return { burnt: true };
      const e = c.els[0];
      const pw = e ? (e.i2 || e.i * e.i) * 40 : 0;
      if (pw > 4) { c.state.burnt = true; c.warn(`${c.name} burned out (${pw.toFixed(1)} W). It is rated 6 V / 0.9 W.`); return { burnt: true }; }
      return { b: +clamp(Math.sqrt(pw / 0.9), 0, 1).toFixed(2) };
    },
    render(p, v) {
      v = v || {};
      const b = v.b || 0;
      const glass = v.burnt ? '#6d6a66' : WB.mix('#e9edf2', '#fff3b0', b);
      return `<path d="M0,0 V-10" ${LEG}/><path d="M20,0 V-10" ${LEG}/>
        ${b > 0.03 ? `<circle cx="10" cy="-34" r="${(14 + 14 * b).toFixed(1)}" fill="#ffd86b" opacity="${(0.15 + 0.6 * b).toFixed(2)}" filter="url(#wbGlow)"/>` : ''}
        <rect x="2" y="-18" width="16" height="9" rx="1.5" fill="#b9bec5" stroke="#737980"/><path d="M2,-15 h16 M2,-12 h16" stroke="#8b9097" stroke-width=".8"/>
        <path d="M3,-18 C-8,-28 -8,-50 10,-51 C28,-50 28,-28 17,-18 Z" fill="${glass}" fill-opacity=".9" stroke="#9aa0a8" stroke-width=".8"/>
        <path d="M7,-18 L6,-30 L9,-34 L11,-30 L14,-34 L13,-18" fill="none" stroke="${v.burnt ? '#333' : b > 0.03 ? '#ff9a2a' : '#777'}" stroke-width="${b > 0.03 ? 1.4 : 0.9}"/>`;
    },
  });

  // ---------------------------------------------------------------- Relay (5 V, SPDT)
  WB.defPart('relay', {
    label: 'Relay (5 V, SPDT)', category: 'Output', prefix: 'K', dynamic: true,
    pins: () => [
      { id: 'C1', label: 'Coil +', x: 0, y: 0 }, { id: 'C2', label: 'Coil −', x: 10, y: 0 },
      { id: 'COM', label: 'COM (common contact)', x: 30, y: 0 }, { id: 'NC', label: 'NC (connected to COM when off)', x: 40, y: 0 }, { id: 'NO', label: 'NO (connected to COM when the coil is on)', x: 50, y: 0 },
    ],
    bbox: () => [-7, -46, 64, 49],
    summary: () => '5 V coil (70 Ω), SPDT',
    elements(c) {
      return [{ t: 'R', a: c.n('C1'), b: c.n('C2'), r: 70 }, { t: 'R', a: c.n('COM'), b: c.n(c.state.on ? 'NO' : 'NC'), r: 0.05 }];
    },
    visualize(c) {
      const e = c.els.find((x) => x.a === c.n('C1') && x.b === c.n('C2'));
      const i = e ? Math.abs(e.i) : 0;
      const was = !!c.state.on;
      const on = was ? i > 0.02 : i > 0.045;
      if (on !== was) { c.state.on = on; return { on, again: true }; }
      return { on };
    },
    render(p, v) {
      const on = v && v.on;
      return `${legs([0, 10, 30, 40, 50], 0, -6)}
        <rect x="-6" y="-44" width="62" height="38" rx="2.5" fill="#2156b8" stroke="#123a80"/>
        ${T(25, -33, 6.5, 'RELAY 5V', '#e6eeff', ' font-weight="700"')}
        <path d="M2,-12 v-6 M8,-12 v-6" stroke="#cfe0ff" stroke-width="1"/><rect x="0" y="-26" width="10" height="8" rx="1" fill="none" stroke="#cfe0ff" stroke-width=".8"/>
        <circle cx="30" cy="-14" r="1.6" fill="#cfe0ff"/><circle cx="40" cy="-22" r="1.6" fill="#cfe0ff"/><circle cx="50" cy="-22" r="1.6" fill="#cfe0ff"/>
        <path d="M30,-14 L${on ? 50 : 40},-22" stroke="#ffd166" stroke-width="1.4"/>
        ${T(30, -8, 4, 'COM', '#cfe0ff')}${T(40, -26, 4, 'NC', '#cfe0ff')}${T(50, -26, 4, 'NO', '#cfe0ff')}
        <circle cx="50" cy="-38" r="2.2" fill="${on ? '#ff4040' : '#5a2020'}"/>`;
    },
  });

  // ---------------------------------------------------------------- 7-segment display
  const SEGC = { red: ['#ff3030', '#3a1515', 1.8], green: ['#3dff6a', '#163a20', 2.1], blue: ['#3f8cff', '#15204a', 3.0], yellow: ['#ffe640', '#3a3515', 2.0], white: ['#ffffff', '#3a3a40', 3.0] };
  const hSeg = (x1, x2, y, t) => `${x1},${y} ${x1 + t / 2},${y - t / 2} ${x2 - t / 2},${y - t / 2} ${x2},${y} ${x2 - t / 2},${y + t / 2} ${x1 + t / 2},${y + t / 2}`;
  const vSeg = (x, y1, y2, t) => `${x},${y1} ${x + t / 2},${y1 + t / 2} ${x + t / 2},${y2 - t / 2} ${x},${y2} ${x - t / 2},${y2 - t / 2} ${x - t / 2},${y1 + t / 2}`;
  const SEG_SHAPES = {
    a: hSeg(10, 30, -50, 4), g: hSeg(10, 30, -31, 4), d: hSeg(10, 30, -12, 4),
    f: vSeg(9, -49, -32, 4), b: vSeg(31, -49, -32, 4), e: vSeg(9, -30, -13, 4), c: vSeg(31, -30, -13, 4),
  };
  WB.SEG_SHAPES = SEG_SHAPES;
  WB.defPart('sevenseg', {
    label: '7-segment display', category: 'Displays', prefix: 'DS', dynamic: true,
    defaults: { common: 'cathode', color: 'red' },
    pins: (pr) => {
      const com = pr.common === 'anode' ? 'Common anode (+)' : 'Common cathode (−)';
      return [
        { id: 'e', label: 'Segment E', x: 0, y: 0 }, { id: 'd', label: 'Segment D', x: 10, y: 0 }, { id: 'COM', label: com, x: 20, y: 0 },
        { id: 'c', label: 'Segment C', x: 30, y: 0 }, { id: 'DP', label: 'Decimal point', x: 40, y: 0 },
        { id: 'g', label: 'Segment G', x: 0, y: -60 }, { id: 'f', label: 'Segment F', x: 10, y: -60 }, { id: 'COM2', label: com, x: 20, y: -60 },
        { id: 'a', label: 'Segment A', x: 30, y: -60 }, { id: 'b', label: 'Segment B', x: 40, y: -60 },
      ];
    },
    groups: () => [['COM', 'COM2']],
    bbox: () => [-6, -62, 52, 64],
    summary: (p) => `common ${p.props.common}, ${p.props.color}`,
    inspector: [
      { key: 'common', label: 'Type', type: 'select', options: [['cathode', 'Common cathode (COM to GND)'], ['anode', 'Common anode (COM to +5 V)']] },
      { key: 'color', label: 'Color', type: 'select', options: Object.keys(SEGC) },
    ],
    elements(c) {
      const an = c.props.common === 'anode', vf = (SEGC[c.props.color] || SEGC.red)[2];
      return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'DP'].map((s) => ({ t: 'D', a: an ? c.n('COM') : c.n(s), b: an ? c.n(s) : c.n('COM'), vf, rs: 20, tag: s }));
    },
    visualize(c) {
      const out = {};
      for (const e of c.els) {
        if (e.i > 0.04) c.warn(`${c.name}: ${Math.round(e.i * 1000)} mA through segment ${e.tag} — use a 220 Ω–1 kΩ resistor on each segment pin.`);
        const b = clamp(Math.sqrt(Math.max(0, e.i) / 0.01), 0, 1);
        if (b > 0.02) out[e.tag] = +b.toFixed(2);
      }
      return out;
    },
    render(p, v) {
      v = v || {};
      const [on, off] = SEGC[p.props.color] || SEGC.red;
      let s = '';
      for (const k in SEG_SHAPES) {
        const b = v[k] || 0;
        s += `<polygon points="${SEG_SHAPES[k]}" fill="${b ? WB.mix(off, on, 0.35 + 0.65 * b) : off}"/>`;
      }
      const dp = v.DP || 0;
      return `${legs([0, 10, 20, 30, 40], 0, -4)}${legs([0, 10, 20, 30, 40], -60, -56)}
        <rect x="-5" y="-57" width="50" height="53" rx="2" fill="#1b1c1f" stroke="#000"/>
        ${Object.keys(SEG_SHAPES).some((k) => v[k]) || dp ? `<rect x="2" y="-55" width="36" height="49" fill="${on}" opacity=".12" filter="url(#wbGlow)"/>` : ''}
        <g transform="skewX(-6) translate(-3,0)">${s}</g>
        <circle cx="37" cy="-11" r="2.4" fill="${dp ? WB.mix(off, on, 0.35 + 0.65 * dp) : off}"/>`;
    },
  });

  // ---------------------------------------------------------------- LED bar graph (10 segments)
  WB.defPart('bargraph', {
    label: 'LED bar graph', category: 'Displays', prefix: 'BAR', dynamic: true,
    defaults: { color: 'red' },
    pins: () => {
      const pins = [];
      for (let i = 1; i <= 10; i++) pins.push({ id: 'A' + i, label: `Anode ${i} (+)`, x: (i - 1) * 10, y: 0 });
      for (let i = 1; i <= 10; i++) pins.push({ id: 'K' + i, label: `Cathode ${i} (−)`, x: (i - 1) * 10, y: -30 });
      return pins;
    },
    bbox: () => [-6, -33, 102, 36],
    summary: (p) => '10 LEDs, ' + p.props.color,
    inspector: [{ key: 'color', label: 'Color', type: 'select', options: Object.keys(SEGC) }],
    elements(c) {
      const vf = (SEGC[c.props.color] || SEGC.red)[2];
      const out = [];
      for (let i = 1; i <= 10; i++) out.push({ t: 'D', a: c.n('A' + i), b: c.n('K' + i), vf, rs: 20, tag: i });
      return out;
    },
    visualize(c) {
      const out = {};
      for (const e of c.els) {
        if (e.i > 0.04) c.warn(`${c.name}: ${Math.round(e.i * 1000)} mA through LED ${e.tag} — add a resistor on each LED.`);
        const b = clamp(Math.sqrt(Math.max(0, e.i) / 0.01), 0, 1);
        if (b > 0.02) out['L' + e.tag] = +b.toFixed(2);
      }
      return out;
    },
    render(p, v) {
      v = v || {};
      const [on, off] = SEGC[p.props.color] || SEGC.red;
      let s = '';
      for (let i = 1; i <= 10; i++) {
        const b = v['L' + i] || 0, x = (i - 1) * 10;
        if (b) s += `<rect x="${x - 4}" y="-25" width="8" height="20" fill="${on}" opacity="${(0.2 + 0.4 * b).toFixed(2)}" filter="url(#wbGlow)"/>`;
        s += `<rect x="${x - 2.6}" y="-23" width="5.2" height="16" rx=".6" fill="${b ? WB.mix(off, on, 0.35 + 0.65 * b) : off}"/>`;
      }
      const xs = Array.from({ length: 10 }, (_, i) => i * 10);
      return `${legs(xs, 0, -3)}${legs(xs, -30, -27)}<rect x="-5" y="-27" width="100" height="24" rx="1.5" fill="#1b1c1f" stroke="#000"/>${s}`;
    },
  });

  // ---------------------------------------------------------------- LCD 16x2 (HD44780)
  const LCD_PAR = ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'];
  const LCD_PAR_LBL = { VSS: 'VSS (GND)', VDD: 'VDD (+5 V)', V0: 'V0 (contrast)', RS: 'RS (register select)', RW: 'RW (read/write — tie to GND)', E: 'E (enable)', A: 'A (backlight +, via 220 Ω)', K: 'K (backlight −)' };
  const LCD_I2C = [['GND', 'GND'], ['VCC', 'VCC (+5 V)'], ['SDA', 'SDA — I2C data'], ['SCL', 'SCL — I2C clock']];
  const LCD_COL = { green: { bg: '#9fc93c', bg2: '#86ad2c', px: '#1f2a0a', off: '#93bb36' }, blue: { bg: '#2f5fd0', bg2: '#244fae', px: '#f2f6ff', off: '#3a68d6' } };
  WB.defPart('lcd', {
    label: 'LCD 16×2', category: 'Displays', prefix: 'LCD', dynamic: true,
    defaults: { iface: 'parallel', color: 'green' },
    pins: (pr) => (pr.iface === 'i2c'
      ? LCD_I2C.map(([id, label], i) => ({ id, label, x: i * 10, y: 0, kind: id === 'GND' ? 'gnd' : id === 'VCC' ? 'pwr' : undefined }))
      : LCD_PAR.map((id, i) => ({ id, label: LCD_PAR_LBL[id] || id, x: i * 10, y: 0, kind: id === 'VSS' ? 'gnd' : id === 'VDD' ? 'pwr' : undefined }))),
    bbox: () => [-85, -152, 322, 155],
    summary: (p) => (p.props.iface === 'i2c' ? 'I2C (LiquidCrystal_I2C, address 0x27)' : 'parallel (LiquidCrystal)'),
    inspector: [
      { key: 'iface', label: 'Interface', type: 'select', options: [['parallel', 'Parallel — 16 pins (LiquidCrystal)'], ['i2c', 'I2C backpack — 4 pins (LiquidCrystal_I2C)']] },
      { key: 'color', label: 'Screen', type: 'select', options: [['green', 'Yellow-green, dark text'], ['blue', 'Blue, white text']] },
    ],
    elements(c) {
      if (c.props.iface === 'i2c') return [{ t: 'R', a: c.n('VCC'), b: c.n('GND'), r: 200 }];
      return [{ t: 'R', a: c.n('VDD'), b: c.n('VSS'), r: 5000 }, { t: 'D', a: c.n('A'), b: c.n('K'), vf: 3.0, rs: 10 }];
    },
    visualize(c) {
      const i2c = c.props.iface === 'i2c';
      const powered = i2c ? c.V('VCC') - c.V('GND') > 4 : c.V('VDD') - c.V('VSS') > 4;
      const st = c.sim.lcd && c.sim.lcd[c.part.id];
      let bl;
      if (i2c) bl = powered && (!st || st.bl) ? 1 : 0;
      else { const d = c.els.find((e) => e.t === 'D'); bl = d ? +clamp(Math.sqrt(Math.max(0, d.i) / 0.015), 0, 1).toFixed(2) : 0; if (d && d.i > 0.06) c.warn(`${c.name}: ${Math.round(d.i * 1000)} mA through the backlight — put a 220 Ω resistor in series with pin A.`); }
      if (!powered || !st) return { powered, bl };
      const rows = [];
      for (let r = 0; r < 2; r++) { const line = st.buf[r]; const out = []; for (let k = 0; k < 16; k++) out.push(line[(k + st.shift + 40 * 4) % 40]); rows.push(out); }
      const used = {};
      for (const row of rows) for (const ch of row) if (ch < 8 && st.custom[ch]) used[ch] = st.custom[ch];
      return { powered, bl, on: st.disp, rows, custom: used, cur: st.cur || st.blink ? [st.cx - st.shift, st.cy] : null };
    },
    render(p, v) {
      v = v || {};
      const col = LCD_COL[p.props.color] || LCD_COL.green;
      const i2c = p.props.iface === 'i2c';
      const lit = v.bl || 0;
      const bg = WB.mix('#4c5a2a', col.bg, 0.25 + 0.75 * lit);
      let chars = '';
      const x0 = -50, cw = 15, y0 = [-116, -88];
      if (v.powered && v.on !== false && v.rows) {
        for (let r = 0; r < 2; r++) for (let k = 0; k < 16; k++) {
          const ch = v.rows[r][k], x = x0 + k * cw, y = y0[r];
          const pat = ch < 8 && v.custom && v.custom[ch];
          if (pat) {
            for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 5; xx++) if ((pat[yy] >> (4 - xx)) & 1) chars += `<rect x="${x + 1 + xx * 2.4}" y="${y + yy * 2.6}" width="2.1" height="2.3" fill="${col.px}"/>`;
          } else if (ch > 32 && ch < 256) chars += `<text x="${x + 6.5}" y="${y + 17}" font-size="18" text-anchor="middle" fill="${col.px}" font-family="'Courier New', monospace" font-weight="700">${WB.esc(String.fromCharCode(ch === 223 ? 176 : ch))}</text>`;
          if (v.cur && v.cur[0] === k && v.cur[1] === r) chars += `<rect x="${x + 0.5}" y="${y + 19}" width="12" height="2" fill="${col.px}"/>`;
        }
      }
      let cells = '';
      if (v.powered) for (let r = 0; r < 2; r++) for (let k = 0; k < 16; k++) cells += `<rect x="${x0 + k * cw}" y="${y0[r]}" width="13" height="21" fill="${col.off}" opacity="${(0.25 + 0.3 * lit).toFixed(2)}"/>`;
      const pins = i2c ? [0, 10, 20, 30] : LCD_PAR.map((_, i) => i * 10);
      const lbls = i2c ? LCD_I2C.map((x) => x[0]) : LCD_PAR;
      return `${legs(pins, 0, -6)}
        <rect x="-84" y="-150" width="320" height="144" rx="5" fill="#1d6b3a" stroke="#0f3d20"/>
        <circle cx="-74" cy="-140" r="4" fill="#0f3d20" stroke="#c9a227"/><circle cx="226" cy="-140" r="4" fill="#0f3d20" stroke="#c9a227"/>
        <circle cx="-74" cy="-16" r="4" fill="#0f3d20" stroke="#c9a227"/><circle cx="226" cy="-16" r="4" fill="#0f3d20" stroke="#c9a227"/>
        <rect x="-66" y="-136" width="284" height="92" rx="3" fill="#202326"/>
        <rect x="-58" y="-126" width="268" height="72" rx="2" fill="${bg}" stroke="${col.bg2}"/>
        ${lit > 0.05 ? `<rect x="-58" y="-126" width="268" height="72" fill="${col.bg}" opacity="${(0.25 * lit).toFixed(2)}" filter="url(#wbGlow)"/>` : ''}
        ${cells}${chars}
        ${i2c ? `<rect x="-8" y="-36" width="46" height="30" rx="2" fill="#1d1d1f" stroke="#000"/><rect x="2" y="-32" width="16" height="10" fill="#2f5fd0"/>${T(15, -14, 5, 'I2C 0x27', '#ccc')}` : ''}
        ${lbls.map((l, i) => T(i * 10, -9, l.length > 2 ? 3.4 : 4.2, l, '#d8f0dc')).join('')}
        ${!v.powered ? T(76, -88, 9, 'no power — wire VDD / VSS', '#c8d0b0') : ''}`;
    },
  });

  // ---------------------------------------------------------------- NeoPixel (WS2812B)
  const NEO = {
    strip: { label: 'NeoPixel strip' }, ring12: { label: 'NeoPixel ring (12)', n: 12, r: 26 }, ring16: { label: 'NeoPixel ring (16)', n: 16, r: 34 },
    ring24: { label: 'NeoPixel ring (24)', n: 24, r: 48 }, jewel: { label: 'NeoPixel jewel (7)', n: 7 }, single: { label: 'NeoPixel (single)', n: 1 },
  };
  const neoCount = (pr) => (pr.model === 'strip' ? clamp(Math.round(Number(pr.count) || 8), 1, 60) : NEO[pr.model] ? NEO[pr.model].n : 8);
  function neoLayout(pr) {
    const n = neoCount(pr), m = pr.model;
    const pts = [];
    if (m === 'strip') for (let i = 0; i < n; i++) pts.push([6 + i * 16, -18]);
    else if (m === 'jewel') { pts.push([10, -36]); for (let i = 0; i < 6; i++) pts.push([10 + 14 * Math.cos((i * Math.PI) / 3 - Math.PI / 2), -36 + 14 * Math.sin((i * Math.PI) / 3 - Math.PI / 2)]); }
    else if (m === 'single') pts.push([10, -20]);
    else { const r = NEO[m].r; for (let i = 0; i < n; i++) pts.push([10 + r * Math.sin((2 * Math.PI * i) / n), -r - 14 - r * Math.cos((2 * Math.PI * i) / n)]); }
    return pts;
  }
  WB.neoCount = neoCount;
  WB.defPart('neopixel', {
    label: 'NeoPixel', category: 'Displays', prefix: 'NP', dynamic: true,
    defaults: { model: 'ring12', count: 8 },
    pins: () => [{ id: 'GND', label: 'GND', x: 0, y: 0, kind: 'gnd' }, { id: '5V', label: '5V', x: 10, y: 0, kind: 'pwr' }, { id: 'DIN', label: 'DIN — data in (Adafruit_NeoPixel)', x: 20, y: 0 }],
    bbox(pr) {
      const m = pr.model;
      if (m === 'strip') return [-6, -30, Math.max(36, neoCount(pr) * 16 + 2), 33];
      if (m === 'jewel') return [-14, -60, 48, 63];
      if (m === 'single') return [-6, -32, 32, 35];
      const r = (NEO[m] || NEO.ring12).r;
      return [10 - r - 9, -2 * r - 24, 2 * r + 18, 2 * r + 27];
    },
    summary: (p) => `${(NEO[p.props.model] || NEO.ring12).label}${p.props.model === 'strip' ? ' × ' + neoCount(p.props) : ''}, WS2812B`,
    inspector: [
      { key: 'model', label: 'Shape', type: 'select', options: Object.keys(NEO).map((k) => [k, NEO[k].label]) },
      { key: 'count', label: 'Strip length (pixels)', type: 'number', min: 1, step: 1, suggestions: [4, 8, 10, 16, 30, 60] },
    ],
    elements: (c) => [{ t: 'R', a: c.n('5V'), b: c.n('GND'), r: 5 / (0.001 * neoCount(c.props) + 0.0005) }],
    visualize(c) {
      const powered = c.V('5V') - c.V('GND') > 3.5;
      const st = c.sim.neo && c.sim.neo[c.part.id];
      return { powered, px: powered && st ? st.px : null };
    },
    render(p, v) {
      v = v || {};
      const pts = neoLayout(p.props), m = p.props.model;
      let board;
      if (m === 'strip') board = `<rect x="-5" y="-29" width="${pts.length * 16 + 1}" height="22" rx="2" fill="#f4f4f2" stroke="#b8b8b2"/>`;
      else if (m === 'jewel') board = `<polygon points="${[0, 1, 2, 3, 4, 5].map((i) => `${10 + 24 * Math.cos((i * Math.PI) / 3)},${-36 + 24 * Math.sin((i * Math.PI) / 3)}`).join(' ')}" fill="#1d1d1f" stroke="#000"/>`;
      else if (m === 'single') board = `<rect x="-5" y="-31" width="30" height="24" rx="3" fill="#1d1d1f" stroke="#000"/>`;
      else { const r = (NEO[m] || NEO.ring12).r; board = `<circle cx="10" cy="${-r - 14}" r="${r + 8}" fill="#1d1d1f" stroke="#000"/><circle cx="10" cy="${-r - 14}" r="${r - 8}" fill="var(--canvas, #dfe3e8)" stroke="#000"/>`; }
      let px = '';
      pts.forEach(([x, y], i) => {
        const q = v.px && v.px[i];
        const lit = q && (q[0] || q[1] || q[2]);
        if (lit) {
          const k = Math.max(q[0], q[1], q[2]) / 255;
          px += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(6 + 6 * k).toFixed(1)}" fill="rgb(${q[0]},${q[1]},${q[2]})" opacity="${(0.25 + 0.5 * k).toFixed(2)}" filter="url(#wbGlow)"/>`;
        }
        const fill = lit ? `rgb(${Math.min(255, 60 + q[0])},${Math.min(255, 60 + q[1])},${Math.min(255, 60 + q[2])})` : '#f2f2ee';
        px += `<rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" rx="1.5" fill="${fill}" stroke="#999" stroke-width=".5"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${lit ? '#fff' : '#ddd'}" opacity=".8"/>`;
      });
      return `${legs([0, 10, 20], 0, -7)}${board}${px}`;
    },
  });

  // ---------------------------------------------------------------- Keypad 4x4
  const KP_KEYS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];
  WB.KP_KEYS = KP_KEYS;
  WB.defPart('keypad', {
    label: 'Keypad 4×4', category: 'Input', prefix: 'KP', dynamic: true, interact: 'buttons', nButtons: 16,
    pins: () => ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'].map((id, i) => ({ id, label: (i < 4 ? 'Row ' : 'Column ') + id.slice(1), x: i * 10, y: 0 })),
    bbox: () => [-21, -132, 112, 135],
    summary: () => 'rows R1–R4, columns C1–C4 (Keypad library)',
    hit(lx, ly) { for (let k = 0; k < 16; k++) { const x = -13 + (k & 3) * 26, y = -124 + (k >> 2) * 28; if (lx >= x && lx <= x + 22 && ly >= y && ly <= y + 24) return k; } return -1; },
    elements(c) {
      const pr = c.ui.pressed;
      const k = pr ? pr.indexOf(true) : -1;
      return k < 0 ? [] : [{ t: 'R', a: c.n('R' + ((k >> 2) + 1)), b: c.n('C' + ((k & 3) + 1)), r: 50 }];
    },
    render(p, v) {
      const pr = (v && v.pressed) || [];
      let keys = '';
      for (let k = 0; k < 16; k++) {
        const x = -13 + (k & 3) * 26, y = -124 + (k >> 2) * 28, isL = (k & 3) === 3, on = pr[k];
        keys += `<rect x="${x}" y="${y}" width="22" height="24" rx="3" fill="${on ? '#9aa2ad' : isL ? '#d84a4a' : '#e9ecef'}" stroke="#555" stroke-width=".7"/>
          ${T(x + 11, y + 16, 11, KP_KEYS[k], isL ? '#fff' : '#222', ' font-weight="700"')}`;
      }
      return `<path d="M0,0 V-6 M10,0 V-6 M20,0 V-6 M30,0 V-6 M40,0 V-6 M50,0 V-6 M60,0 V-6 M70,0 V-6" stroke="#bbb" stroke-width="1.6"/>
        <rect x="-5" y="-10" width="80" height="6" fill="#222"/>
        <rect x="-20" y="-131" width="110" height="122" rx="4" fill="#24272c" stroke="#0e0f11"/>${keys}`;
    },
  });

  // ---------------------------------------------------------------- DIP switch
  WB.defPart('dipswitch', {
    label: 'DIP switch', category: 'Input', prefix: 'SW', dynamic: true, interact: 'panel',
    defaults: { n: 4, sw: [] },
    pins(pr) {
      const n = [4, 6, 8].includes(+pr.n) ? +pr.n : 4, pins = [];
      for (let i = 1; i <= n; i++) pins.push({ id: 'B' + i, label: `Switch ${i}, pin A`, x: (i - 1) * 10, y: 0 }, { id: 'T' + i, label: `Switch ${i}, pin B`, x: (i - 1) * 10, y: -30 });
      return pins;
    },
    bbox: (pr) => [-7, -33, ([4, 6, 8].includes(+pr.n) ? +pr.n : 4) * 10 + 4, 36],
    summary: (p) => `SPST × ${p.props.n || 4}`,
    inspector: [{ key: 'n', label: 'Switches', type: 'select', options: [[4, '4'], [6, '6'], [8, '8']] }],
    hit(lx, ly, part) {
      const n = [4, 6, 8].includes(+part.props.n) ? +part.props.n : 4;
      if (ly < -25 || ly > -5) return null;
      const i = Math.round(lx / 10);
      return i >= 0 && i < n && Math.abs(lx - i * 10) < 4.5 ? 'sw' + i : null;
    },
    panelAction(part, act) {
      const i = +act.slice(2);
      const sw = Array.isArray(part.props.sw) ? part.props.sw.slice() : [];
      sw[i] = !sw[i];
      part.props.sw = sw;
    },
    elements(c) {
      const n = [4, 6, 8].includes(+c.props.n) ? +c.props.n : 4, sw = c.props.sw || [], out = [];
      for (let i = 0; i < n; i++) if (sw[i]) out.push({ t: 'R', a: c.n('B' + (i + 1)), b: c.n('T' + (i + 1)), r: 0.05 });
      return out;
    },
    render(p) {
      const n = [4, 6, 8].includes(+p.props.n) ? +p.props.n : 4, sw = p.props.sw || [];
      const xs = Array.from({ length: n }, (_, i) => i * 10);
      let s = '';
      for (let i = 0; i < n; i++) {
        const x = i * 10;
        s += `<rect x="${x - 3}" y="-23" width="6" height="16" rx="1" fill="#fff"/><rect x="${x - 2.5}" y="${sw[i] ? -22.5 : -14.5}" width="5" height="7" rx="1" fill="#555"/>`;
      }
      return `${legs(xs, 0, -3)}${legs(xs, -30, -27)}<rect x="-6" y="-27" width="${(n - 1) * 10 + 12}" height="24" rx="1.5" fill="#c62f2f" stroke="#7a1515"/>
        ${T(-2, -24, 3.6, 'ON', '#fff', ' text-anchor="start" font-weight="700"')}${s}
        ${xs.map((x, i) => T(x, -4, 3.6, i + 1, '#fff')).join('')}`;
    },
  });

  // ---------------------------------------------------------------- IR receiver & remote
  const IR_KEYS = [['CH−', 'CH', 'CH+'], ['⏮', '⏭', '⏯'], ['−', '+', 'EQ'], ['0', '100+', '200+'], ['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']];
  const IR_CODES = [[0x45, 0x46, 0x47], [0x44, 0x40, 0x43], [0x07, 0x15, 0x09], [0x16, 0x19, 0x0d], [0x0c, 0x18, 0x5e], [0x08, 0x1c, 0x5a], [0x42, 0x52, 0x4a]];
  WB.IR_CODES = IR_CODES; WB.IR_KEYS = IR_KEYS;
  WB.defPart('irrecv', {
    label: 'IR receiver', category: 'Sensors', prefix: 'IR', dynamic: true,
    pins: () => [{ id: 'OUT', label: 'OUT (to a digital pin; IRremote library)', x: 0, y: 0 }, { id: 'GND', label: 'GND', x: 10, y: 0, kind: 'gnd' }, { id: 'VCC', label: 'VCC (5 V)', x: 20, y: 0, kind: 'pwr' }],
    bbox: () => [-6, -30, 32, 33],
    summary: () => '38 kHz, NEC codes from the IR remote',
    elements: (c) => [{ t: 'R', a: c.n('VCC'), b: c.n('OUT'), r: 20000 }, { t: 'R', a: c.n('VCC'), b: c.n('GND'), r: 10000 }],
    visualize(c) { const f = c.sim.irFlash; return { rx: !!(f && performance.now() - f < 250) }; },
    render(p, v) {
      return `${legs([0, 10, 20], 0, -9)}<rect x="-5" y="-19" width="30" height="11" rx="1.5" fill="#1d1d1f"/>
        <path d="M2,-19 a8,8 0 0 1 16,0 z" fill="${v && v.rx ? '#5a2a6a' : '#2b2b2f'}" stroke="#000"/>
        ${v && v.rx ? '<circle cx="10" cy="-22" r="8" fill="#c060ff" opacity=".35" filter="url(#wbGlow)"/>' : ''}`;
    },
  });
  WB.defPart('irremote', {
    label: 'IR remote', category: 'Input', prefix: 'RC', dynamic: true, interact: 'panel',
    pins: () => [],
    bbox: () => [0, -4, 64, 176],
    summary: () => 'press its buttons while the simulation runs',
    hit(lx, ly) {
      for (let r = 0; r < 7; r++) for (let k = 0; k < 3; k++) if (Math.hypot(lx - (12 + k * 20), ly - (32 + r * 20)) < 8.5) return `k${r}_${k}`;
      return null;
    },
    panelAction(part, act, app) {
      const [r, k] = act.slice(1).split('_').map(Number);
      if (!app.sim) { app.toast('Start the simulation, then press the remote\'s buttons.'); return; }
      app.sim.irq = app.sim.irq || [];
      app.sim.irq.push(IR_CODES[r][k]);
      app.sim.irFlash = performance.now();
      app.transient[part.id] = { key: act };
      setTimeout(() => { if (app.transient[part.id] && app.transient[part.id].key === act) { delete app.transient[part.id]; if (app.editor) app.editor.rerenderBody(part); app.markDirty(); } }, 180);
    },
    render(p, v) {
      const key = v && v.key;
      let s = '';
      for (let r = 0; r < 7; r++) for (let k = 0; k < 3; k++) {
        const x = 12 + k * 20, y = 32 + r * 20, on = key === `k${r}_${k}`;
        const lbl = IR_KEYS[r][k];
        s += `<circle cx="${x}" cy="${y}" r="8" fill="${on ? '#888' : r === 0 ? '#d84a4a' : '#3a3d42'}" stroke="#111"/>${T(x, y + 2.4, lbl.length > 2 ? 4.6 : 6.5, lbl, '#f2f2f2', ' font-weight="700"')}`;
      }
      return `<rect x="0" y="0" width="64" height="172" rx="8" fill="#1f2125" stroke="#000"/>
        <rect x="26" y="-3" width="12" height="6" rx="2" fill="${key ? '#c060ff' : '#3a2a40'}"/>${key ? '<circle cx="32" cy="-2" r="7" fill="#c060ff" opacity=".4" filter="url(#wbGlow)"/>' : ''}
        ${T(32, 14, 5, 'IR REMOTE', '#888')}${s}`;
    },
  });

  // ---------------------------------------------------------------- More sensors
  WB.defPart('ping', {
    label: 'Ultrasonic sensor (3-pin)', category: 'Sensors', prefix: 'US', dynamic: true,
    interact: 'knob', knob: { key: 'cm', min: 2, max: 330, fmt: (v) => Math.round(v) + ' cm' },
    defaults: { cm: 50 },
    pins: () => [{ id: 'GND', label: 'GND', x: 0, y: 0, kind: 'gnd' }, { id: '5V', label: '5V', x: 10, y: 0, kind: 'pwr' }, { id: 'SIG', label: 'SIG (pulse it, then pulseIn on the same pin)', x: 20, y: 0 }],
    bbox: () => [-26, -50, 72, 53],
    summary: () => '2–330 cm, one signal pin',
    inspector: [{ key: 'cm', label: 'Distance to object', type: 'range', min: 2, max: 330, step: 1, fmt: (v) => Math.round(v) + ' cm' }],
    elements: (c) => [{ t: 'R', a: c.n('5V'), b: c.n('GND'), r: 2000 }],
    render(p) {
      const can = (cx) => `<circle cx="${cx}" cy="-26" r="12" fill="#d9dde2" stroke="#8a9096"/><circle cx="${cx}" cy="-26" r="8" fill="#2b2f33"/>`;
      return `${legs([0, 10, 20], 0, -6)}<rect x="-24" y="-46" width="68" height="40" rx="3" fill="#2b2f36" stroke="#111"/>${can(-8)}${can(28)}
        ${T(10, -10, 5, 'PING', '#cfd5df', ' font-family="monospace"')}${T(10, -54, 7, Math.round(p.props.cm) + ' cm', '#7d8798')}`;
    },
  });
  WB.defPart('photodiode', {
    label: 'Photodiode', category: 'Sensors', prefix: 'D', dynamic: true,
    interact: 'knob', knob: { key: 'light', min: 0, max: 100, fmt: (v) => 'light ' + Math.round(v) + '%' },
    defaults: { light: 50 },
    pins: () => [{ id: 'A', label: 'Anode', x: 0, y: 0 }, { id: 'K', label: 'Cathode (to +, reverse biased)', x: 10, y: 0 }],
    bbox: () => [-6, -28, 22, 31],
    summary: () => 'photocurrent up to 300 µA',
    inspector: [{ key: 'light', label: 'Light level', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + '%' }],
    elements(c) {
      const iph = 300e-6 * clamp(Number(c.props.light), 0, 100) / 100;
      const A = c.n('A'), K = c.n('K');
      return [{ t: 'G', a: K, b: A, p: K, q: K, gm: 0, i0: iph }, { t: 'D', a: A, b: K, vf: 0.45, rs: 50 }];
    },
    render(p) {
      const l = clamp(Number(p.props.light), 0, 100) / 100;
      return `${legs([0, 10], 0, -8)}<rect x="-4" y="-20" width="18" height="12" rx="1" fill="#1d1d1f"/><path d="M-4,-20 a9,7 0 0 1 18,0 z" fill="#2b2b3a" stroke="#000"/>
        <path d="M-6,-30 l5,5 M0,-32 l5,5" stroke="#ffb020" stroke-width="${0.6 + l}" opacity="${0.3 + 0.7 * l}"/>`;
    },
  });
  WB.defPart('phototransistor', {
    label: 'Ambient light sensor (phototransistor)', category: 'Sensors', prefix: 'Q', dynamic: true,
    interact: 'knob', knob: { key: 'light', min: 0, max: 100, fmt: (v) => 'light ' + Math.round(v) + '%' },
    defaults: { light: 50 },
    pins: () => [{ id: 'C', label: 'Collector (long leg, to +)', x: 0, y: 0 }, { id: 'E', label: 'Emitter (to a resistor / GND)', x: 10, y: 0 }],
    bbox: () => [-6, -30, 22, 33],
    summary: () => 'up to 0.5 mA with light',
    inspector: [{ key: 'light', label: 'Light level', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + '%' }],
    elements(c) {
      const C = c.n('C'), E = c.n('E');
      const iph = 0.5e-3 * clamp(Number(c.props.light), 0, 100) / 100;
      const g = { t: 'G', a: C, b: E, p: C, q: C, gm: 0, i0: iph, off: true };
      return [g, ceSwitch(C, E, g, () => iph, 0.15, 20)];
    },
    render(p) {
      const l = clamp(Number(p.props.light), 0, 100) / 100;
      return `${legs([0, 10], 0, -8)}<rect x="-3" y="-16" width="16" height="8" fill="#e8e8f0" opacity=".9" stroke="#999" stroke-width=".5"/><path d="M-3,-16 v-6 a8,8 0 0 1 16,0 v6 z" fill="#f0f0f8" opacity=".85" stroke="#999" stroke-width=".5"/>
        <path d="M5,-14 v-8" stroke="#555"/><path d="M-6,-32 l5,5 M0,-34 l5,5" stroke="#ffb020" stroke-width="${0.6 + l}" opacity="${0.3 + 0.7 * l}"/>`;
    },
  });
  WB.defPart('flex', {
    label: 'Flex sensor', category: 'Sensors', prefix: 'FS', dynamic: true,
    interact: 'knob', knob: { key: 'bend', min: 0, max: 100, fmt: (v) => 'bend ' + Math.round(v) + '%' },
    defaults: { bend: 0 },
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: '2', label: 'Pin 2', x: 10, y: 0 }],
    bbox: () => [-8, -100, 40, 103],
    summary: () => '25 kΩ flat → 125 kΩ bent',
    inspector: [{ key: 'bend', label: 'Bend', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + '%' }],
    elements: (c) => [{ t: 'R', a: c.n('1'), b: c.n('2'), r: 25000 + 1000 * clamp(Number(c.props.bend), 0, 100) }],
    render(p) {
      const b = clamp(Number(p.props.bend), 0, 100) / 100;
      return `${legs([0, 10], 0, -8)}<rect x="-2" y="-14" width="14" height="6" fill="#ccc"/>
        <path d="M5,-14 Q${5 + 30 * b},-55 ${5 + 22 * b},-${95 - 12 * b}" stroke="#2b2f36" stroke-width="9" fill="none" stroke-linecap="round"/>
        <path d="M5,-14 Q${5 + 30 * b},-55 ${5 + 22 * b},-${95 - 12 * b}" stroke="#7f8a99" stroke-width="2" fill="none" stroke-dasharray="3 3"/>`;
    },
  });
  WB.defPart('fsr', {
    label: 'Force sensor (FSR)', category: 'Sensors', prefix: 'FSR', dynamic: true,
    interact: 'knob', knob: { key: 'force', min: 0, max: 100, fmt: (v) => 'force ' + Math.round(v) + '%' },
    defaults: { force: 0 },
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: '2', label: 'Pin 2', x: 10, y: 0 }],
    bbox: () => [-16, -66, 42, 69],
    summary: () => '>10 MΩ untouched → 250 Ω pressed',
    inspector: [{ key: 'force', label: 'Force', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + '%' }],
    elements(c) { const f = clamp(Number(c.props.force), 0, 100) / 100; return [{ t: 'R', a: c.n('1'), b: c.n('2'), r: f < 0.005 ? 1e7 : 250 * Math.pow(1 / f, 1.3) }]; },
    render(p) {
      const f = clamp(Number(p.props.force), 0, 100) / 100;
      return `${legs([0, 10], 0, -8)}<rect x="0" y="-34" width="10" height="26" fill="#d9a441"/>
        <circle cx="5" cy="-48" r="15" fill="#2b2f36"/><circle cx="5" cy="-48" r="11" fill="${WB.mix('#4a5160', '#d98b3a', f)}"/>
        <path d="M-4,-52 h18 M-4,-48 h18 M-4,-44 h18" stroke="#8a93a2" stroke-width=".6"/>`;
    },
  });
  WB.defPart('gas', {
    label: 'Gas sensor', category: 'Sensors', prefix: 'GS', dynamic: true,
    interact: 'knob', knob: { key: 'gas', min: 0, max: 100, fmt: (v) => 'gas ' + Math.round(v) + '%' },
    defaults: { gas: 0 },
    pins: () => [
      { id: 'A1', label: 'A (sensing, joined to A2)', x: 0, y: 0 }, { id: 'H1', label: 'H (heater, 5 V)', x: 10, y: 0 }, { id: 'B1', label: 'B (sensing, joined to B2)', x: 20, y: 0 },
      { id: 'A2', label: 'A (sensing)', x: 0, y: -30 }, { id: 'H2', label: 'H (heater, GND)', x: 10, y: -30 }, { id: 'B2', label: 'B (sensing)', x: 20, y: -30 },
    ],
    groups: () => [['A1', 'A2'], ['B1', 'B2']],
    bbox: () => [-10, -46, 40, 50],
    summary: () => 'heater 33 Ω; A–B 50 kΩ (clean) → 2 kΩ',
    inspector: [{ key: 'gas', label: 'Gas concentration', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + '%' }],
    elements(c) {
      const heated = c.state.heated !== false;
      const g = clamp(Number(c.props.gas), 0, 100) / 100;
      return [{ t: 'R', a: c.n('H1'), b: c.n('H2'), r: 33 }, { t: 'R', a: c.n('A1'), b: c.n('B1'), r: heated ? 50000 * Math.pow(0.04, g) : 2e6 }];
    },
    visualize(c) {
      const heated = Math.abs(c.V('H1') - c.V('H2')) > 4;
      if (heated !== (c.state.heated !== false)) { c.state.heated = heated; return { heated, again: true }; }
      return { heated };
    },
    render(p, v) {
      const g = clamp(Number(p.props.gas), 0, 100) / 100;
      return `${legs([0, 10, 20], 0, -6)}${legs([0, 10, 20], -30, -26)}
        <circle cx="10" cy="-15" r="19" fill="#c0c4ca" stroke="#7b828c"/><circle cx="10" cy="-15" r="14" fill="#9aa1aa"/>
        <circle cx="10" cy="-15" r="11" fill="#e8e8e2" stroke="#999"/><path d="M1,-15 h18 M10,-24 v18 M3,-21 l14,12 M17,-21 l-14,12" stroke="#bbb" stroke-width=".6"/>
        ${v && v.heated ? '<circle cx="10" cy="-15" r="5" fill="#ff7a3a" opacity=".5" filter="url(#wbGlow)"/>' : ''}
        ${T(10, -38, 6, Math.round(g * 100) + '%', '#7d8798')}`;
    },
  });

  // ---------------------------------------------------------------- Transistors
  const NPN = { '2N2222': { beta: 150, vf: 0.65, rs: 20, vsat: 0.2 }, BC547: { beta: 300, vf: 0.65, rs: 30, vsat: 0.15 } };
  const PNP = { '2N3906': { beta: 150, vf: 0.65, rs: 20, vsat: 0.2 }, BC557: { beta: 300, vf: 0.65, rs: 30, vsat: 0.15 } };
  function to92(label, sub) {
    return `${legs([0, 10, 20], 0, -8)}<path d="M-4,-8 H24 V-14 A14,9 0 0 0 -4,-14 Z" fill="#222" stroke="#000"/>
      ${T(10, -11, 4.8, label, '#ddd', ' font-family="monospace"')}${sub ? T(10, -26, 5, sub, '#7d8798') : ''}`;
  }
  function to220(label, pinsTxt) {
    return `${legs([0, 10, 20], 0, -12)}<rect x="-6" y="-56" width="32" height="18" rx="1.5" fill="#c8ccd2" stroke="#8a9096"/><circle cx="10" cy="-49" r="4" fill="#8a9096"/>
      <rect x="-6" y="-40" width="32" height="28" rx="1" fill="#1d1d1f" stroke="#000"/>${T(10, -26, 5, label, '#ddd', ' font-family="monospace" font-weight="700"')}
      ${pinsTxt ? T(10, -16, 3.8, pinsTxt, '#9aa0a8') : ''}`;
  }
  const bjtPins = (pnp) => [{ id: 'E', label: 'Emitter' + (pnp ? ' (to +)' : ' (to GND)'), x: 0, y: 0 }, { id: 'B', label: 'Base (through a 1 kΩ resistor)', x: 10, y: 0 }, { id: 'C', label: 'Collector (to the load)', x: 20, y: 0 }];
  function bjtVis(c, pol, imax) {
    const s = c.els.find((e) => e.mode !== undefined);
    const d = c.els.find((e) => e.t === 'D');
    if (d && d.i > 0.1) c.warn(`${c.name}: ${Math.round(d.i * 1000)} mA into the base — use a base resistor (about 1 kΩ).`);
    const g = c.els.find((e) => e.t === 'G');
    const ic = s ? (s.mode === 'act' && g ? g.i : s.mode === 'sat' ? -s.i : 0) : 0;
    if (Math.abs(ic) > (imax || 0.8)) c.warn(`${c.name}: ${Math.abs(ic).toFixed(1)} A collector current is too much for this transistor (max ${imax || 0.8} A).`);
    let mode = s ? s.mode : 'off';
    if (mode === 'off' && d && d.i > 1e-5) mode = 'pwm'; // switched on and off by PWM: the last phase was off
    return { mode };
  }
  const MODE_TXT = { off: 'off', act: 'active', sat: 'saturated (on)', pwm: 'switching (PWM)' };
  WB.defPart('npn', {
    label: 'NPN transistor', category: 'Semiconductors', prefix: 'Q', dynamic: true,
    defaults: { model: '2N2222' },
    pins: () => bjtPins(false),
    bbox: () => [-5, -32, 30, 35],
    summary: (p) => `${p.props.model}, β ${(NPN[p.props.model] || NPN['2N2222']).beta}`,
    inspector: [{ key: 'model', label: 'Type', type: 'select', options: Object.keys(NPN) }],
    elements: (c) => bjtEls(c, NPN[c.props.model] || NPN['2N2222'], 1),
    visualize: (c) => bjtVis(c, 1),
    render: (p, v) => to92(p.props.model, v && v.mode ? MODE_TXT[v.mode] : ''),
  });
  WB.defPart('pnp', {
    label: 'PNP transistor', category: 'Semiconductors', prefix: 'Q', dynamic: true,
    defaults: { model: '2N3906' },
    pins: () => bjtPins(true),
    bbox: () => [-5, -32, 30, 35],
    summary: (p) => `${p.props.model}, β ${(PNP[p.props.model] || PNP['2N3906']).beta}`,
    inspector: [{ key: 'model', label: 'Type', type: 'select', options: Object.keys(PNP) }],
    elements: (c) => bjtEls(c, PNP[c.props.model] || PNP['2N3906'], -1),
    visualize: (c) => bjtVis(c, -1),
    render: (p, v) => to92(p.props.model, v && v.mode ? MODE_TXT[v.mode] : ''),
  });
  WB.defPart('darlington', {
    label: 'Power transistor (TIP120)', category: 'Semiconductors', prefix: 'Q', dynamic: true,
    pins: () => [{ id: 'B', label: 'Base (through a 1 kΩ resistor)', x: 0, y: 0 }, { id: 'C', label: 'Collector (to the load)', x: 10, y: 0 }, { id: 'E', label: 'Emitter (to GND)', x: 20, y: 0 }],
    bbox: () => [-7, -58, 34, 61],
    summary: () => 'NPN Darlington, β 1000, 5 A',
    elements: (c) => bjtEls(c, { beta: 1000, vf: 1.3, rs: 50, vsat: 0.9, rsat: 0.2 }, 1),
    visualize: (c) => bjtVis(c, 1, 5),
    render: (p, v) => to220('TIP120', v && v.mode ? MODE_TXT[v.mode] : 'B  C  E'),
  });
  const NMOS = { IRLZ44N: { vth: 1.8, k: 12, ron: 0.025, label: 'IRLZ44N (logic level)' }, IRF520: { vth: 3.8, k: 3, ron: 0.27, label: 'IRF520' } };
  const PMOS = { IRF9540N: { vth: 3, k: 3, ron: 0.12, label: 'IRF9540N' }, IRF4905: { vth: 2.5, k: 8, ron: 0.02, label: 'IRF4905' } };
  const mosPins = (p) => [{ id: 'G', label: 'Gate', x: 0, y: 0 }, { id: 'D', label: 'Drain' + (p ? ' (to the load)' : ' (to the load)'), x: 10, y: 0 }, { id: 'S', label: 'Source' + (p ? ' (to +)' : ' (to GND)'), x: 20, y: 0 }];
  function mosVis(c) {
    const r = c.els.find((e) => e.mode !== undefined);
    return { mode: r ? r.mode : 'off' };
  }
  const MOS_TXT = { off: 'off', sat: 'partly on', ohm: 'on' };
  WB.defPart('nmos', {
    label: 'N-channel MOSFET', category: 'Semiconductors', prefix: 'Q', dynamic: true,
    defaults: { model: 'IRLZ44N' },
    pins: () => mosPins(false),
    bbox: () => [-7, -58, 34, 61],
    summary: (p) => (NMOS[p.props.model] || NMOS.IRLZ44N).label + `, Vth ${(NMOS[p.props.model] || NMOS.IRLZ44N).vth} V`,
    inspector: [{ key: 'model', label: 'Type', type: 'select', options: Object.keys(NMOS).map((k) => [k, NMOS[k].label]) }],
    elements: (c) => mosEls(c, NMOS[c.props.model] || NMOS.IRLZ44N, 1),
    visualize: mosVis,
    render: (p, v) => to220(p.props.model, v && v.mode && v.mode !== 'off' ? MOS_TXT[v.mode] : 'G  D  S'),
  });
  WB.defPart('pmos', {
    label: 'P-channel MOSFET', category: 'Semiconductors', prefix: 'Q', dynamic: true,
    defaults: { model: 'IRF9540N' },
    pins: () => mosPins(true),
    bbox: () => [-7, -58, 34, 61],
    summary: (p) => (PMOS[p.props.model] || PMOS.IRF9540N).label + `, Vth −${(PMOS[p.props.model] || PMOS.IRF9540N).vth} V`,
    inspector: [{ key: 'model', label: 'Type', type: 'select', options: Object.keys(PMOS).map((k) => [k, PMOS[k].label]) }],
    elements: (c) => mosEls(c, PMOS[c.props.model] || PMOS.IRF9540N, -1),
    visualize: mosVis,
    render: (p, v) => to220(p.props.model, v && v.mode && v.mode !== 'off' ? MOS_TXT[v.mode] : 'G  D  S'),
  });

  // ---------------------------------------------------------------- Voltage regulator
  const REGS = { '7805': { vo: 5, drop: 2, label: 'LM7805 (5 V)' }, '7809': { vo: 9, drop: 2, label: 'LM7809 (9 V)' }, '7812': { vo: 12, drop: 2, label: 'LM7812 (12 V)' }, '1117': { vo: 3.3, drop: 1.2, label: 'LM1117 (3.3 V)' } };
  WB.defPart('regulator', {
    label: 'Voltage regulator', category: 'Semiconductors', prefix: 'U', dynamic: true,
    defaults: { model: '7805' },
    pins: () => [{ id: 'IN', label: 'Input', x: 0, y: 0 }, { id: 'GND', label: 'GND', x: 10, y: 0, kind: 'gnd' }, { id: 'OUT', label: 'Output', x: 20, y: 0 }],
    bbox: () => [-7, -58, 34, 61],
    summary: (p) => (REGS[p.props.model] || REGS['7805']).label,
    inspector: [{ key: 'model', label: 'Type', type: 'select', options: Object.keys(REGS).map((k) => [k, REGS[k].label]) }],
    elements(c) {
      const m = REGS[c.props.model] || REGS['7805'];
      const IN = c.n('IN'), G = c.n('GND'), O = c.n('OUT'), r = 0.05;
      const reg = { t: 'V', a: O, b: G, v: m.vo, r, off: true, mode: 'off' };
      const pass = { t: 'G', a: IN, b: G, p: O, q: G, gm: -1 / r, i0: m.vo / r, off: true }; // output current is taken from IN
      const drop = { t: 'V', a: O, b: IN, v: -m.drop, r: 0.3, off: true };
      reg.upd = (v) => {
        const vin = v(IN) - v(G);
        const mode = vin < m.drop + 0.5 ? 'off' : vin < m.vo + m.drop ? 'drop' : 'reg';
        if (mode === reg.mode) return false;
        reg.mode = mode; reg.off = pass.off = mode !== 'reg'; drop.off = mode !== 'drop';
        return true;
      };
      return [reg, pass, drop, { t: 'R', a: IN, b: G, r: 2000 }];
    },
    visualize(c) {
      const m = REGS[c.props.model] || REGS['7805'];
      const reg = c.els.find((e) => e.mode !== undefined);
      const io = reg ? (reg.mode === 'reg' ? reg.i : 0) : 0;
      const pw = Math.max(0, (c.V('IN') - c.V('OUT')) * io);
      if (pw > 1.5) c.warn(`${c.name}: dissipating ${pw.toFixed(1)} W — it needs a heatsink (or a lower input voltage).`);
      if (reg && reg.mode === 'drop') c.warn(`${c.name}: input too low — it needs at least ${(m.vo + m.drop).toFixed(1)} V to give ${m.vo} V.`);
      return { mode: reg ? reg.mode : 'off' };
    },
    render: (p) => to220(p.props.model === '1117' ? 'LM1117' : 'L' + p.props.model, 'IN GND OUT'),
  });

  // ---------------------------------------------------------------- Optocoupler (4N35)
  WB.defPart('opto', {
    label: 'Optocoupler (4N35)', category: 'Semiconductors', prefix: 'U', dynamic: true,
    pins: () => dipPins(6, ['A (LED anode)', 'K (LED cathode)', 'NC', 'E (emitter)', 'C (collector)', 'B (base, leave open)']),
    bbox: () => dipBox(6),
    summary: () => 'LED + phototransistor, CTR 100%',
    elements(c) {
      const A = c.n('1'), K = c.n('2'), C = c.n('5'), E = c.n('4');
      const d = { t: 'D', a: A, b: K, vf: 1.2, rs: 10 };
      const g = { t: 'G', a: C, b: E, p: A, q: K, gm: 1 / 10, i0: -1.2 / 10, off: true };
      return [d, g, ceSwitch(C, E, g, (v) => Math.max(0, v(A) - v(K) - 1.2) / 10, 0.2, 20)];
    },
    visualize(c) { const d = c.els.find((e) => e.t === 'D'); if (d && d.i > 0.06) c.warn(`${c.name}: ${Math.round(d.i * 1000)} mA through the input LED — use a resistor (about 330 Ω).`); return { on: !!(d && d.i > 0.001) }; },
    render: (p, v) => dipBody(6, '4N35', v && v.on ? 'LED on' : 'opto'),
  });

  // ---------------------------------------------------------------- 555 timer
  WB.defPart('timer555', {
    label: '555 timer', category: 'ICs', prefix: 'U', dynamic: true,
    pins: () => dipPins(8, ['GND', 'TRIG (trigger)', 'OUT', 'RESET (tie to VCC)', 'CTRL (control voltage)', 'THR (threshold)', 'DIS (discharge)', 'VCC']),
    bbox: () => dipBox(8),
    summary: () => 'NE555, 4.5–16 V',
    elements(c) {
      const st = c.state;
      const G = c.n('1'), TR = c.n('2'), O = c.n('3'), RS = c.n('4'), CT = c.n('5'), TH = c.n('6'), DS = c.n('7'), VC = c.n('8');
      const X = c.newNode();
      const hi = { t: 'V', a: O, b: VC, v: -1.5, r: 10, off: true };
      const lo = { t: 'V', a: O, b: G, v: 0.1, r: 10, off: true };
      const dis = { t: 'R', a: DS, b: G, r: 5, off: true };
      const decide = (v) => {
        if (v(VC) - v(G) < 3) return null;
        if (v(RS) - v(G) < 0.7) return 0;
        if (v(TR) < v(X)) return 1;     // below 1/3 VCC: set
        if (v(TH) > v(CT)) return 0;    // above 2/3 VCC: reset
        return st.q ? 1 : 0;
      };
      lo.upd = (v) => {
        const q = decide(v);
        lo.q = q;
        const h = q === 1, l = q === 0;
        if (hi.off === !h && lo.off === !l && dis.off === (q !== 0)) return false;
        hi.off = !h; lo.off = !l; dis.off = q !== 0;
        return true;
      };
      lo.commit = () => { if (lo.q != null) st.q = lo.q; };
      return [lo, hi, dis, { t: 'R', a: VC, b: CT, r: 5000 }, { t: 'R', a: CT, b: X, r: 5000 }, { t: 'R', a: X, b: G, r: 5000 }];
    },
    visualize(c) { supplyWarn(c, '8', '1', 16, 'the 555'); return { q: c.state.q ? 1 : 0 }; },
    render: (p, v) => dipBody(8, 'NE555', v && v.q !== undefined ? 'OUT ' + (v.q ? 'HIGH' : 'LOW') : 'timer'),
  });

  // ---------------------------------------------------------------- Op-amps
  const OPAMPS = {
    LM741: { label: 'LM741 (single, needs ±supply or ≥ 9 V)', hr: 1.5, lr: 1.5, pins: ['Offset null', 'IN− (inverting)', 'IN+ (non-inverting)', 'V−', 'Offset null', 'OUT', 'V+', 'NC'] },
    LM358: { label: 'LM358 (dual, single supply)', hr: 1.5, lr: 0.02, pins: ['OUT A', 'IN− A', 'IN+ A', 'GND / V−', 'IN+ B', 'IN− B', 'OUT B', 'V+'] },
  };
  WB.defPart('opamp', {
    label: 'Op-amp (LM741)', category: 'ICs', prefix: 'U', dynamic: true,
    defaults: { model: 'LM741' },
    pins: (pr) => dipPins(8, (OPAMPS[pr.model] || OPAMPS.LM741).pins),
    bbox: () => dipBox(8),
    summary: (p) => (OPAMPS[p.props.model] || OPAMPS.LM741).label,
    inspector: [{ key: 'model', label: 'Type', type: 'select', options: Object.keys(OPAMPS).map((k) => [k, OPAMPS[k].label]) }],
    elements(c) {
      const m = OPAMPS[c.props.model] || OPAMPS.LM741;
      if (c.props.model === 'LM358') return [...opampEls(c, '3', '2', '1', '8', '4', m), ...opampEls(c, '5', '6', '7', '8', '4', m), { t: 'R', a: c.n('8'), b: c.n('4'), r: 7000 }];
      return [...opampEls(c, '3', '2', '6', '7', '4', m), { t: 'R', a: c.n('7'), b: c.n('4'), r: 3000 }];
    },
    visualize(c) { supplyWarn(c, c.props.model === 'LM358' ? '8' : '7', '4', 32, 'this op-amp'); return {}; },
    render: (p) => dipBody(8, p.props.model === 'LM358' ? 'LM358' : 'LM741', 'op-amp'),
  });
  // The LM358 also gets its own entry in the parts list (same model as Op-amp → LM358).
  WB.defPart('lm358', Object.assign({}, WB.PARTS.opamp, {
    label: 'Dual op-amp (LM358)', defaults: { model: 'LM358' }, inspector: [],
    pins: () => dipPins(8, OPAMPS.LM358.pins),
    summary: () => OPAMPS.LM358.label,
    elements(c) { return WB.PARTS.opamp.elements(Object.assign({}, c, { props: Object.assign({}, c.props, { model: 'LM358' }) })); },
    visualize(c) { supplyWarn(c, '8', '4', 32, 'the LM358'); return {}; },
    render: () => dipBody(8, 'LM358', 'dual op-amp'),
  }));

  // ---------------------------------------------------------------- 74HC logic gates
  const AND = (a, b) => a && b;
  const GATES = {
    '74HC00': { label: '74HC00 — 4 × NAND', f: (a, b) => !(a && b), quad: 'std', sym: 'NAND' },
    '74HC02': { label: '74HC02 — 4 × NOR', f: (a, b) => !(a || b), quad: 'nor', sym: 'NOR' },
    '74HC04': { label: '74HC04 — 6 × NOT (inverter)', f: (a) => !a, quad: 'hex', sym: 'NOT' },
    '74HC08': { label: '74HC08 — 4 × AND', f: AND, quad: 'std', sym: 'AND' },
    '74HC32': { label: '74HC32 — 4 × OR', f: (a, b) => a || b, quad: 'std', sym: 'OR' },
    '74HC86': { label: '74HC86 — 4 × XOR', f: (a, b) => a !== b, quad: 'std', sym: 'XOR' },
  };
  // [output pin, input pins] per gate
  const GATE_MAP = {
    std: [[3, [1, 2]], [6, [4, 5]], [8, [9, 10]], [11, [12, 13]]],
    nor: [[1, [2, 3]], [4, [5, 6]], [10, [8, 9]], [13, [11, 12]]],
    hex: [[2, [1]], [4, [3]], [6, [5]], [8, [9]], [10, [11]], [12, [13]]],
  };
  function gateLabels(model) {
    const g = GATES[model] || GATES['74HC08'];
    const L = Array(14).fill('');
    L[6] = 'GND'; L[13] = 'VCC';
    GATE_MAP[g.quad].forEach(([o, ins], i) => { L[o - 1] = `${i + 1}Y (output)`; ins.forEach((p, j) => { L[p - 1] = `${i + 1}${'AB'[j]} (input)`; }); });
    return L;
  }
  WB.defPart('logic', {
    label: 'Logic gate chip (74HC)', category: 'ICs', prefix: 'U', dynamic: true,
    defaults: { model: '74HC08' },
    pins: (pr) => dipPins(14, gateLabels(pr.model)),
    bbox: () => dipBox(14),
    summary: (p) => (GATES[p.props.model] || GATES['74HC08']).label,
    inspector: [{ key: 'model', label: 'Chip', type: 'select', options: Object.keys(GATES).map((k) => [k, GATES[k].label]) }],
    elements(c) {
      const g = GATES[c.props.model] || GATES['74HC08'];
      const out = [chipQuiescent(c, '14', '7')];
      for (const [o, ins] of GATE_MAP[g.quad]) out.push(...pushPull(c, String(o), '14', '7', (v, sup) => (g.f(...ins.map((p) => isHi(v, c, String(p), '7', sup))) ? 1 : 0)));
      return out;
    },
    visualize(c) { supplyWarn(c, '14', '7', 6, '74HC logic'); return {}; },
    render: (p) => dipBody(14, (p.props.model || '74HC08').replace('74', '74'), (GATES[p.props.model] || GATES['74HC08']).sym),
  });

  // ---------------------------------------------------------------- 74HC595 shift register
  const SR_LBL = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'GND', 'Q7′ (serial out)', 'MR (reset, active low — tie to VCC)', 'SHCP (shift clock)', 'STCP (latch clock)', 'OE (output enable, active low — tie to GND)', 'DS (serial data)', 'Q0', 'VCC'];
  const SR_Q = ['15', '1', '2', '3', '4', '5', '6', '7']; // Q0..Q7
  WB.defPart('sr595', {
    label: 'Shift register (74HC595)', category: 'ICs', prefix: 'U', dynamic: true, clocked: true,
    pins: () => dipPins(16, SR_LBL),
    bbox: () => dipBox(16),
    summary: () => '8-bit serial in, parallel out (shiftOut)',
    elements(c) {
      const st = c.state;
      if (st.sr === undefined) { st.sr = 0; st.lat = 0; }
      const out = [chipQuiescent(c, '16', '8')];
      const oe = (v, sup) => !isHi(v, c, '13', '8', sup);
      SR_Q.forEach((pin, i) => out.push(...pushPull(c, pin, '16', '8', (v, sup) => (oe(v, sup) ? (st.lat >> i) & 1 : null))));
      out.push(...pushPull(c, '9', '16', '8', () => (st.sr >> 7) & 1));
      // clock edges: one commit per solved point
      const nV = c.n('16'), nG = c.n('8');
      out[0].commit = (v) => {
        const sup = v(nV) - v(nG);
        if (sup < 2) return;
        const sh = isHi(v, c, '11', '8', sup), stc = isHi(v, c, '12', '8', sup), mr = isHi(v, c, '10', '8', sup);
        let changed = false;
        if (!mr) { if (st.sr) changed = true; st.sr = 0; }
        else if (sh && st.pSh === false) { st.sr = ((st.sr << 1) | (isHi(v, c, '14', '8', sup) ? 1 : 0)) & 255; changed = true; }
        if (stc && st.pSt === false) { if (st.lat !== st.sr) changed = true; st.lat = st.sr; }
        st.pSh = sh; st.pSt = stc;
        if (changed) st.fresh = true;
      };
      return out;
    },
    visualize(c) {
      supplyWarn(c, '16', '8', 6, 'the 74HC595');
      const again = !!c.state.fresh;
      c.state.fresh = false;
      return { lat: c.state.lat || 0, again };
    },
    render: (p, v) => dipBody(16, '74HC595', v && v.lat !== undefined ? 'Q7..Q0 ' + (v.lat >>> 0).toString(2).padStart(8, '0') : 'shift register'),
  });

  // ---------------------------------------------------------------- CD4511 BCD to 7-segment decoder
  const BCD = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'cdefg', 'abc', 'abcdefg', 'abcfg'];
  const DEC_LBL = ['B (input, 2)', 'C (input, 4)', 'LT (lamp test, active low — tie to VDD)', 'BL (blank, active low — tie to VDD)', 'LE (latch enable — tie to GND)', 'D (input, 8)', 'A (input, 1)', 'VSS (GND)', 'e', 'd', 'c', 'b', 'a', 'g', 'f', 'VDD'];
  const DEC_OUT = { a: '13', b: '12', c: '11', d: '10', e: '9', f: '15', g: '14' };
  WB.defPart('dec4511', {
    label: 'BCD to 7-segment decoder (CD4511)', category: 'ICs', prefix: 'U', dynamic: true,
    pins: () => dipPins(16, DEC_LBL),
    bbox: () => dipBox(16),
    summary: () => 'drives a common-cathode 7-segment display',
    elements(c) {
      const st = c.state;
      const out = [chipQuiescent(c, '16', '8')];
      const code = (v, sup) => {
        const H = (p) => isHi(v, c, p, '8', sup);
        if (H('5')) return st.code === undefined ? 15 : st.code; // latched
        return (H('7') ? 1 : 0) | (H('1') ? 2 : 0) | (H('2') ? 4 : 0) | (H('6') ? 8 : 0);
      };
      for (const seg in DEC_OUT) {
        out.push(...pushPull(c, DEC_OUT[seg], '16', '8', (v, sup) => {
          if (!isHi(v, c, '3', '8', sup)) return 1;
          if (!isHi(v, c, '4', '8', sup)) return 0;
          const k = code(v, sup);
          return k < 10 && BCD[k].includes(seg) ? 1 : 0;
        }, { r: 60 }));
      }
      out[0].commit = (v) => { const sup = v(c.n('16')) - v(c.n('8')); if (sup > 2) st.code = code(v, sup); };
      return out;
    },
    visualize(c) { supplyWarn(c, '16', '8', 18, 'the CD4511'); return { code: c.state.code }; },
    render: (p, v) => dipBody(16, 'CD4511', v && v.code !== undefined && v.code < 10 ? 'shows ' + v.code : 'BCD → 7-seg'),
  });

  // ---------------------------------------------------------------- L293D motor driver
  const HB_LBL = ['EN1,2 (enable 1 & 2)', '1A (input)', '1Y (output)', 'GND', 'GND', '2Y (output)', '2A (input)', 'VCC2 (motor supply)', 'EN3,4 (enable 3 & 4)', '3A (input)', '3Y (output)', 'GND', 'GND', '4Y (output)', '4A (input)', 'VCC1 (+5 V logic)'];
  WB.defPart('l293d', {
    label: 'H-bridge motor driver (L293D)', category: 'ICs', prefix: 'U', dynamic: true,
    pins: () => dipPins(16, HB_LBL),
    groups: () => [['4', '5', '12', '13']],
    bbox: () => dipBox(16),
    summary: () => '2 motors, 600 mA per channel',
    elements(c) {
      const out = [chipQuiescent(c, '16', '4', 20000)];
      for (const [en, a, y] of [['1', '2', '3'], ['1', '7', '6'], ['9', '10', '11'], ['9', '15', '14']]) {
        const els = pushPull(c, y, '8', '4', (v) => {
          const sup = v(c.n('16')) - v(c.n('4'));
          if (sup < 4) return null;
          if (!isHi(v, c, en, '4', sup)) return null;
          return isHi(v, c, a, '4', sup) ? 1 : 0;
        }, { r: 1, dh: 1.4, dl: 1.2, vmin: 2.5 });
        out.push(...els);
      }
      return out;
    },
    visualize(c) {
      supplyWarn(c, '16', '4', 7, 'the logic supply (VCC1)');
      for (const e of c.els) if (e.t === 'V' && Math.abs(e.i) > 1.2) { c.warn(`${c.name}: ${Math.abs(e.i).toFixed(1)} A on an output — the L293D gives at most 0.6 A per channel.`); break; }
      return {};
    },
    render: () => dipBody(16, 'L293D', 'H-bridge'),
  });

  // ---------------------------------------------------------------- More potentiometers
  // Same electrical model as the rotary potentiometer: End 1 – wiper – End 2, split by the position.
  const potInsp = [
    { key: 'ohms', label: 'Resistance (Ω)', type: 'number', min: 100, step: 'any', suggestions: [1000, 5000, 10000, 50000, 100000, 500000, 1000000] },
    { key: 'pos', label: 'Wiper position', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
  ];
  const potEls = (c) => WB.PARTS.pot.elements(c);
  WB.defPart('trimpot', {
    label: 'Trimmer potentiometer', category: 'Passive', prefix: 'RV', dynamic: true,
    interact: 'knob', knob: { key: 'pos', min: 0, max: 1, fmt: (v) => Math.round(v * 100) + '%' },
    defaults: { ohms: 10000, pos: 0.5 },
    pins: () => [{ id: '1', label: 'End 1', x: 0, y: 0 }, { id: 'W', label: 'Wiper (middle)', x: 10, y: 0 }, { id: '2', label: 'End 2', x: 20, y: 0 }],
    bbox: () => [-5, -26, 30, 29],
    summary: (p) => WB.fmtOhms(p.props.ohms) + ' trimmer',
    inspector: potInsp,
    elements: potEls,
    render(p) {
      const ang = -135 + 270 * clamp(Number(p.props.pos), 0, 1);
      return `${legs([0, 10, 20], 0, -5)}<rect x="-4" y="-24" width="28" height="19" rx="2" fill="#2f63c4" stroke="#173a75"/>
        <circle cx="10" cy="-14.5" r="7.5" fill="#e8e8e2" stroke="#8a8a84"/>
        <g transform="rotate(${ang.toFixed(1)} 10 -14.5)"><rect x="9" y="-21" width="2" height="13" rx=".8" fill="#555"/><rect x="3.5" y="-15.5" width="13" height="2" rx=".8" fill="#555" opacity=".35"/></g>
        ${T(10, -27.5, 5, WB.esc(WB.fmtOhms(p.props.ohms)), '#7d8798')}`;
    },
  });
  WB.defPart('slidepot', {
    label: 'Slide potentiometer', category: 'Input', prefix: 'RV', dynamic: true,
    interact: 'knob', knob: { key: 'pos', min: 0, max: 1, fmt: (v) => 'slider ' + Math.round(v * 100) + '%' },
    defaults: { ohms: 10000, pos: 0.5 },
    pins: () => [{ id: '1', label: 'End 1 (slider at 0%)', x: 0, y: 0 }, { id: 'W', label: 'Wiper', x: 10, y: 0 }, { id: '2', label: 'End 2 (slider at 100%)', x: 20, y: 0 }],
    bbox: () => [-36, -40, 92, 43],
    summary: (p) => WB.fmtOhms(p.props.ohms) + ' slider',
    inspector: potInsp,
    elements: potEls,
    render(p) {
      const x = -26 + 72 * clamp(Number(p.props.pos), 0, 1);
      return `${legs([0, 10, 20], 0, -8)}<rect x="-34" y="-38" width="88" height="30" rx="3" fill="#1d1d1f" stroke="#000"/>
        <rect x="-28" y="-25" width="76" height="4" rx="2" fill="#555"/>
        <rect x="${(x - 5).toFixed(1)}" y="-36" width="10" height="26" rx="2" fill="#e8e8e2" stroke="#8a8a84"/>
        <path d="M${(x - 3).toFixed(1)},-23 h6" stroke="#888" stroke-width="1.2"/>
        ${T(-28, -29.5, 4.5, '0', '#999')}${T(48, -29.5, 4.5, '100', '#999')}`;
    },
  });

  // ---------------------------------------------------------------- Dual DC power supply
  // Two floating channels, each constant-voltage with a current limit (then constant-current).
  // TRACK (series) mode links CH1 − to CH2 + inside and makes CH2 follow CH1: a ± supply
  // around the middle terminal (e.g. ±12 V for an op-amp).
  // SWEEP (per channel): the output moves from a start voltage to the set voltage over the
  // sweep time and repeats — a ramp, or up and down — for I–V curves on the scope in X-Y mode.
  const P2_I = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 1.5, 2, 3];
  const P2X = { 1: 10, 2: 90 }; // channel centres
  const P2BTN = [];
  for (const ch of [1, 2]) {
    const cx = P2X[ch];
    [['v--', '−1'], ['v-', '−.1'], ['v+', '+.1'], ['v++', '+1']].forEach(([a, t], k) => P2BTN.push({ a: a + ch, ch, x: cx - 29 + k * 14.75, y: -80, w: 13.5, h: 11, t }));
    [['i-', 'I −'], ['i+', 'I +'], ['sw', 'SWP']].forEach(([a, t], k) => P2BTN.push({ a: a + ch, ch, x: cx - 29 + k * 19.8, y: -65, w: 18.4, h: 11, t }));
  }
  P2BTN.push({ a: 'mode', x: 38, y: -112, w: 24, h: 14, t: 'TRACK' });
  const p2v = (p, ch) => clamp(Number(p.props[p.props.mode === 'series' && ch === 2 ? 'v1' : 'v' + ch]) || 0, 0, 30);
  const p2i = (p, ch) => clamp(Number(p.props[p.props.mode === 'series' && ch === 2 ? 'i1' : 'i' + ch]) || 1, 0.001, 3);
  // sweep of a channel (CH2 follows CH1 in TRACK mode): null, or { kind, lo, hi, period }
  const P2_SW = ['off', 'ramp', 'tri'];
  const p2sw = (p, ch) => {
    const c = p.props.mode === 'series' && ch === 2 ? 1 : ch;
    const kind = p.props['sw' + c];
    if (kind !== 'ramp' && kind !== 'tri') return null;
    return { kind, lo: clamp(Number(p.props['lo' + c]) || 0, 0, 30), hi: p2v(p, ch), period: clamp(Number(p.props['per' + c]) || 1, 0.001, 600) };
  };
  const fmtSec = (t) => (t < 1 ? +(t * 1000).toPrecision(3) + ' ms' : +t.toPrecision(3) + ' s');
  WB.defPart('psu2', {
    label: 'Dual power supply', category: 'Instruments', prefix: 'PS', dynamic: true, refPin: '1-', interact: 'panel',
    defaults: { v1: 12, i1: 0.5, v2: 5, i2: 0.5, mode: 'indep', sw1: 'off', lo1: 0, per1: 1, sw2: 'off', lo2: 0, per2: 1 },
    pins: () => [
      { id: '1+', label: 'CH1 + (red)', x: 0, y: 0, kind: 'pwr' }, { id: '1-', label: 'CH1 − (black)', x: 20, y: 0, kind: 'gnd' },
      { id: '2+', label: 'CH2 + (red)', x: 80, y: 0, kind: 'pwr' }, { id: '2-', label: 'CH2 − (black)', x: 100, y: 0, kind: 'gnd' },
    ],
    groups: (pr) => (pr.mode === 'series' ? [['1-', '2+']] : []),
    bbox: () => [-32, -124, 164, 130],
    summary: (p) => {
      const ch = (n) => { const w = p2sw(p, n); return w ? `${w.lo.toFixed(1)}→${w.hi.toFixed(1)} V sweep (${w.kind === 'tri' ? 'up and down' : 'ramp'}, ${fmtSec(w.period)})` : `${p2v(p, n).toFixed(1)} V`; };
      return p.props.mode === 'series' ? `± tracking, CH1 ${ch(1)}` : `CH1 ${ch(1)}, CH2 ${ch(2)}`;
    },
    inspector: [
      { key: 'mode', label: 'Mode', type: 'select', options: [['indep', 'Independent (two separate supplies)'], ['series', 'Tracking: CH1 − joined to CH2 +, CH2 = CH1 (± supply)']], live: true },
      { key: 'v1', label: 'CH1 voltage', type: 'range', min: 0, max: 30, step: 0.1, fmt: (v) => Number(v).toFixed(1) + ' V', live: true },
      { key: 'i1', label: 'CH1 current limit', type: 'range', min: 0.01, max: 3, step: 0.01, fmt: (v) => Number(v).toFixed(2) + ' A', live: true },
      { key: 'v2', label: 'CH2 voltage', type: 'range', min: 0, max: 30, step: 0.1, fmt: (v) => Number(v).toFixed(1) + ' V', live: true },
      { key: 'i2', label: 'CH2 current limit', type: 'range', min: 0.01, max: 3, step: 0.01, fmt: (v) => Number(v).toFixed(2) + ' A', live: true },
      ...[1, 2].flatMap((ch) => [
        { key: 'sw' + ch, label: `CH${ch} sweep`, type: 'select', options: [['off', 'Off (steady DC)'], ['ramp', 'Ramp: start → set voltage, then again'], ['tri', 'Up and down: start ↔ set voltage']], live: true },
        { key: 'lo' + ch, label: `CH${ch} sweep start voltage`, type: 'range', min: 0, max: 30, step: 0.1, fmt: (v) => Number(v).toFixed(1) + ' V', live: true },
        { key: 'per' + ch, label: `CH${ch} sweep time (s)`, type: 'number', min: 0.001, step: 'any', live: true, suggestions: [0.01, 0.02, 0.05, 0.1, 0.5, 1, 2, 5, 10], sugFmt: fmtSec },
      ]),
    ],
    hit(lx, ly) { const b = P2BTN.find((q) => lx >= q.x && lx <= q.x + q.w && ly >= q.y && ly <= q.y + q.h); return b ? b.a : null; },
    panelAction(part, act) {
      const pr = part.props;
      if (act === 'mode') { pr.mode = pr.mode === 'series' ? 'indep' : 'series'; return; }
      const ch = act.slice(-1), a = act.slice(0, -1);
      if (pr.mode === 'series' && ch === '2') return; // CH2 follows CH1
      if (a === 'sw') { pr['sw' + ch] = P2_SW[(P2_SW.indexOf(pr['sw' + ch] || 'off') + 1) % P2_SW.length]; return; }
      const vk = 'v' + ch, ik = 'i' + ch;
      const dv = { 'v--': -1, 'v-': -0.1, 'v+': 0.1, 'v++': 1 }[a];
      if (dv !== undefined) pr[vk] = +clamp((Number(pr[vk]) || 0) + dv, 0, 30).toFixed(1);
      else {
        const cur = Number(pr[ik]) || 1;
        const nx = a === 'i+' ? P2_I.find((x) => x > cur + 1e-9) : [...P2_I].reverse().find((x) => x < cur - 1e-9);
        if (nx !== undefined) pr[ik] = nx;
      }
    },
    elements(c) {
      const out = [];
      for (const ch of [1, 2]) {
        const p = { props: c.props };
        const vset = p2v(p, ch), ilim = p2i(p, ch), w = p2sw(p, ch);
        let e;
        if (c.state['cc' + ch]) e = { t: 'V', a: c.n(ch + '+'), b: c.n(ch + '-'), v: ilim * 1e6, r: 1e6 };
        // sweep: the solver's sawtooth (3 = triangle, 4 = sawtooth) around the middle of start and end
        else if (w) e = { t: 'V', a: c.n(ch + '+'), b: c.n(ch + '-'), v: (w.lo + w.hi) / 2, amp: (w.hi - w.lo) / 2, shape: w.kind === 'tri' ? 3 : 4, freq: 1 / w.period, r: 0.01 };
        else e = { t: 'V', a: c.n(ch + '+'), b: c.n(ch + '-'), v: vset, r: 0.01 };
        e.tag = ch;
        out.push(e);
      }
      return out;
    },
    visualize(c) {
      const out = {};
      let again = false;
      for (const ch of [1, 2]) {
        const e = c.els.find((x) => x.tag === ch);
        const p = { props: c.props };
        const w = p2sw(p, ch);
        const vset = w ? Math.max(w.lo, w.hi) : p2v(p, ch), ilim = p2i(p, ch);
        if (!e) { out['v' + ch] = 0; out['i' + ch] = 0; continue; }
        if (w) out['sw' + ch] = w.kind;
        const vout = c.V(ch + '+') - c.V(ch + '-');
        const k = 'cc' + ch;
        if (!c.state[k] && e.i > ilim * 1.001) { c.state[k] = true; again = true; }
        else if (c.state[k] && vout > vset) { c.state[k] = false; again = true; }
        out['v' + ch] = +Math.min(vout, vset).toFixed(2);
        out['i' + ch] = +Math.max(0, e.i).toFixed(3);
        out[k] = !!c.state[k];
      }
      out.again = again;
      return out;
    },
    render(p, v) {
      v = v || {};
      const series = p.props.mode === 'series';
      let s = `<rect x="-30" y="-122" width="160" height="116" rx="6" fill="#d7dbe0" stroke="#7d848c"/>`;
      for (const ch of [1, 2]) {
        const cx = P2X[ch];
        const vs = (v['v' + ch] !== undefined ? v['v' + ch] : p2v(p, ch)).toFixed(2);
        const is = (v['i' + ch] !== undefined ? v['i' + ch] : 0).toFixed(3);
        const lim = p2i(p, ch);
        const dim = series && ch === 2;
        s += `<text x="${cx}" y="-113" font-size="6" text-anchor="middle" fill="#333" font-family="sans-serif" font-weight="700">CH${ch}${dim ? ' (tracks CH1)' : ''}</text>
          <rect x="${cx - 29}" y="-109" width="58" height="26" rx="3" fill="#10151b"/>
          <text x="${cx + 18}" y="-96" font-size="11" text-anchor="end" fill="#ff5a4a" font-family="monospace" font-weight="700">${vs}</text>
          <text x="${cx + 20}" y="-96" font-size="5.5" fill="#ff5a4a" font-family="monospace">V</text>
          <text x="${cx + 18}" y="-86.5" font-size="7.5" text-anchor="end" fill="#4ade80" font-family="monospace" font-weight="700">${is}</text>
          <text x="${cx + 20}" y="-86.5" font-size="5.5" fill="#4ade80" font-family="monospace">A</text>
          <text x="${cx - 27}" y="-86.5" font-size="4.2" fill="#7f8a99" font-family="monospace">≤${lim}A</text>
          ${p2sw(p, ch) ? `<text x="${cx - 27}" y="-101" font-size="4.2" fill="#ffd166" font-family="monospace" font-weight="700">${p2sw(p, ch).kind === 'tri' ? 'SWP ⋀' : 'SWP ⟋'}</text>` : ''}
          <circle cx="${cx - 24}" cy="-46" r="2.3" fill="${v['cc' + ch] ? '#333' : '#4ade80'}"/><text x="${cx - 20}" y="-44" font-size="5" fill="#333" font-family="sans-serif">CV</text>
          <circle cx="${cx + 6}" cy="-46" r="2.3" fill="${v['cc' + ch] ? '#ff5a4a' : '#333'}"/><text x="${cx + 10}" y="-44" font-size="5" fill="#333" font-family="sans-serif">CC</text>
          <circle cx="${cx - 10}" cy="-24" r="6" fill="#111" stroke="#d62828" stroke-width="2.2"/><circle cx="${cx + 10}" cy="-24" r="6" fill="#111" stroke="#555" stroke-width="2.2"/>
          <text x="${cx - 10}" y="-33" font-size="6.5" text-anchor="middle" fill="#d62828" font-family="sans-serif" font-weight="700">+</text>
          <text x="${cx + 10}" y="-33" font-size="6.5" text-anchor="middle" fill="#333" font-family="sans-serif" font-weight="700">−</text>
          <path d="M${cx - 10},-18 V0" stroke="#d62828" stroke-width="2"/><path d="M${cx + 10},-18 V0" stroke="#222" stroke-width="2"/>`;
      }
      s += P2BTN.map((b) => {
        const off = series && b.ch === 2;
        const on = (b.a === 'mode' && series) || (/^sw/.test(b.a) && !!p2sw(p, b.ch));
        return `<g style="cursor:pointer" opacity="${off ? 0.35 : 1}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" fill="${on ? '#2d5fa8' : '#3a404b'}" stroke="${on ? '#7fb0ff' : '#1d2129'}" stroke-width=".7"/>
          <text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 2}" font-size="${b.a === 'mode' ? 5 : 5.6}" text-anchor="middle" fill="#eef1f6" font-family="sans-serif" font-weight="700">${b.t}</text></g>`;
      }).join('');
      s += `<text x="50" y="-90" font-size="4.6" text-anchor="middle" fill="#555" font-family="sans-serif">${series ? 'SERIES' : 'INDEP'}</text>
        <text x="50" y="-48" font-size="5.5" text-anchor="middle" fill="#333" font-family="sans-serif" font-weight="700">DUAL</text>
        <text x="50" y="-42" font-size="4.5" text-anchor="middle" fill="#333" font-family="sans-serif">DC POWER</text>
        ${series ? '<path d="M20,-24 C40,-10 60,-10 80,-24" stroke="#f2c200" stroke-width="1.6" fill="none" stroke-dasharray="2 1.5"/>' : ''}`;
      return s;
    },
  });

  // ---------------------------------------------------------------- Coin cell
  WB.defPart('coincell', {
    label: 'Coin cell (CR2032)', category: 'Power', prefix: 'BAT', refPin: '-',
    pins: () => [{ id: '+', label: '+', x: 0, y: 0, kind: 'pwr' }, { id: '-', label: '−', x: 20, y: 0, kind: 'gnd' }],
    bbox: () => [-14, -50, 48, 53],
    summary: () => '3 V, 15 Ω internal resistance',
    elements: (c) => [{ t: 'V', a: c.n('+'), b: c.n('-'), v: 3, r: 15 }],
    render() {
      return `<path d="M0,0 V-12" stroke="#d62828" stroke-width="1.8"/><path d="M20,0 V-12" stroke="#222" stroke-width="1.8"/>
        <rect x="-12" y="-16" width="44" height="8" rx="2" fill="#1d1d1f"/>
        <circle cx="10" cy="-30" r="18" fill="#c9ced6" stroke="#7b828c"/><circle cx="10" cy="-30" r="14" fill="#dfe3e8" stroke="#a7adb5"/>
        ${T(10, -32, 6, 'CR2032', '#555', ' font-weight="700"')}${T(10, -24, 6, '3V  +', '#555')}`;
    },
  });

  // ---------------------------------------------------------------- Controlled (dependent) sources
  // Ideal textbook / SPICE dependent sources (E, G, H, F). Pins in a row so they fit a breadboard:
  // control pair at x = 0, 10, output pair at x = 30, 40.
  //  - voltage-controlled: the control pins draw no current (ideal voltmeter).
  //  - current-controlled: the current flowing into "sense in" and out of "sense out" (through
  //    an internal 0.01 Ω sense resistor, like SPICE's 0 V ammeter source) is the control.
  //  - the output pushes current out of its + pin, through the load, back into its − pin.
  //    Voltage outputs have 0.01 Ω internal resistance.
  // All use the solver's controlled-current element 'G' (i(a→b) = gm·(V[p] − V[q])).
  const R_INT = 0.01;
  const DEP = {
    vcvs: { label: 'VCVS (voltage-controlled voltage source)', letter: 'E', cc: false, vout: true, key: 'gain', def: 10,
      field: 'Gain μ (V/V): Vout = μ · Vin', fmt: (k) => `Vout = ${k} × Vin`, badge: (k) => `×${k}`, gm: (k) => k / R_INT },
    vccs: { label: 'VCCS (voltage-controlled current source)', letter: 'G', cc: false, vout: false, key: 'gm', def: 1,
      field: 'Transconductance g (mA/V): Iout = g · Vin', fmt: (k) => `Iout = ${k} mA/V × Vin`, badge: (k) => `${k} mA/V`, gm: (k) => k / 1000 },
    ccvs: { label: 'CCVS (current-controlled voltage source)', letter: 'H', cc: true, vout: true, key: 'rm', def: 1000,
      field: 'Transresistance r (V/A, i.e. Ω): Vout = r · Iin', fmt: (k) => `Vout = ${WB.fmtOhms(k)} × Iin`, badge: (k) => WB.fmtOhms(k).replace(' ', ''), gm: (k) => k / R_INT / R_INT },
    cccs: { label: 'CCCS (current-controlled current source)', letter: 'F', cc: true, vout: false, key: 'beta', def: 100,
      field: 'Current gain β (A/A): Iout = β · Iin', fmt: (k) => `Iout = ${k} × Iin`, badge: (k) => `×${k}`, gm: (k) => k / R_INT },
  };
  for (const [type, d] of Object.entries(DEP)) {
    const k = (pr) => { const x = Number(pr[d.key]); return Number.isFinite(x) ? x : d.def; };
    WB.defPart(type, {
      label: d.label, category: 'Controlled sources', prefix: d.letter,
      defaults: { [d.key]: d.def },
      pins: () => [
        d.cc ? { id: 'S+', label: 'Sense in (control current flows in here)', x: 0, y: 0 } : { id: 'C+', label: 'Control + (Vin = V(C+) − V(C−))', x: 0, y: 0 },
        d.cc ? { id: 'S-', label: 'Sense out', x: 10, y: 0 } : { id: 'C-', label: 'Control −', x: 10, y: 0 },
        { id: 'O+', label: 'Output +', x: 30, y: 0 },
        { id: 'O-', label: 'Output −', x: 40, y: 0 },
      ],
      bbox: () => [-8, -42, 56, 45],
      summary: (p) => d.fmt(k(p.props)),
      inspector: [{ key: d.key, label: d.field, type: 'number', step: 'any', allowZero: true }],
      elements(c) {
        const cp = c.n(d.cc ? 'S+' : 'C+'), cn = c.n(d.cc ? 'S-' : 'C-'), op = c.n('O+'), on = c.n('O-');
        const els = [];
        if (d.cc) els.push({ t: 'R', a: cp, b: cn, r: R_INT, tag: 'sense' });
        // current pushed out of O+ (from O− to O+ inside the source)
        els.push({ t: 'G', a: on, b: op, p: cp, q: cn, gm: d.gm(k(c.props)), i0: 0 });
        if (d.vout) els.push({ t: 'R', a: op, b: on, r: R_INT });
        return els;
      },
      visualize(c) {
        const vo = c.V('O+') - c.V('O-');
        if (!d.vout && Math.abs(vo) > 1000) c.warn(`${c.name}: the current source's output is open (${Math.round(vo)} V). Connect a load between O+ and O−.`);
        if (d.vout && Math.abs(vo) > 1000) c.warn(`${c.name}: output above 1000 V. Check the gain and what drives the control input.`);
        return {};
      },
      render(p) {
        const kk = k(p.props);
        // input side: + / − marks or a current arrow; output side: diamond with + − or an arrow
        // body x −6..46; title across the top, gain + control marks on the left, diamond on the right
        const inMark = d.cc
          ? `<path d="M1,-11 H9" stroke="#e8edf3" stroke-width="1"/><path d="M6.5,-13.3 L9.5,-11 L6.5,-8.7" stroke="#e8edf3" stroke-width="1" fill="none"/>${T(-2, -9.3, 4.6, 'I', '#e8edf3', ' font-style="italic"')}`
          : `${T(0, -9, 6, '+', '#e8edf3', ' font-weight="700"')}${T(10, -9, 6, '−', '#e8edf3', ' font-weight="700"')}`;
        const sym = d.vout
          ? `${T(35, -18.5, 5, '+', '#1d1d1f', ' font-weight="700"')}${T(35, -11.5, 5, '−', '#1d1d1f', ' font-weight="700"')}`
          : '<path d="M35,-10.5 V-21.5" stroke="#1d1d1f" stroke-width="1.1"/><path d="M32.7,-18.8 L35,-22 L37.3,-18.8" stroke="#1d1d1f" stroke-width="1.1" fill="none"/>';
        return `${legs([0, 10, 30, 40], 0, -6)}
          <rect x="-6" y="-40" width="52" height="34" rx="3" fill="#2a3340" stroke="#121820"/>
          ${T(20, -32, 6, d.letter + ' · ' + type.toUpperCase(), '#e8edf3', ' font-weight="700"')}
          <path d="M35,-27 L43,-16 L35,-5 L27,-16 Z" fill="#f2c94c" stroke="#1d1d1f" stroke-width=".8"/>${sym}
          ${T(10, -20, 5, WB.esc(d.badge(kk)), '#9fd0ff')}${inMark}`;
      },
    });
  }

  // ---------------------------------------------------------------- Note (annotation)
  // A sticky note for comments on the canvas. No pins and no electrical elements; it is saved
  // with the project, ignored by the circuit, the auto-router and the parts list, and its text
  // can be edited even while the simulation runs.
  const NOTE_COLORS = { yellow: ['#fff3a3', '#d6c25a'], blue: ['#d3e9ff', '#7fa9d6'], green: ['#d8f5d2', '#80bf78'], pink: ['#ffd9e8', '#d991b0'], white: ['#ffffff', '#b8bec7'] };
  const NOTE_PAD = 6;
  // Text width in canvas units, measured with the same font the note is drawn in.
  let noteCtx = null;
  function textWidth(s, fs, bold) {
    if (!noteCtx) { try { noteCtx = document.createElement('canvas').getContext('2d'); } catch (e) { noteCtx = false; } }
    if (!noteCtx) return s.length * fs * 0.55; // no canvas: rough estimate
    noteCtx.font = `${bold ? '700 ' : ''}${fs}px sans-serif`;
    return noteCtx.measureText(s).width;
  }
  // Word-wrap the note's text into lines that fit its width (\n starts a new line).
  function noteLines(pr) {
    const w = +pr.width || 160, fs = +pr.size || 10, bold = fs >= 13;
    const room = w - 2 * NOTE_PAD;
    const fits = (s) => textWidth(s, fs, bold) <= room;
    const out = [];
    for (const para of String(pr.text == null ? '' : pr.text).split('\n')) {
      let line = '';
      for (let word of para.split(/\s+/).filter(Boolean)) {
        // a single word longer than the note is broken where it overflows
        while (!fits(word)) {
          if (line) { out.push(line); line = ''; }
          let k = word.length - 1;
          while (k > 1 && !fits(word.slice(0, k))) k--;
          out.push(word.slice(0, k)); word = word.slice(k);
        }
        if (!line) line = word;
        else if (fits(line + ' ' + word)) line += ' ' + word;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }
  const noteSize = (pr) => { const fs = +pr.size || 10; return [+pr.width || 160, Math.max(fs * 2.4, noteLines(pr).length * fs * 1.3 + 2 * NOTE_PAD)]; };
  WB.defPart('note', {
    label: 'Note', category: 'Notes', prefix: 'N', annotation: true,
    defaults: { text: 'Double-click to edit this note.', color: 'yellow', size: 10, width: 160 },
    pins: () => [],
    bbox: (pr) => { const [w, h] = noteSize(pr); return [0, 0, w, h]; },
    summary: (p) => { const t = String(p.props.text || '').trim().split('\n')[0]; return t.length > 30 ? t.slice(0, 30) + '…' : t || '(empty)'; },
    inspector: [
      { key: 'text', label: 'Text', type: 'text', live: true },
      { key: 'color', label: 'Color', type: 'select', live: true, options: Object.keys(NOTE_COLORS).map((c) => [c, c[0].toUpperCase() + c.slice(1)]) },
      { key: 'size', label: 'Text size', type: 'select', live: true, options: [[8, 'Small'], [10, 'Normal'], [13, 'Large'], [18, 'Heading']] },
      { key: 'width', label: 'Width', type: 'select', live: true, options: [[100, 'Narrow'], [160, 'Normal'], [240, 'Wide'], [340, 'Extra wide']] },
    ],
    render(p) {
      const pr = p.props, [w, h] = noteSize(pr), fs = +pr.size || 10;
      const [fill, edge] = NOTE_COLORS[pr.color] || NOTE_COLORS.yellow;
      const fold = Math.min(12, h / 3);
      const lines = noteLines(pr).map((l, i) => `<tspan x="${NOTE_PAD}" y="${(NOTE_PAD + fs * 0.95 + i * fs * 1.3).toFixed(1)}">${WB.esc(l) || ' '}</tspan>`).join('');
      return `<path d="M0,0 H${w} V${h - fold} L${w - fold},${h} H0 Z" fill="${fill}" stroke="${edge}" stroke-width=".8" filter="drop-shadow(0 1px 1.5px rgba(0,0,0,.25))"/>
        <path d="M${w},${h - fold} H${w - fold} V${h} Z" fill="${edge}" opacity=".55"/>
        <text font-size="${fs}" fill="#2b2b2b" font-family="sans-serif" style="white-space:pre"${fs >= 13 ? ' font-weight="700"' : ''}>${lines}</text>`;
    },
  });
})(window.WB);

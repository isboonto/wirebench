'use strict';
// Schematic sheet: turns the circuit on the workspace into a schematic diagram.
//
// Every component is drawn as its standard symbol (or, for boards, chips and modules, a box with
// its pin names, the way datasheets do). Two styles:
//  - wires (default): parts are placed next to the parts they connect to and every net is routed
//    as right-angle wires on a 10 px grid (dots on junctions; crossings without a dot are not
//    connected). Ground uses the ground symbol on each pin. A net the router can't finish falls
//    back to net labels on its pins.
//  - labels: parts in rows, connections shown with net labels (pins with the same label are
//    connected). Supply nets are named +5V / +3V3 / +9V…; nets on a board pin take the pin's
//    name (D9, A0, SDA); everything else is N1, N2, … — the same numbering as Export → Netlist.
// The sheet is A4 landscape (A3 for big circuits) with a parts list and a title block, and can
// be saved as SVG or PNG.
(function (WB) {
  const PARTS = WB.PARTS;
  const esc = (s) => WB.esc(String(s));
  const STUB = 20;          // pin stub length
  const FS = 11;            // label font size
  const tw = (s, fs) => String(s).length * (fs || FS) * 0.58 + 2; // rough text width
  const STROKE = 'stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'; // for filled shapes
  const LINE = STROKE + ' fill="none"';
  const THIN = 'stroke="#000" stroke-width="1.1" fill="none" stroke-linecap="round"';
  const T = (x, y, s, o) => `<text x="${x}" y="${y}" font-size="${(o && o.fs) || FS}"${o && o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o && o.bold ? ' font-weight="700"' : ''}${o && o.italic ? ' font-style="italic"' : ''} fill="${(o && o.fill) || '#000'}">${esc(s)}</text>`;
  const arrowHead = (x, y, ang, size) => {
    const s = size || 5, a = (ang * Math.PI) / 180;
    const p1 = [x - s * Math.cos(a - 0.45), y - s * Math.sin(a - 0.45)], p2 = [x - s * Math.cos(a + 0.45), y - s * Math.sin(a + 0.45)];
    return `<path d="M${x},${y} L${p1[0].toFixed(1)},${p1[1].toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)} Z" fill="#000"/>`;
  };
  const arrow = (x1, y1, x2, y2) => `<path d="M${x1},${y1} L${x2},${y2}" ${THIN}/>` + arrowHead(x2, y2, (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI, 4.5);

  // ------------------------------------------------------------------ symbols
  // A symbol is { w, h, body (SVG, local coordinates 0..w × 0..h), pins: [{ id, x, y, dir, num? }],
  // text: where the reference + value go }. dir is the direction the pin's stub points (l r u d).
  const twoPin = (a, b, body, extra) => Object.assign({ w: 60, h: 20, body, pins: [{ id: a, x: 0, y: 10, dir: 'l' }, { id: b, x: 60, y: 10, dir: 'r' }], text: 'above' }, extra || {});
  const RES = 'M0,10 H10 L13,4 L19,16 L25,4 L31,16 L37,4 L43,16 L47,10 H60';
  const resistor = (a, b, extra) => twoPin(a || '1', b || '2', `<path d="${RES}" ${LINE}/>${extra || ''}`);
  const DIODE = (bar) => `<path d="M0,10 H20 M40,10 H60" ${LINE}/><path d="M20,1 L20,19 L40,10 Z" ${STROKE} fill="#fff"/>${bar || '<path d="M40,1 V19" ' + LINE + '/>'}`;
  // vertical 2-pin symbols (batteries, sources) are drawn around x = 15 and shifted so the pins sit on x = 20
  const vertical = (top, bot, body) => ({ w: 40, h: 50, body: `<g transform="translate(5,0)">${body}</g>`, pins: [{ id: top, x: 20, y: 0, dir: 'u' }, { id: bot, x: 20, y: 50, dir: 'd' }], text: 'right' });
  const sourceCircle = (inner) => `<path d="M15,0 V10 M15,40 V50" ${LINE}/><circle cx="15" cy="25" r="15" ${LINE}/>${inner}`;
  const DC = `<path d="M15,13 V21 M11,17 H19 M11,33 H19" ${THIN}/>`;
  const SINE = `<path d="M5,25 C9,15 13,15 15,25 S21,35 25,25" ${THIN}/>`;

  function bjt(p, pnp, darl) {
    const em = pnp ? arrowHead(18, 36, 215, 6) : arrowHead(29, 44, 37, 6);
    return {
      w: 42, h: 60, text: 'right',
      body: `<circle cx="24" cy="30" r="17" ${LINE}/><path d="M0,30 H16 M16,19 V41 M16,25 L30,16 V0 M16,35 L30,44 V60" ${LINE}/>${em}${darl ? T(24, 52, 'Darl.', { fs: 6, anchor: 'middle' }) : ''}`,
      pins: [{ id: 'B', x: 0, y: 30, dir: 'l' }, { id: 'C', x: 30, y: 0, dir: 'u' }, { id: 'E', x: 30, y: 60, dir: 'd' }],
    };
  }
  function mosfet(p, pmos) {
    return {
      w: 40, h: 60, text: 'right',
      body: `<path d="M0,30 H13 M13,18 V42 M19,16 V23 M19,27 V33 M19,37 V44 M19,20 H30 V0 M19,40 H30 V60 M19,30 H30 V40" ${LINE}/>${pmos ? arrowHead(29, 30, 0, 6) : arrowHead(20, 30, 180, 6)}`,
      pins: [{ id: 'G', x: 0, y: 30, dir: 'l' }, { id: 'D', x: 30, y: 0, dir: 'u' }, { id: 'S', x: 30, y: 60, dir: 'd' }],
    };
  }
  const opampTri = (y, inn, inp, out, sfx) => ({
    body: `<path d="M0,${y} L0,${y + 60} L60,${y + 30} Z" ${STROKE} fill="#fff"/>${T(5, y + 24, '−', { fs: 13 })}${T(5, y + 45, '+', { fs: 13 })}${sfx ? T(28, y + 34, sfx, { fs: 8 }) : ''}`,
    pins: [{ id: inn, x: 0, y: y + 20, dir: 'l' }, { id: inp, x: 0, y: y + 40, dir: 'l' }, { id: out, x: 60, y: y + 30, dir: 'r' }],
  });
  function opamp(p) {
    if (p.props.model === 'LM358' || p.type === 'lm358') {
      const a = opampTri(0, '2', '3', '1', 'A'), b = opampTri(80, '6', '5', '7', 'B');
      return { w: 60, h: 140, text: 'right', body: a.body + b.body, pins: a.pins.concat(b.pins, [{ id: '8', x: 20, y: 10, dir: 'u' }, { id: '4', x: 20, y: 130, dir: 'd' }]) };
    }
    const a = opampTri(0, '2', '3', '6');
    return { w: 60, h: 60, text: 'right', body: a.body, pins: a.pins.concat([{ id: '7', x: 20, y: 10, dir: 'u' }, { id: '4', x: 20, y: 50, dir: 'd' }]) };
  }
  function controlled(p) {
    const cc = p.type === 'ccvs' || p.type === 'cccs', vout = p.type === 'vcvs' || p.type === 'ccvs';
    const inside = vout ? `${T(60, 25, '+', { fs: 10, anchor: 'middle' })}${T(60, 40, '−', { fs: 10, anchor: 'middle' })}` : arrow(60, 38, 60, 22);
    const ctrl = cc
      ? `<path d="M0,20 H12 V40 H0" ${LINE}/>${arrowHead(12, 33, 90, 6)}${T(16, 33, 'i', { fs: 10, italic: true })}`
      : `<path d="M0,20 H8 M0,40 H8" ${LINE}/>${T(11, 24, '+', { fs: 10 })}${T(11, 44, '−', { fs: 10 })}`;
    return {
      w: 80, h: 60, text: 'right',
      body: `${ctrl}<path d="M60,0 V14 M60,46 V60" ${LINE}/><path d="M60,14 L76,30 L60,46 L44,30 Z" ${STROKE} fill="#fff"/>${inside}<path d="M24,30 H40" stroke="#000" stroke-width="1" stroke-dasharray="3 2"/>`,
      pins: [{ id: cc ? 'S+' : 'C+', x: 0, y: 20, dir: 'l' }, { id: cc ? 'S-' : 'C-', x: 0, y: 40, dir: 'l' }, { id: 'O+', x: 60, y: 0, dir: 'u' }, { id: 'O-', x: 60, y: 60, dir: 'd' }],
    };
  }

  const SYMBOLS = {
    resistor: () => resistor(),
    ldr: () => resistor('1', '2', arrow(20, -12, 26, -3) + arrow(30, -12, 36, -3)),
    flex: () => resistor('1', '2', `<path d="M14,22 L46,-2" ${THIN}/>` + T(30, 30, 'flex', { fs: 7, anchor: 'middle' })),
    fsr: () => resistor('1', '2', `<path d="M14,22 L46,-2" ${THIN}/>` + T(30, 30, 'FSR', { fs: 7, anchor: 'middle' })),
    capacitor: () => twoPin('1', '2', `<path d="M0,10 H26 M26,0 V20 M34,0 V20 M34,10 H60" ${LINE}/>`),
    ecap: () => twoPin('+', '-', `<path d="M0,10 H26 M26,0 V20 M33,10 H60" ${LINE}/><path d="M37,0 Q31,10 37,20" ${LINE}/>${T(17, 6, '+', { fs: 10 })}`),
    inductor: () => twoPin('1', '2', `<path d="M0,10 H10 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 H60" ${LINE}/>`),
    diode: () => twoPin('A', 'K', DIODE()),
    zener: () => twoPin('A', 'K', DIODE(`<path d="M44,-1 L40,1 V19 L36,21" ${LINE}/>`)),
    led: () => twoPin('A', 'K', DIODE() + arrow(28, -1, 36, -9) + arrow(34, 2, 42, -6)),
    photodiode: () => twoPin('A', 'K', DIODE() + arrow(36, -10, 29, -2) + arrow(42, -7, 35, 1)),
    buzzer: () => twoPin('+', '-', `<path d="M0,10 H22 M22,2 V18 M38,2 V18 M38,10 H60" ${LINE}/><rect x="25" y="4" width="10" height="12" ${LINE}/>${T(13, 4, '+', { fs: 9 })}`),
    motor: () => twoPin('+', '-', `<path d="M0,10 H18 M42,10 H60" ${LINE}/><circle cx="30" cy="10" r="12" ${LINE}/>${T(30, 14, 'M', { fs: 11, anchor: 'middle', bold: true })}`),
    vibmotor: () => SYMBOLS.motor(),
    bulb: () => twoPin('1', '2', `<path d="M0,10 H18 M42,10 H60" ${LINE}/><circle cx="30" cy="10" r="12" ${LINE}/><path d="M22,2 L38,18 M38,2 L22,18" ${THIN}/>`),
    tilt: () => twoPin('1', '2', `<path d="M0,10 H18 M42,10 H60 M20,10 L39,2" ${LINE}/><circle cx="20" cy="10" r="2" ${LINE}/><circle cx="40" cy="10" r="2" ${LINE}/>${T(30, 24, 'tilt', { fs: 7, anchor: 'middle' })}`),
    button: () => twoPin('1', '3', `<path d="M0,10 H18 M42,10 H60 M16,3 H44 M30,3 V-5 M26,-5 H34" ${LINE}/><circle cx="20" cy="10" r="2" ${LINE}/><circle cx="40" cy="10" r="2" ${LINE}/>`),
    switch: (p) => ({
      w: 60, h: 40, text: 'above',
      body: `<path d="M0,20 H20 M42,10 H60 M42,30 H60" ${LINE}/><circle cx="20" cy="20" r="2" ${LINE}/><circle cx="42" cy="10" r="2" ${LINE}/><circle cx="42" cy="30" r="2" ${LINE}/><path d="M20,20 L40,${p.props.on ? 29 : 11}" ${LINE}/>`,
      pins: [{ id: 'C', x: 0, y: 20, dir: 'l' }, { id: '1', x: 60, y: 10, dir: 'r' }, { id: '2', x: 60, y: 30, dir: 'r' }],
    }),
    pot: () => ({
      w: 60, h: 30, text: 'above',
      body: `<path d="${RES}" ${LINE}/>${arrow(30, 30, 30, 15)}`,
      pins: [{ id: '1', x: 0, y: 10, dir: 'l' }, { id: '2', x: 60, y: 10, dir: 'r' }, { id: 'W', x: 30, y: 30, dir: 'd' }],
    }),
    trimpot: () => SYMBOLS.pot(),
    slidepot: () => SYMBOLS.pot(),
    battery: () => vertical('+', '-', `<path d="M15,0 V20 M15,28 V50 M3,20 H27 M9,28 H21" ${LINE}/>${T(22, 14, '+', { fs: 10 })}`),
    coincell: () => SYMBOLS.battery(),
    psu: () => vertical('+', '-', sourceCircle(DC)),
    fgen: () => vertical('+', 'COM', sourceCircle(SINE)),
    psu2: () => ({
      w: 90, h: 50, text: 'right',
      body: `<g transform="translate(5,0)">${sourceCircle(DC)}<g transform="translate(50,0)">${sourceCircle(DC)}</g>${T(15, 62, 'CH1', { fs: 7, anchor: 'middle' })}${T(65, 62, 'CH2', { fs: 7, anchor: 'middle' })}</g>`,
      pins: [{ id: '1+', x: 20, y: 0, dir: 'u' }, { id: '1-', x: 20, y: 50, dir: 'd' }, { id: '2+', x: 70, y: 0, dir: 'u' }, { id: '2-', x: 70, y: 50, dir: 'd' }],
    }),
    multimeter: (p) => {
      const m = String(p.props.mode || 'V'), letter = /Ω|ohm/i.test(m) ? 'Ω' : /^A/.test(m) ? 'A' : 'V';
      return {
        w: 60, h: 60, text: 'right',
        body: `<circle cx="30" cy="30" r="18" ${LINE}/>${T(30, 35, letter + (m.includes('~') ? '~' : ''), { fs: 13, anchor: 'middle', bold: true })}<path d="M30,0 V12 M30,48 V60 M0,30 H12" ${LINE}/>${T(3, 26, 'A', { fs: 7 })}${T(34, 8, 'V', { fs: 7 })}${T(34, 58, 'COM', { fs: 7 })}`,
        pins: [{ id: 'V', x: 30, y: 0, dir: 'u' }, { id: 'COM', x: 30, y: 60, dir: 'd' }, { id: 'A', x: 0, y: 30, dir: 'l' }],
      };
    },
    voltmeter: (p) => vertical('+', '-', `<path d="M15,0 V10 M15,40 V50" ${LINE}/><circle cx="15" cy="25" r="15" ${LINE}/>${T(15, 30, p.props.mode === 'AC' ? 'V~' : 'V', { fs: 12, anchor: 'middle', bold: true })}${T(20, 8, '+', { fs: 8 })}`),
    ammeter: (p) => vertical('+', '-', `<path d="M15,0 V10 M15,40 V50" ${LINE}/><circle cx="15" cy="25" r="15" ${LINE}/>${T(15, 30, p.props.mode === 'AC' ? 'A~' : 'A', { fs: 12, anchor: 'middle', bold: true })}${T(20, 8, '+', { fs: 8 })}`),
    npn: (p) => bjt(p, false), pnp: (p) => bjt(p, true), darlington: (p) => bjt(p, false, true),
    nmos: (p) => mosfet(p, false), pmos: (p) => mosfet(p, true),
    regulator: (p) => ({
      w: 80, h: 40, text: 'above',
      body: `<rect x="0" y="0" width="80" height="40" ${LINE}/>${T(40, 16, p.props.model === '1117' ? 'LM1117' : 'L' + (p.props.model || '7805'), { fs: 9, anchor: 'middle', bold: true })}${T(5, 31, 'IN', { fs: 7 })}${T(75, 31, 'OUT', { fs: 7, anchor: 'end' })}${T(40, 36, 'GND', { fs: 7, anchor: 'middle' })}`,
      pins: [{ id: 'IN', x: 0, y: 20, dir: 'l' }, { id: 'OUT', x: 80, y: 20, dir: 'r' }, { id: 'GND', x: 40, y: 40, dir: 'd' }],
    }),
    opamp, lm358: opamp,
    vcvs: controlled, vccs: controlled, ccvs: controlled, cccs: controlled,
  };

  // Full board symbol, laid out like the usual Arduino schematic symbols: supply pins on top,
  // GND and RESET at the bottom, analog inputs on the left, digital pins on the right in header
  // order (the Mega's 22–53 along the bottom). Pin names carry their functions: ~ = PWM, RX/TX,
  // SDA/SCL, LED (D13). Every pin is drawn, used or not.
  function boardSymbol(p, def) {
    const spec = def.board, ids = new Set(def.pins(p.props || {}).filter((q) => !q.hidden).map((q) => q.id));
    const has = (id) => ids.has(id);
    const mega = spec.layout === 'mega', nano = spec.layout === 'nano';
    const i2cOnA = !!spec.i2cA4 || nano;            // SDA/SCL are the same pins as A4/A5
    const fn = {};
    if (mega) Object.assign(fn, { D0: 'RX0', D1: 'TX0', D14: 'TX3', D15: 'RX3', D16: 'TX2', D17: 'RX2', D18: 'TX1', D19: 'RX1', D20: 'SDA', D21: 'SCL' });
    else Object.assign(fn, { D0: 'RX', D1: 'TX' });
    fn.D13 = 'LED';
    if (i2cOnA) Object.assign(fn, { A4: 'SDA', A5: 'SCL' });
    const digital = (n) => ({ id: 'D' + n, name: (spec.pwm.includes(n) ? '~' : '') + 'D' + n, fn: fn['D' + n] });
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    // sides; null = a small gap between pin groups
    const top = ['VIN', '5V', '3V3', 'IOREF', 'AREF'].filter(has).map((id) => ({ id, name: id }));
    const bottom = [{ id: 'GND', name: 'GND' }, { id: 'RESET', name: 'RESET' }].filter((q) => has(q.id));
    const analog = range(0, spec.analogCount - 1).filter((i) => has('A' + i)).map((i) => ({ id: 'A' + i, name: 'A' + i, fn: fn['A' + i] }));
    const left = analog.slice();
    if (!i2cOnA && !mega && has('SDA')) left.push(null, { id: 'SDA', name: 'SDA' }, { id: 'SCL', name: 'SCL' });
    const right = [];
    const dTop = mega ? 21 : 13;
    if (spec.esp32) { Object.assign(fn, spec.cyd7 ? { D43: 'TX', D44: 'RX', D19: 'SDA', D20: 'SCL' } : { D1: 'TX', D3: 'RX', D21: 'BL', D35: 'in' }); for (const n of range(0, 48)) if (has('D' + n)) right.push({ id: 'D' + n, name: 'IO' + n, fn: fn['D' + n] }); }
    else for (const n of range(0, dTop)) { if (n === 8 || (mega && n === 14)) right.push(null); right.push(digital(n)); }
    if (mega) { bottom.push(null); for (const n of range(22, 53)) bottom.push(digital(n)); }

    // geometry: 20 px pin pitch; names inside the box (top / bottom ones rotated)
    const label = (q) => q.name + (q.fn ? ' ' + q.fn : '');
    const sideW = (list) => Math.max(0, ...list.filter(Boolean).map((q) => tw(label(q), 9)));
    const vertLen = (list) => Math.max(0, ...list.filter(Boolean).map((q) => tw(label(q), 8)));
    const topPad = top.length ? Math.ceil((vertLen(top) + 14) / 10) * 10 : 20;
    const botPad = bottom.length ? Math.ceil((vertLen(bottom) + 14) / 10) * 10 : 20;
    const rows = Math.max(left.length, right.length);
    const h = topPad + (rows - 1) * 20 + botPad;
    const title = spec.short || def.label;
    const titleW = Math.max(tw(title, 14), 80);
    let w = Math.max(sideW(left) + sideW(right) + titleW + 50, (top.length + 1) * 20 + 20, (bottom.length + 1) * 20 + 20);
    w = Math.ceil(w / 10) * 10;
    let body = `<rect x="0" y="0" width="${w}" height="${h}" rx="4" ${STROKE} fill="#fff"/>`;
    const pins = [];
    const fnText = (q) => (q.fn ? ` <tspan fill="#555" font-size="7.5">${esc(q.fn)}</tspan>` : '');
    left.forEach((q, i) => { if (!q) return; const y = topPad + i * 20; pins.push({ id: q.id, x: 0, y, dir: 'l' }); body += `<text x="6" y="${y + 3.5}" font-size="9" fill="#000">${esc(q.name)}${fnText(q)}</text>`; });
    right.forEach((q, i) => { if (!q) return; const y = topPad + i * 20; pins.push({ id: q.id, x: w, y, dir: 'r' }); body += `<text x="${w - 6}" y="${y + 3.5}" font-size="9" text-anchor="end" fill="#000">${esc(q.name)}${fnText(q)}</text>`; });
    top.forEach((q, i) => { const x = 20 + i * 20; pins.push({ id: q.id, x, y: 0, dir: 'u' }); body += `<text transform="translate(${x + 3},6) rotate(90)" font-size="8.5" fill="#000">${esc(q.name)}</text>`; });
    bottom.forEach((q, i) => { if (!q) return; const x = 20 + i * 20; pins.push({ id: q.id, x, y: h, dir: 'd' }); body += `<text transform="translate(${x + 3},${h - 6}) rotate(-90)" font-size="8.5" fill="#000">${esc(q.name)}${fnText(q)}</text>`; });
    // board name in the middle
    const cx = (sideW(left) + 6 + (w - sideW(right) - 6)) / 2, cy = topPad + ((rows - 1) * 20) / 2;
    // reference and description inside the box: outside, they would clash with the pin stubs
    body += T(cx, cy - 8, p.name || '', { fs: 11, bold: true, anchor: 'middle' })
      + T(cx, cy + 8, title, { fs: 14, bold: true, anchor: 'middle' })
      + T(cx, cy + 22, spec.vcc === 3.3 ? '3.3 V logic' : '5 V logic', { fs: 8, anchor: 'middle', fill: '#555' });
    return { w, h, body, pins, text: 'inside' };
  }

  // Box symbol with pin names (chips, modules, sensors, displays …).
  //  - DIP chips: pins 1..n/2 down the left, n..n/2+1 down the right (datasheet order), all shown.
  //  - boards: only the pins in use; power and analog pins on the left, digital pins on the right.
  //  - anything else: its pins in order, first half left, second half right.
  const pinName = (q) => { const m = /^\d+ · (.*)$/.exec(q.label || ''); return (m ? m[1] : q.id).replace(/\s*\(.*\)\s*$/, ''); };
  const boardPinName = (id) => id.replace(/^GND\d+$/, 'GND').replace(/^5V_\d$/, '5V').replace(/^RESET2$/, 'RESET');
  function boxSymbol(p, def, used) {
    const pins = def.pins(p.props || {});
    let left, right, nums = false;
    const dip = pins.length >= 4 && pins.length % 2 === 0 && pins.every((q) => /^\d+$/.test(q.id)) && new Set(pins.map((q) => q.y)).size === 2;
    if (def.board) {
      // one entry per internally joined group (5V / 5V_1 / 5V_2, SDA / D20 …)
      const groups = (def.groups ? def.groups(p.props || {}) : []);
      const seen = new Set(), list = [];
      for (const q of pins) {
        if (!used.has(q.id) || q.side === 'qwiic') continue;
        const g = groups.find((gr) => gr.includes(q.id));
        const key = /^GND/.test(q.id) ? 'GND' : g ? g[0] : q.id; // all of a board's GND pins are one ground
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ id: q.id, name: boardPinName(q.id) });
      }
      const isLeft = (q) => /^(5V|3V3|VIN|GND|IOREF|RESET|AREF|A\d+)/.test(q.name);
      left = list.filter(isLeft); right = list.filter((q) => !isLeft(q));
      const order = (n) => { const m = /^(\D+)(\d+)$/.exec(n); return m ? [m[1], +m[2]] : [n, 0]; };
      const cmp = (a, b) => { const x = order(a.name), y = order(b.name); return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]; };
      const pw = ['5V', '3V3', 'VIN', 'IOREF', 'RESET', 'AREF', 'GND'];
      left.sort((a, b) => { const ia = pw.indexOf(a.name), ib = pw.indexOf(b.name); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || cmp(a, b); });
      right.sort(cmp);
    } else if (dip) {
      const n = pins.length, by = (k) => pins.find((q) => q.id === String(k));
      left = []; right = [];
      for (let k = 1; k <= n / 2; k++) left.push({ id: String(k), name: pinName(by(k)), num: k });
      for (let k = n; k > n / 2; k--) right.push({ id: String(k), name: pinName(by(k)), num: k });
      nums = true;
    } else {
      const groups = def.groups ? def.groups(p.props || {}) : [];
      const list = pins.filter((q) => !groups.some((g) => g.indexOf(q.id) > 0)).map((q) => ({ id: q.id, name: q.id }));
      const h = Math.ceil(list.length / 2);
      left = list.slice(0, h); right = list.slice(h);
    }
    const rows = Math.max(left.length, right.length, 1);
    const nameW = Math.max(30, ...left.concat(right).map((q) => tw(q.name, 9)));
    const w = Math.max(70, Math.ceil((nameW * 2 + 24) / 10) * 10), h = rows * 20 + 20;
    let body = `<rect x="0" y="0" width="${w}" height="${h}" ${STROKE} fill="#fff"/>`;
    const out = [];
    left.forEach((q, i) => { const y = 20 + i * 20; out.push({ id: q.id, x: 0, y, dir: 'l', num: q.num }); body += T(5, y + 3.5, q.name, { fs: 9 }); });
    right.forEach((q, i) => { const y = 20 + i * 20; out.push({ id: q.id, x: w, y, dir: 'r', num: q.num }); body += T(w - 5, y + 3.5, q.name, { fs: 9, anchor: 'end' }); });
    if (dip) body += `<path d="M${w / 2 - 7},0 a7,7 0 0 0 14,0" ${THIN}/>`;
    return { w, h, body, pins: out, text: 'box', nums };
  }

  // ------------------------------------------------------------------ nets
  function analyse(app) {
    const topo = app.getTopo();
    const byId = new Map(app.project.parts.map((p) => [p.id, p]));
    const visible = (p) => p && PARTS[p.type] && !PARTS[p.type].holes && !PARTS[p.type].annotation;
    const members = topo.nets.map((keys) => keys.filter((k) => visible(byId.get(k.split(':')[0]))));
    // a net shows a label only if it joins at least two pins of components (ground always does)
    const names = new Map();
    let n = 0;
    const board = app.project.parts.find((p) => PARTS[p.type] && PARTS[p.type].board);
    members.forEach((keys, idx) => {
      if (idx === 0) { if (keys.length) names.set(0, 'GND'); return; }
      // only nets that join two different parts (a board's internal links such as SDA = A4 alone don't count)
      if (new Set(keys.map((k) => k.split(':')[0])).size < 2) return;
      let name = null;
      for (const k of keys) {
        const [pid, pin] = k.split(':'), p = byId.get(pid), def = PARTS[p.type];
        if (def.board) {
          if (/^5V/.test(pin)) name = '+5V';
          else if (pin === '3V3' || pin === 'Q3V3') name = '+3V3';
          else if (pin === 'VIN') name = 'VIN';
          else if (!name) name = boardPinName(pin);
          if (/^\+/.test(name)) break;
        }
      }
      if (!name) {
        // positive terminal of a supply whose negative side is grounded
        for (const k of keys) {
          const [pid, pin] = k.split(':'), p = byId.get(pid);
          const neg = { battery: '-', coincell: '-', psu: '-' }[p.type];
          if (neg && pin === '+' && topo.nodeOf.get(pid + ':' + neg) === 0) {
            const v = p.type === 'coincell' ? 3 : Number(p.props.volts);
            if (v) { name = '+' + (Math.round(v * 10) / 10) + 'V'; break; }
          }
        }
      }
      names.set(idx, name || 'N' + ++n);
    });
    // the same supply name on two different nets would claim a connection that isn't there
    const seen = new Map();
    for (const [idx, nm] of names) {
      if (idx === 0) continue;
      if (seen.has(nm)) names.set(idx, nm + '_' + idx); else seen.set(nm, idx);
    }
    return { topo, members, names, board };
  }

  // ------------------------------------------------------------------ drawing
  // compact ground for side pins: fits between two pin rows (20 px apart)
  const groundSmall = (x, y) => `<path d="M${x},${y} V${y + 5} M${x - 7},${y + 5} H${x + 7} M${x - 4.5},${y + 8} H${x + 4.5} M${x - 2},${y + 11} H${x + 2}" ${LINE}/>`;
  function groundSym(x, y, dir) {
    const rot = { d: 0, l: 90, u: 180, r: -90 }[dir];
    return `<g transform="translate(${x},${y}) rotate(${rot})"><path d="M0,0 V6 M-9,6 H9 M-6,10 H6 M-3,14 H3" ${LINE}/></g>`;
  }
  function netLabel(x, y, dir, name) {
    const power = /^\+|^VIN$/.test(name);
    const o = { fs: FS, bold: power };
    if (dir === 'r') return T(x + 4, y + 4, name, o);
    if (dir === 'l') return T(x - 4, y + 4, name, Object.assign(o, { anchor: 'end' }));
    if (dir === 'u') return T(x, y - 5, name, Object.assign(o, { anchor: 'middle' }));
    return T(x, y + 14, name, Object.assign(o, { anchor: 'middle' }));
  }
  const labelBox = (x, y, dir, name) => {
    const w = tw(name);
    if (dir === 'r') return [x + 2, y - 8, x + w + 6, y + 6];
    if (dir === 'l') return [x - w - 6, y - 8, x - 2, y + 6];
    if (dir === 'u') return [x - w / 2, y - 18, x + w / 2, y - 2];
    return [x - w / 2, y + 2, x + w / 2, y + 18];
  };
  const DIRV = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };

  // Draw one part. In label mode every connected pin gets its net label; in wire mode only
  // ground gets a symbol and the other pins are returned as terminals for the router.
  // Returns { svg, x0, y0, x1, y1 (bounding box), terms, keepOut (rectangles wires must avoid) }.
  function drawPart(p, def, A, wires) {
    const used = new Set();
    for (const q of def.pins(p.props || {})) {
      const idx = A.topo.nodeOf.get(p.id + ':' + q.id);
      if (idx !== undefined && (idx === 0 || A.names.has(idx))) used.add(q.id);
    }
    const sym = SYMBOLS[p.type] ? SYMBOLS[p.type](p, def) : def.board ? boardSymbol(p, def) : boxSymbol(p, def, used);
    let s = sym.body, x0 = 0, y0 = 0, x1 = sym.w, y1 = sym.h;
    const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    const keepOut = [[0, 0, sym.w, sym.h]], terms = [];
    // body extras (e.g. LED arrows) reach a little outside
    grow(-2, -12); grow(sym.w + 2, sym.h + 2);
    for (const pin of sym.pins) {
      const [dx, dy] = DIRV[pin.dir], ex = pin.x + dx * STUB, ey = pin.y + dy * STUB;
      s += `<path d="M${pin.x},${pin.y} L${ex},${ey}" ${LINE}/>`;
      keepOut.push([Math.min(pin.x, ex - dx * 10), Math.min(pin.y, ey - dy * 10), Math.max(pin.x, ex - dx * 10), Math.max(pin.y, ey - dy * 10)]);
      if (pin.num != null) s += T(pin.x + dx * 9, pin.y - 3, pin.num, { fs: 7, anchor: 'middle', fill: '#444' });
      grow(ex, ey);
      const idx = A.topo.nodeOf.get(p.id + ':' + pin.id);
      if (idx === 0) {
        // ground always points down: side pins get a short drop first; pins pointing up keep it upside down
        if (pin.dir === 'l' || pin.dir === 'r') { s += groundSmall(ex, ey); grow(ex - 8, ey + 13); grow(ex + 8, ey + 13); keepOut.push([ex - 7, ey + 3, ex + 7, ey + 12]); } // just the symbol, not the pin above it
        else { s += groundSym(ex, ey, pin.dir); grow(ex - 10, ey + dy * 16); grow(ex + 10, ey + dy * 16); keepOut.push([ex - 10, Math.min(ey, ey + dy * 16), ex + 10, Math.max(ey, ey + dy * 16)]); }
      } else if (idx !== undefined && A.names.has(idx)) {
        terms.push({ net: idx, x: ex, y: ey, dir: pin.dir });
        if (!wires) {
          const name = A.names.get(idx), b = labelBox(ex, ey, pin.dir, name);
          s += `<circle cx="${ex}" cy="${ey}" r="2" fill="#000"/>` + netLabel(ex, ey, pin.dir, name);
          grow(b[0], b[1]); grow(b[2], b[3]);
        }
      } else if (!def.board) {
        // not connected to anything: small cross at the end of the stub (boards show many unused
        // pins, so there a plain stub is enough)
        s += `<path d="M${ex - 3},${ey - 3} L${ex + 3},${ey + 3} M${ex + 3},${ey - 3} L${ex - 3},${ey + 3}" stroke="#888" stroke-width="1"/>`;
        keepOut.push([ex - 4, ey - 4, ex + 4, ey + 4]);
      } else keepOut.push([ex, ey, ex, ey]); // keep wires off unused board pins
    }
    // reference and value
    const ref = p.name || '', val = def.board ? def.label : def.summary ? def.summary(p) : def.label;
    const valShort = String(val).length > 34 ? String(val).slice(0, 33) + '…' : val;
    const tW = Math.max(tw(ref), tw(valShort, 9));
    if (sym.text === 'inside') { /* drawn by the symbol itself */ }
    else if (sym.text === 'box') {
      s += T(sym.w / 2, -8, ref, { anchor: 'middle', bold: true }) + T(sym.w / 2, sym.h + 14, valShort, { fs: 9, anchor: 'middle' });
      keepOut.push([sym.w / 2 - tw(ref) / 2, -20, sym.w / 2 + tw(ref) / 2, -2], [sym.w / 2 - tw(valShort, 9) / 2, sym.h + 4, sym.w / 2 + tw(valShort, 9) / 2, sym.h + 18]);
      grow(sym.w / 2 - tw(ref) / 2, -20); grow(sym.w / 2 + tw(valShort, 9) / 2, sym.h + 18); grow(sym.w / 2 - tw(valShort, 9) / 2, sym.h + 18);
    } else if (sym.text === 'right') {
      // to the right of the body, clear of pins that leave sideways
      const right = Math.max(sym.w, ...sym.pins.filter((q) => q.dir === 'r').map(() => sym.w + STUB + 4));
      const tx = right + 6, ty = sym.h / 2;
      s += T(tx, ty - 2, ref, { bold: true }) + T(tx, ty + 11, valShort, { fs: 9 });
      keepOut.push([tx - 2, ty - 14, tx + tW, ty + 14]);
      grow(tx + tW, ty + 14);
    } else {
      const ty = Math.min(-12, ...sym.pins.filter((q) => q.dir === 'u').map((q) => q.y - STUB - 4)) - 4;
      s += T(sym.w / 2, ty - 12, ref, { anchor: 'middle', bold: true }) + T(sym.w / 2, ty, valShort, { fs: 9, anchor: 'middle' });
      keepOut.push([sym.w / 2 - tW / 2, ty - 24, sym.w / 2 + tW / 2, ty + 3]);
      grow(sym.w / 2 - tW / 2, ty - 24); grow(sym.w / 2 + tW / 2, ty);
    }
    return { svg: s, x0, y0, x1, y1, terms, keepOut };
  }

  // Order of the parts list and of the label-mode rows: boards, chips, transistors, sources, the rest.
  const RANK = { Boards: 0, ICs: 1, Semiconductors: 2, 'Controlled sources': 3, Power: 4, Instruments: 5 };
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  const snap = (v) => Math.round(v / 10) * 10;

  // ------------------------------------------------------------------ placement (wire mode)
  // Parts are placed one by one, each next to the parts it shares nets with: the most connected
  // part first (usually the board), then always the part with most connections to what is placed.
  // Candidate positions are tried around the pins it connects to; the closest one that keeps a
  // routing channel (MARGIN) to every placed part wins.
  // How good is it to join a pin at (x, y) pointing `dir` to the placed pin q? Distance, plus a
  // penalty for being off to the side (a straight wire reads best) and for either pin pointing away.
  function linkCost(dir, x, y, q) {
    const dx = q.x - x, dy = q.y - y;
    let c = Math.abs(dx) + Math.abs(dy);
    const horiz = dir === 'l' || dir === 'r';
    c += 0.8 * (horiz ? Math.abs(dy) : Math.abs(dx));
    const [ux, uy] = DIRV[dir];
    if (ux * dx + uy * dy < 0) c += 80;                 // our pin points away from the other one
    const [vx, vy] = DIRV[q.dir] || [0, 0];
    if (vx * -dx + vy * -dy < 0) c += 80;               // their pin points away from us
    return c;
  }
  function placeParts(drawn, MARGIN) {
    const netsOf = (it) => new Set(it.d.terms.map((t) => t.net));
    const placed = [];
    const placedTerms = new Map(); // net -> [{x, y}]
    const boxOf = (it, ox, oy) => [ox + it.d.x0, oy + it.d.y0, ox + it.d.x1, oy + it.d.y1];
    const free = (b) => placed.every((q) => b[2] + MARGIN <= q.box[0] || q.box[2] + MARGIN <= b[0] || b[3] + MARGIN <= q.box[1] || q.box[3] + MARGIN <= b[1]);
    const put = (it, ox, oy) => {
      it.ox = ox; it.oy = oy; it.box = boxOf(it, ox, oy);
      placed.push(it);
      for (const t of it.d.terms) { if (!placedTerms.has(t.net)) placedTerms.set(t.net, []); placedTerms.get(t.net).push({ x: ox + t.x, y: oy + t.y, dir: t.dir }); }
    };
    const rest = drawn.slice();
    rest.sort((a, b) => netsOf(b).size - netsOf(a).size || ((RANK[PARTS[a.p.type].category] ?? 9) - (RANK[PARTS[b.p.type].category] ?? 9)));
    if (!rest.length) return placed;
    put(rest.shift(), 0, 0);
    while (rest.length) {
      // the unplaced part with most nets already on the sheet
      let bi = 0, bs = -1;
      rest.forEach((it, i) => { let n = 0; for (const net of netsOf(it)) if (placedTerms.has(net)) n++; if (n > bs) { bs = n; bi = i; } });
      const it = rest.splice(bi, 1)[0];
      const shared = it.d.terms.filter((t) => placedTerms.has(t.net));
      const cost = (ox, oy) => {
        let c = 0;
        for (const t of shared) {
          const x = ox + t.x, y = oy + t.y;
          c += Math.min(...placedTerms.get(t.net).map((q) => linkCost(t.dir, x, y, q)));
        }
        return c + 0.05 * (Math.abs(ox) + Math.abs(oy));
      };
      let best = null;
      if (shared.length) {
        // try positions around each placed pin this part connects to
        const seeds = [];
        for (const t of shared) for (const q of placedTerms.get(t.net)) {
          const [dx, dy] = DIRV[t.dir];
          seeds.push([q.x - t.x - dx * 40, q.y - t.y - dy * 40]); // our pin facing theirs
        }
        for (const [sx, sy] of seeds.slice(0, 12)) {
          for (let r = 0; r <= 420; r += 20) {
            for (let k = -r; k <= r; k += 20) {
              for (const [ox, oy] of [[sx + k, sy - r], [sx + k, sy + r], [sx - r, sy + k], [sx + r, sy + k]]) {
                const X = snap(ox), Y = snap(oy);
                if (!free(boxOf(it, X, Y))) continue;
                const c = cost(X, Y);
                if (!best || c < best.c) best = { X, Y, c };
              }
            }
            if (best && r > 80 && best.c < r) break; // nothing closer can turn up further out
          }
        }
      }
      if (!best) {
        // not connected to anything placed yet: next to the right edge, top-aligned
        const right = Math.max(...placed.map((q) => q.box[2])), top = Math.min(...placed.map((q) => q.box[1]));
        let X = snap(right + MARGIN + 20 - it.d.x0), Y = snap(top - it.d.y0);
        while (!free(boxOf(it, X, Y))) Y += 20;
        best = { X, Y };
      }
      put(it, best.X, best.Y);
    }
    return placed;
  }

  // ------------------------------------------------------------------ wire routing
  // A* on a 10 px grid over the placed sheet. Wires never enter a symbol, a pin stub, a text or
  // another net's pin; they never run along another net's wire and may cross it only straight
  // over (no bend on a crossing). Each net grows as a tree: every further pin is joined to the
  // nearest point of the wires already drawn, so branches end in T-junctions (drawn with a dot).
  const BEND = 4, CROSS = 6;
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top;
    }
  }
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // r d l u
  const DIRI = { r: 0, d: 1, l: 2, u: 3 };
  function routeAll(placed, A) {
    // grid over everything, with room around it
    const bx0 = Math.min(...placed.map((q) => q.box[0])) - 80, by0 = Math.min(...placed.map((q) => q.box[1])) - 80;
    const bx1 = Math.max(...placed.map((q) => q.box[2])) + 80, by1 = Math.max(...placed.map((q) => q.box[3])) + 80;
    const ox = snap(bx0) - 10, oy = snap(by0) - 10;
    const W = Math.ceil((bx1 - ox) / 10) + 2, H = Math.ceil((by1 - oy) / 10) + 2, N = W * H;
    const cell = (x, y) => Math.round((y - oy) / 10) * W + Math.round((x - ox) / 10);
    const blocked = new Uint8Array(N), term = new Int32Array(N).fill(-1);
    const occH = new Int32Array(N).fill(-1), occV = new Int32Array(N).fill(-1), node = new Int32Array(N).fill(-1);
    for (const it of placed) for (const r of it.d.keepOut) {
      // block the grid points that lie inside the drawn area (wires run through grid points)
      const x0 = Math.ceil((it.ox + r[0] - ox) / 10 - 1e-6), x1 = Math.floor((it.ox + r[2] - ox) / 10 + 1e-6);
      const y0 = Math.ceil((it.oy + r[1] - oy) / 10 - 1e-6), y1 = Math.floor((it.oy + r[3] - oy) / 10 + 1e-6);
      for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) blocked[y * W + x] = 1;
    }
    const nets = new Map();
    for (const it of placed) for (const t of it.d.terms) {
      const c = cell(it.ox + t.x, it.oy + t.y);
      blocked[c] = 0; term[c] = t.net; node[c] = t.net;
      if (!nets.has(t.net)) nets.set(t.net, []);
      nets.get(t.net).push({ c, dir: DIRI[t.dir], x: it.ox + t.x, y: it.oy + t.y, d: t.dir });
    }
    // route short nets first: they have the fewest good options
    const spread = (ts) => Math.max(...ts.map((t) => t.x)) - Math.min(...ts.map((t) => t.x)) + Math.max(...ts.map((t) => t.y)) - Math.min(...ts.map((t) => t.y));
    const order = [...nets.entries()].filter(([, ts]) => ts.length >= 2).sort((a, b) => spread(a[1]) - spread(b[1]));
    const result = { wires: new Map(), failed: new Set(), ox, oy, W, H };
    const other = (v, net) => v !== -1 && v !== net;
    const inTree = new Uint8Array(N);
    for (const [net, ts] of order) {
      inTree.fill(0);
      const edges = [];
      inTree[ts[0].c] = 1;
      const left = ts.slice(1);
      let ok = true;
      while (left.length) {
        // the pin closest to the tree so far
        left.sort((a, b) => Math.min(...ts.filter((t) => inTree[t.c]).map((t) => Math.abs(t.x - a.x) + Math.abs(t.y - a.y))) - Math.min(...ts.filter((t) => inTree[t.c]).map((t) => Math.abs(t.x - b.x) + Math.abs(t.y - b.y))));
        const start = left.shift();
        if (inTree[start.c]) continue;
        const path = search(start);
        if (!path) { ok = false; continue; }
        // commit the path: occupancy, nodes at bends and at both ends, tree cells
        for (let i = 0; i < path.length; i++) {
          const c = path[i];
          inTree[c] = 1;
          if (i > 0) {
            const p = path[i - 1], horiz = Math.abs(c - p) === 1;
            (horiz ? occH : occV)[c] = net; (horiz ? occH : occV)[p] = net;
            edges.push([p, c]);
          }
          const bend = i > 0 && i < path.length - 1 && (Math.abs(path[i + 1] - c) === 1) !== (Math.abs(c - path[i - 1]) === 1);
          if (bend || i === 0 || i === path.length - 1) node[c] = net;
        }
      }
      result.wires.set(net, edges);
      if (!ok) result.failed.add(net);

      function search(start) {
        const dist = new Float32Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1);
        const heap = new Heap();
        const s0 = start.c * 4 + start.dir;
        dist[s0] = 0; heap.push({ s: s0, f: 0 });
        let goal = -1, n = 0;
        while (heap.size) {
          const { s, f } = heap.pop();
          if (f > dist[s]) continue;
          const c = s >> 2, d = s & 3;
          if (c !== start.c && inTree[c]) { goal = s; break; }
          if (++n > 250000) break;
          const x = c % W, y = (c - x) / W;
          const crossing = c !== start.c && (other(occH[c], net) || other(occV[c], net));
          for (let nd = 0; nd < 4; nd++) {
            if (nd === ((d + 2) & 3)) continue;           // no U-turn
            if (nd !== d && crossing) continue;             // no bend on top of another net's wire
            const nx = x + DIRS[nd][0], ny = y + DIRS[nd][1];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nc = ny * W + nx;
            let cost = 1 + (nd !== d ? BEND : 0);
            if (!inTree[nc]) {
              if (blocked[nc]) continue;
              if (term[nc] !== -1) continue;               // another pin (of any net) is not a pass-through
              if (other(node[nc], net)) continue;          // another net's bend / junction / pin
              const horiz = nd === 0 || nd === 2;
              if (horiz ? other(occH[nc], net) : other(occV[nc], net)) continue; // would run along another wire
              if (other(occH[nc], net) || other(occV[nc], net)) cost += CROSS;
            } else if (other(occH[nc], net) || other(occV[nc], net)) continue;
            const ns = nc * 4 + nd, g = f + cost;
            if (g < dist[ns]) { dist[ns] = g; prev[ns] = s; heap.push({ s: ns, f: g }); }
          }
        }
        if (goal < 0) return null;
        const cells = [];
        for (let s = goal; s >= 0; s = prev[s]) cells.push(s >> 2);
        return cells.reverse();
      }
    }
    return result;
  }

  // Wire SVG for one net: merge the grid edges into straight runs, dots on junctions.
  function wireSvg(edges, R, termCells) {
    const deg = new Map(), add = (c) => deg.set(c, (deg.get(c) || 0) + 1);
    const seen = new Set();
    const uniq = edges.filter(([a, b]) => { const k = a < b ? a + ',' + b : b + ',' + a; if (seen.has(k)) return false; seen.add(k); return true; });
    for (const [a, b] of uniq) { add(a); add(b); }
    for (const c of termCells) if (deg.has(c)) add(c); // the pin's stub counts as a branch
    const xy = (c) => [R.ox + (c % R.W) * 10, R.oy + Math.floor(c / R.W) * 10];
    // join edges into maximal straight runs
    const horiz = uniq.filter(([a, b]) => Math.abs(a - b) === 1), vert = uniq.filter(([a, b]) => Math.abs(a - b) !== 1);
    const runs = (list, step) => {
      const set = new Set(list.map(([a, b]) => Math.min(a, b)));
      const out = [];
      for (const s of set) {
        if (set.has(s - step)) continue;
        let e = s; while (set.has(e)) e += step;
        out.push([s, e]);
      }
      return out;
    };
    let d = '';
    for (const [a, b] of runs(horiz, 1).concat(runs(vert, R.W))) { const [x1, y1] = xy(a), [x2, y2] = xy(b); d += `M${x1},${y1} L${x2},${y2} `; }
    let s = d ? `<path d="${d}" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="square"/>` : '';
    for (const [c, n] of deg) if (n >= 3) { const [x, y] = xy(c); s += `<circle cx="${x}" cy="${y}" r="3.2" fill="#000"/>`; }
    return s;
  }

  // ------------------------------------------------------------------ sheet
  // Build the sheet; opts.mode = 'wires' (default) or 'labels'. Returns { svg, width, height, … }.
  function build(app, opts) {
    const mode = (opts && opts.mode) || 'wires';
    const A = analyse(app);
    const parts = app.project.parts.filter((p) => PARTS[p.type] && !PARTS[p.type].holes && !PARTS[p.type].annotation && PARTS[p.type].pins(p.props || {}).length);
    parts.sort((a, b) => ((RANK[PARTS[a.type].category] ?? 9) - (RANK[PARTS[b.type].category] ?? 9)) || natural(a.name, b.name));
    const drawn = parts.map((p) => ({ p, d: drawPart(p, PARTS[p.type], A, mode === 'wires') }));
    const LIST_W = 250, M = 24;
    let content = '', cw = 1, ch = 1, failed = 0, check = null;

    if (mode === 'wires' && drawn.length) {
      // try a tight layout first; if some nets can't be wired, spread the parts out further
      let placed, R;
      for (const margin of [40, 60, 80]) {
        const pl = placeParts(drawn.map((it) => ({ p: it.p, d: it.d })), margin);
        const r = routeAll(pl, A);
        if (!R || r.failed.size < R.failed.size) { placed = pl; R = r; }
        if (!R.failed.size) break;
      }
      let wiresSvg = '', labels = '';
      for (const [net, edges] of R.wires) {
        const termCells = [];
        for (const it of placed) for (const t of it.d.terms) if (t.net === net) termCells.push(Math.round((it.oy + t.y - R.oy) / 10) * R.W + Math.round((it.ox + t.x - R.ox) / 10));
        wiresSvg += wireSvg(edges, R, termCells);
      }
      // nets the router could not finish: their pins also get net labels
      for (const it of placed) for (const t of it.d.terms) {
        if (!R.failed.has(t.net)) continue;
        const x = it.ox + t.x, y = it.oy + t.y;
        labels += `<circle cx="${x}" cy="${y}" r="2" fill="#000"/>` + netLabel(x, y, t.dir, A.names.get(t.net));
      }
      failed = R.failed.size;
      // self-check: every routed net's wires join all its pins; no grid edge is shared by two nets
      const edgeOwner = new Map();
      let disconnected = 0, shared = 0;
      for (const [net, edges] of R.wires) {
        const adj = new Map(), link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
        for (const [a, b] of edges) {
          link(a, b); link(b, a);
          const k = a < b ? a + ',' + b : b + ',' + a;
          if (edgeOwner.has(k) && edgeOwner.get(k) !== net) shared++; else edgeOwner.set(k, net);
        }
        if (R.failed.has(net)) continue;
        const cells = [];
        for (const it of placed) for (const t of it.d.terms) if (t.net === net) cells.push(Math.round((it.oy + t.y - R.oy) / 10) * R.W + Math.round((it.ox + t.x - R.ox) / 10));
        const seen = new Set([cells[0]]), stack = [cells[0]];
        while (stack.length) for (const n of adj.get(stack.pop()) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
        if (!cells.every((c) => seen.has(c))) disconnected++;
      }
      check = { disconnected, shared };
      const x0 = Math.min(...placed.map((q) => q.box[0])) - 30, y0 = Math.min(...placed.map((q) => q.box[1])) - 30;
      const x1 = Math.max(...placed.map((q) => q.box[2])) + 30, y1 = Math.max(...placed.map((q) => q.box[3])) + 30;
      // wires may run around the outside of the parts
      let wx0 = x0, wy0 = y0, wx1 = x1, wy1 = y1;
      for (const edges of R.wires.values()) for (const [a] of edges) { const x = R.ox + (a % R.W) * 10, y = R.oy + Math.floor(a / R.W) * 10; wx0 = Math.min(wx0, x - 10); wy0 = Math.min(wy0, y - 10); wx1 = Math.max(wx1, x + 10); wy1 = Math.max(wy1, y + 10); }
      content = `<g transform="translate(${-wx0},${-wy0})">${wiresSvg}${placed.map((it) => `<g transform="translate(${it.ox},${it.oy})">${it.d.svg}</g>`).join('')}${labels}</g>`;
      cw = wx1 - wx0; ch = wy1 - wy0;
    } else {
      // label mode: rows of parts, re-flowed for the zoom that fills the sheet best
      const GAP = 34;
      const place = (areaW) => {
        let x = 0, y = 0, rowH = 0, used = 1;
        const pos = [];
        for (const it of drawn) {
          const w = it.d.x1 - it.d.x0, h = it.d.y1 - it.d.y0;
          if (x > 0 && x + w > areaW) { x = 0; y += rowH + GAP; rowH = 0; }
          pos.push({ it, x: x - it.d.x0, y: y - it.d.y0 });
          used = Math.max(used, x + w);
          x += w + GAP; rowH = Math.max(rowH, h);
        }
        return { pos, w: used, h: y + rowH };
      };
      const aw = 1123 - 2 * M - LIST_W - 20, ah = 794 - 2 * M - 110;
      let L = place(aw);
      for (let z = 1.5; z >= 0.75; z -= 0.05) { const Lz = place(aw / z); if (Lz.h * z <= ah && Lz.w * z <= aw) { L = Lz; break; } }
      content = L.pos.map(({ it, x, y }) => `<g transform="translate(${x},${y})">${it.d.svg}</g>`).join('');
      cw = L.w; ch = L.h;
    }

    // sheet: A4 landscape (297 × 210 mm at 96 dpi); A3 when the drawing would get too small
    let W = 1123, H = 794;
    const fitScale = (W, H) => Math.min(1.5, (W - 2 * M - LIST_W - 20) / Math.max(1, cw), (H - 2 * M - 110) / Math.max(1, ch));
    let scale = fitScale(W, H);
    if (scale < 0.72) { W = 1587; H = 1123; scale = fitScale(W, H); }

    let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
      <rect x="${M - 10}" y="${M - 10}" width="${W - 2 * M + 20}" height="${H - 2 * M + 20}" fill="none" stroke="#000" stroke-width="1.4"/>`;
    s += `<g transform="translate(${M + 6},${M + 30}) scale(${scale.toFixed(4)})" font-family="Arial, Helvetica, sans-serif">${content}</g>`;
    const legend = mode === 'wires'
      ? `Dots mark joined wires; crossing wires without a dot are not connected · ⏚ = ground · × = not connected${failed ? ` · ${failed} net${failed > 1 ? 's' : ''} shown with labels where a wire did not fit` : ''}`
      : 'Pins with the same label are connected · ⏚ = ground · × = not connected';
    s += `<text x="${M + 6}" y="${M + 12}" font-size="15" font-weight="700" font-family="Arial, Helvetica, sans-serif">Schematic</text>
      <text x="${M + 96}" y="${M + 12}" font-size="10" fill="#444" font-family="Arial, Helvetica, sans-serif">${esc(legend)}</text>`;
    // parts list
    const lx = W - M - LIST_W, ly = M + 6;
    s += `<g font-family="Arial, Helvetica, sans-serif"><line x1="${lx - 10}" y1="${M - 10}" x2="${lx - 10}" y2="${H - M - 70}" stroke="#000" stroke-width="1"/>
      <text x="${lx}" y="${ly + 6}" font-size="13" font-weight="700">Parts list</text>`;
    const rowsMax = Math.floor((H - M - 80 - (ly + 26)) / 14);
    const list = parts.slice().sort((a, b) => natural(a.name, b.name));
    list.slice(0, rowsMax).forEach((p, i) => {
      const def = PARTS[p.type], val = def.board ? def.label : def.summary ? `${def.label} · ${def.summary(p)}` : def.label;
      const v = val.length > 40 ? val.slice(0, 39) + '…' : val;
      s += `<text x="${lx}" y="${ly + 26 + i * 14}" font-size="9.5" font-weight="700">${esc(p.name)}</text><text x="${lx + 46}" y="${ly + 26 + i * 14}" font-size="9.5">${esc(v)}</text>`;
    });
    if (list.length > rowsMax) s += `<text x="${lx}" y="${ly + 26 + rowsMax * 14}" font-size="9.5" fill="#444">… and ${list.length - rowsMax} more</text>`;
    s += '</g>';
    // title block
    const tb = { x: W - M - 360, y: H - M - 60, w: 360, h: 60 };
    const date = new Date().toISOString().slice(0, 10);
    const boardTxt = A.board ? PARTS[A.board.type].label : 'no microcontroller';
    s += `<g font-family="Arial, Helvetica, sans-serif"><rect x="${tb.x - 10}" y="${tb.y - 10}" width="${tb.w + 20}" height="${tb.h + 20}" fill="#fff" stroke="#000" stroke-width="1.2"/>
      <line x1="${tb.x - 10}" y1="${tb.y + 22}" x2="${tb.x + tb.w + 10}" y2="${tb.y + 22}" stroke="#000"/>
      <line x1="${tb.x + 200}" y1="${tb.y + 22}" x2="${tb.x + 200}" y2="${tb.y + tb.h + 10}" stroke="#000"/>
      <text x="${tb.x}" y="${tb.y + 12}" font-size="15" font-weight="700">${esc(app.projectTitle ? app.projectTitle() : 'JumperCraft project')}</text>
      <text x="${tb.x + tb.w}" y="${tb.y + 12}" font-size="10" text-anchor="end">${esc(boardTxt)}</text>
      <text x="${tb.x}" y="${tb.y + 40}" font-size="10">${parts.length} parts · ${A.names.size} nets</text>
      <text x="${tb.x}" y="${tb.y + 56}" font-size="9" fill="#444">Generated by JumperCraft ${esc(WB.VERSION || '')}</text>
      <text x="${tb.x + 210}" y="${tb.y + 40}" font-size="10">Date: ${date}</text>
      <text x="${tb.x + 210}" y="${tb.y + 56}" font-size="10">Sheet 1 / 1 · ${W > 1200 ? 'A3' : 'A4'}</text></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${s}</svg>`;
    return { svg, width: W, height: H, parts: parts.length, nets: A.names.size, scale, mode, failedNets: failed, check };
  }

  WB.Schematic = { build, SYMBOLS, analyse };
})(window.WB);

'use strict';
(function (WB) {
  const PARTS = (WB.PARTS = {});
  // 'General' is not a real category: it shows the parts used most often (WB.GENERAL), which also
  // stay in their own categories.
  WB.GENERAL = ['board-uno-r3', 'breadboard-half', 'resistor', 'led', 'rgbled', 'button', 'switch', 'pot', 'ldr', 'buzzer', 'servo', 'capacitor', 'ecap', 'diode', 'npn', 'battery', 'multimeter'];
  const CATEGORIES = (WB.CATEGORIES = ['General', 'Boards', 'Breadboards', 'Instruments', 'Modulino', 'Output', 'Displays', 'Input', 'Sensors', 'Passive', 'Semiconductors', 'ICs', 'Controlled sources', 'Power', 'Notes']);

  WB.defPart = function (type, d) {
    d.type = type;
    d.groups = d.groups || (() => []);
    d.defaults = d.defaults || {};
    PARTS[type] = d;
    return d;
  };

  WB.worldPins = function (part) {
    const def = PARTS[part.type];
    if (!def) return [];
    return def.pins(part.props || {}).map((p) => {
      const [rx, ry] = WB.rotPt(p.x, p.y, part.rot);
      return Object.assign({}, p, { x: part.x + rx, y: part.y + ry });
    });
  };
  WB.worldPin = function (part, pinId) {
    const def = PARTS[part.type];
    if (!def) return null;
    const p = def.pins(part.props || {}).find((q) => q.id === pinId);
    if (!p) return null;
    const [rx, ry] = WB.rotPt(p.x, p.y, part.rot);
    return Object.assign({}, p, { x: part.x + rx, y: part.y + ry });
  };
  WB.worldBBox = function (part) {
    const def = PARTS[part.type];
    const [x, y, w, h] = def.bbox(part.props || {});
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => WB.rotPt(a, b, part.rot));
    const xs = pts.map((p) => p[0] + part.x), ys = pts.map((p) => p[1] + part.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
  };

  const LEG = 'stroke="#aeb3ba" stroke-width="1.8" stroke-linecap="round" fill="none"';
  WB.LEG = LEG;
  // Leg of a component that sits upright (LED, capacitor): tinned wire.
  const MLEG = 'stroke="#b4b9bf" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  WB.MLEG = MLEG;

  // ---------------------------------------------------------------- Resistor
  const BAND = ['#111111', '#7b4a12', '#d32020', '#f07c00', '#f5d000', '#1f9e3a', '#1f55d6', '#8a3fd1', '#8a8a8a', '#f5f5f5'];
  function resBands(r) {
    r = Math.max(0.1, Number(r) || 0);
    let exp = Math.floor(Math.log10(r)) - 1;
    let sig = Math.round(r / Math.pow(10, exp));
    if (sig >= 100) { sig = Math.round(sig / 10); exp++; }
    const mult = exp >= 0 ? BAND[Math.min(exp, 9)] : exp === -1 ? '#c9a227' : '#c0c0c0';
    return [BAND[Math.floor(sig / 10) % 10], BAND[sig % 10], mult];
  }
  const RES_VALUES = [10, 47, 100, 150, 220, 330, 470, 680, 1000, 2200, 4700, 10000, 22000, 47000, 100000, 1000000];

  WB.defPart('resistor', {
    label: 'Resistor', category: 'Passive', prefix: 'R',
    defaults: { ohms: 220 },
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: '2', label: 'Pin 2', x: 40, y: 0 }],
    bbox: () => [-4, -7, 48, 14],
    elements: (c) => [{ t: 'R', a: c.n('1'), b: c.n('2'), r: Math.max(0.01, Number(c.props.ohms) || 0.01) }],
    summary: (p) => WB.fmtOhms(p.props.ohms),
    inspector: [{ key: 'ohms', label: 'Resistance (Ω)', type: 'number', min: 0.1, step: 'any', suggestions: RES_VALUES }],
    render(p) {
      const b = resBands(p.props.ohms);
      return `<line x1="0" y1="0" x2="40" y2="0" ${LEG}/>
        <rect x="7" y="-5" width="26" height="10" rx="4.5" fill="#dcc495" stroke="#8d774c" stroke-width=".8"/>
        <rect x="11" y="-5" width="2.6" height="10" fill="${b[0]}"/>
        <rect x="15.5" y="-5" width="2.6" height="10" fill="${b[1]}"/>
        <rect x="20" y="-5" width="2.6" height="10" fill="${b[2]}"/>
        <rect x="27" y="-5" width="2.6" height="10" fill="#c9a227"/>
        <rect x="7" y="-5" width="26" height="10" rx="4.5" fill="url(#wbShadeV)"/>`;
    },
  });

  // ---------------------------------------------------------------- LED
  const LEDC = {
    red: { on: '#ff3030', off: '#8f2a2a', vf: 1.8 },
    green: { on: '#3dff6a', off: '#2a7a3c', vf: 2.1 },
    blue: { on: '#3f8cff', off: '#2a4a8f', vf: 3.0 },
    yellow: { on: '#ffe640', off: '#8f8226', vf: 2.0 },
    orange: { on: '#ff9a2a', off: '#8f5a22', vf: 1.9 },
    white: { on: '#ffffff', off: '#9a9aa6', vf: 3.0 },
  };
  WB.LEDC = LEDC;
  const ledBrightness = (i) => WB.clamp(Math.sqrt(Math.max(0, i) / 0.01), 0, 1);

  WB.defPart('led', {
    label: 'LED', category: 'Output', prefix: 'LED', dynamic: true,
    defaults: { color: 'red' },
    pins: () => [{ id: 'A', label: 'Anode (+)', x: 0, y: 0 }, { id: 'K', label: 'Cathode (−)', x: 10, y: 0 }],
    bbox: () => [-5, -27, 20, 30],
    summary: (p) => p.props.color,
    inspector: [{ key: 'color', label: 'Color', type: 'select', options: Object.keys(LEDC) }],
    elements(c) {
      if (c.state.burnt) return [];
      const col = LEDC[c.props.color] || LEDC.red;
      return [{ t: 'D', a: c.n('A'), b: c.n('K'), vf: col.vf, rs: 15 }];
    },
    visualize(c) {
      if (c.state.burnt) return { burnt: true };
      const e = c.els[0];
      if (!e) return {};
      if (e.i > 0.03) {
        c.state.burnt = true;
        c.warn(`${c.name} burned out (${Math.round(e.i * 1000)} mA). Put a 220 Ω–1 kΩ resistor in series with the LED.`);
        return { burnt: true };
      }
      return { b: +ledBrightness(e.i).toFixed(2), i: e.i };
    },
    render(p, v) {
      v = v || {};
      const col = LEDC[p.props.color] || LEDC.red;
      const b = v.burnt ? 0 : v.b || 0;
      // 5 mm LED: translucent epoxy dome with a flange, the die cup (cathode "anvil") and the
      // anode post visible inside, bent anode leg (the longer one), shading for a round body.
      const fill = v.burnt ? '#3a3330' : WB.mix(WB.mix(col.off, col.on, 0.45), col.on, b);
      const dome = 'M-1.5,-9.5 V-17.5 A6.5,6.5 0 0 1 11.5,-17.5 V-9.5 Z';
      return `<path d="M0,0 V-5 L1.6,-7 V-9" ${MLEG}/><path d="M10,0 V-9" ${MLEG}/>
        ${b > 0.02 ? `<circle cx="5" cy="-17" r="${(8 + 10 * b).toFixed(1)}" fill="${col.on}" opacity="${(0.15 + 0.55 * b).toFixed(2)}" filter="url(#wbGlow)"/>` : ''}
        <path d="${dome}" fill="${fill}" fill-opacity="${v.burnt ? 1 : 0.78}"/>
        ${v.burnt ? '' : `<path d="M2.3,-9.5 V-14.5 L4,-15.5" stroke="#7d838b" stroke-width="1.1" fill="none" opacity=".75"/>
        <path d="M9,-9.5 V-13.5 H5.3 L6.2,-16.2 H9.8 Z" fill="#7d838b" opacity=".75"/>
        <path d="M4,-15.5 Q5,-17.5 6,-16.2" stroke="#ccc" stroke-width=".35" fill="none"/>
        ${b > 0.02 ? `<circle cx="5.6" cy="-16" r="${(1.2 + 1.8 * b).toFixed(1)}" fill="#fff" opacity="${(0.4 + 0.6 * b).toFixed(2)}"/>` : ''}`}
        <path d="${dome}" fill="url(#wbShadeH)" stroke="${WB.mix(fill, '#000000', 0.45)}" stroke-width=".5"/>
        <rect x="-3" y="-10.6" width="16" height="2.6" rx=".8" fill="${fill}" fill-opacity="${v.burnt ? 1 : 0.9}"/>
        <rect x="-3" y="-10.6" width="16" height="2.6" rx=".8" fill="url(#wbShadeH)" stroke="${WB.mix(fill, '#000000', 0.45)}" stroke-width=".5"/>
        <path d="M11.5,-10.6 V-8" stroke="${WB.mix(fill, '#000000', 0.5)}" stroke-width=".7"/>
        <path d="M0.6,-14 Q0.6,-21.6 5,-22.9" stroke="#fff" stroke-opacity=".75" stroke-width="1.1" fill="none" stroke-linecap="round"/>
        ${v.burnt ? `<path d="M3,-26 q-3,-3 0,-6 q3,-3 0,-6" stroke="#9a9a9a" stroke-width="1.2" fill="none" opacity=".8"/><text x="5" y="-12.5" font-size="6" text-anchor="middle" fill="#ffb347" font-family="sans-serif">✕</text>` : ''}`;
    },
  });

  // ---------------------------------------------------------------- RGB LED
  WB.defPart('rgbled', {
    label: 'RGB LED', category: 'Output', prefix: 'RGB', dynamic: true,
    defaults: { common: 'cathode' },
    pins: (pr) => [
      { id: 'R', label: 'Red', x: 0, y: 0 },
      { id: 'COM', label: pr.common === 'anode' ? 'Common anode (+)' : 'Common cathode (−)', x: 10, y: 0 },
      { id: 'G', label: 'Green', x: 20, y: 0 },
      { id: 'B', label: 'Blue', x: 30, y: 0 },
    ],
    bbox: () => [-4, -34, 38, 37],
    summary: (p) => 'common ' + p.props.common,
    inspector: [{ key: 'common', label: 'Type', type: 'select', options: ['cathode', 'anode'] }],
    elements(c) {
      if (c.state.burnt) return [];
      const an = c.props.common === 'anode';
      const ch = [['R', 1.9], ['G', 2.9], ['B', 2.9]];
      return ch.map(([id, vf]) => ({ t: 'D', a: an ? c.n('COM') : c.n(id), b: an ? c.n(id) : c.n('COM'), vf, rs: 20, tag: id }));
    },
    visualize(c) {
      if (c.state.burnt) return { burnt: true };
      const out = {};
      for (const e of c.els) {
        if (e.i > 0.035) { c.state.burnt = true; c.warn(`${c.name} burned out (${Math.round(e.i * 1000)} mA on ${e.tag}). Use a resistor on each color pin.`); return { burnt: true }; }
        out[e.tag] = +ledBrightness(e.i).toFixed(2);
      }
      return out;
    },
    render(p, v) {
      v = v || {};
      const r = v.R || 0, g = v.G || 0, b = v.B || 0;
      const lit = Math.max(r, g, b);
      const col = lit > 0.02 ? `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})` : '#d9dbe3';
      const body = lit > 0.02 ? WB.mix('#d9dbe3', '#ffffff', 0) : '#d9dbe3';
      return `<path d="M0,0 V-10" ${MLEG}/><path d="M10,0 V-6 L11.5,-10" ${MLEG}/><path d="M20,0 V-10" ${MLEG}/><path d="M30,0 V-10" ${MLEG}/>
        ${lit > 0.02 ? `<circle cx="15" cy="-21" r="${(10 + 10 * lit).toFixed(1)}" fill="${col}" opacity="${(0.2 + 0.5 * lit).toFixed(2)}" filter="url(#wbGlow)"/>` : ''}
        <rect x="4" y="-13" width="22" height="3.5" rx="1" fill="${body}" stroke="#0005" stroke-width=".6"/>
        <path d="M6,-12 V-21 A9,9 0 0 1 24,-21 V-12 Z" fill="${lit > 0.02 ? col : body}" fill-opacity=".9"/>
        <path d="M6,-12 V-21 A9,9 0 0 1 24,-21 V-12 Z" fill="url(#wbShadeH)" stroke="#0006" stroke-width=".6"/>
        <path d="M9,-18 Q9.5,-26 14,-27.5" stroke="#fff" stroke-opacity=".7" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        ${v.burnt ? `<text x="15" y="-15" font-size="7" text-anchor="middle" fill="#c0392b" font-family="sans-serif">✕</text>` : ''}`;
    },
  });

  // ---------------------------------------------------------------- Pushbutton
  const CAPS = { red: '#d32f2f', blue: '#1e63d6', black: '#333', yellow: '#f2c200', green: '#20a040', white: '#eee' };
  WB.defPart('button', {
    label: 'Pushbutton', category: 'Input', prefix: 'SW', dynamic: true, interact: 'press',
    defaults: { cap: 'red' },
    pins: () => [
      { id: '1', label: 'Pin 1 (side A)', x: 0, y: 0 }, { id: '2', label: 'Pin 2 (side A)', x: 20, y: 0 },
      { id: '3', label: 'Pin 3 (side B)', x: 0, y: 30 }, { id: '4', label: 'Pin 4 (side B)', x: 20, y: 30 },
    ],
    groups: () => [['1', '2'], ['3', '4']],
    bbox: () => [-6, -5, 32, 40],
    summary: (p) => p.props.cap + ' cap',
    inspector: [{ key: 'cap', label: 'Cap color', type: 'select', options: Object.keys(CAPS) }],
    elements(c) { return c.ui.pressed ? [{ t: 'R', a: c.n('1'), b: c.n('3'), r: 0.01 }] : []; },
    render(p, v) {
      const pr = v && v.pressed;
      const cap = CAPS[p.props.cap] || CAPS.red;
      // 12 mm tactile switch: four bent legs, black base, steel cover plate with its
      // four corner rivets, and a round cap that sinks in when pressed.
      const capc = pr ? WB.mix(cap, '#000000', 0.3) : cap;
      const leg = (x, y, dy) => `<path d="M${x},${y} v${dy * 3}" stroke="#aab0b7" stroke-width="2.6" stroke-linecap="square"/><path d="M${x - 0.5},${y} v${dy * 3}" stroke="#eef0f2" stroke-width=".8"/>`;
      const rivet = (x, y) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#8d939b"/><circle cx="${x - 0.3}" cy="${y - 0.3}" r=".7" fill="#e3e6e9"/>`;
      return `${leg(0, 0, 1)}${leg(20, 0, 1)}${leg(0, 30, -1)}${leg(20, 30, -1)}
        <rect x="-4" y="2" width="28" height="26" rx="1.8" fill="url(#wbPlastic)" stroke="#0b0b0b" stroke-width=".6"/>
        <rect x="-2.6" y="3.4" width="25.2" height="23.2" rx="1" fill="url(#wbMetalV)" stroke="#5f656c" stroke-width=".5"/>
        <rect x="-2.6" y="3.4" width="25.2" height="23.2" rx="1" fill="url(#wbShadeH)" opacity=".5"/>
        ${rivet(-0.3, 5.7)}${rivet(20.3, 5.7)}${rivet(-0.3, 24.3)}${rivet(20.3, 24.3)}
        <circle cx="10" cy="15" r="9.6" fill="#1c1d20"/>
        <circle cx="10" cy="${pr ? 15.4 : 15}" r="${pr ? 7.6 : 8.2}" fill="${capc}"/>
        <circle cx="10" cy="${pr ? 15.4 : 15}" r="${pr ? 7.6 : 8.2}" fill="url(#wbCap)" stroke="#0007" stroke-width=".5" opacity="${pr ? 0.6 : 1}"/>
        <circle cx="10" cy="${pr ? 15.4 : 15}" r="${pr ? 5.4 : 6}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width=".6"/>`;
    },
  });

  // ---------------------------------------------------------------- Slide switch
  WB.defPart('switch', {
    label: 'Slide switch', category: 'Input', prefix: 'SW', dynamic: true, interact: 'toggle',
    defaults: { on: false },
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: 'C', label: 'Common', x: 10, y: 0 }, { id: '2', label: 'Pin 2', x: 20, y: 0 }],
    bbox: () => [-7, -18, 34, 21],
    summary: () => 'SPDT',
    inspector: [{ key: 'on', label: 'Position', type: 'select', options: [[false, 'Left (C–1)'], [true, 'Right (C–2)']] }],
    elements(c) { return [{ t: 'R', a: c.n('C'), b: c.n(c.props.on ? '2' : '1'), r: 0.01 }]; },
    render(p) {
      const on = !!p.props.on;
      // SPDT slide switch: steel frame, black housing, slot and a ribbed slider.
      const kx = on ? 11 : -1;
      return `<path d="M0,0 V-5" ${MLEG}/><path d="M10,0 V-5" ${MLEG}/><path d="M20,0 V-5" ${MLEG}/>
        <rect x="-6" y="-16" width="32" height="12" rx="1" fill="url(#wbMetalV)" stroke="#5f656c" stroke-width=".5"/>
        <rect x="-4.5" y="-14.5" width="29" height="9" rx=".8" fill="url(#wbPlastic)"/>
        <rect x="-2" y="-12.2" width="24" height="4.4" rx=".8" fill="#0d0e10"/>
        <rect x="${kx}" y="-15" width="10" height="10" rx="1.2" fill="#2a2c30" stroke="#000" stroke-width=".5"/>
        <rect x="${kx}" y="-15" width="10" height="10" rx="1.2" fill="url(#wbShadeV)"/>
        ${[2, 4, 6, 8].map((d) => `<path d="M${kx + d},-13.5 v7" stroke="#55585e" stroke-width=".7"/>`).join('')}`;
    },
  });

  // ---------------------------------------------------------------- Potentiometer
  WB.defPart('pot', {
    label: 'Potentiometer', category: 'Input', prefix: 'POT', dynamic: true,
    interact: 'knob', knob: { key: 'pos', min: 0, max: 1, fmt: (v) => Math.round(v * 100) + '%' },
    defaults: { ohms: 10000, pos: 0.5 },
    pins: () => [{ id: '1', label: 'End 1', x: 0, y: 0 }, { id: 'W', label: 'Wiper', x: 10, y: 0 }, { id: '2', label: 'End 2', x: 20, y: 0 }],
    bbox: () => [-7, -40, 34, 43],
    summary: (p) => WB.fmtOhms(p.props.ohms),
    inspector: [
      { key: 'ohms', label: 'Resistance (Ω)', type: 'number', min: 100, step: 'any', suggestions: [1000, 5000, 10000, 50000, 100000] },
      { key: 'pos', label: 'Knob position', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    ],
    elements(c) {
      const R = Math.max(1, Number(c.props.ohms) || 10000), pos = WB.clamp(Number(c.props.pos), 0, 1);
      return [{ t: 'R', a: c.n('1'), b: c.n('W'), r: Math.max(0.5, R * pos) }, { t: 'R', a: c.n('W'), b: c.n('2'), r: Math.max(0.5, R * (1 - pos)) }];
    },
    render(p) {
      const ang = -135 + 270 * WB.clamp(Number(p.props.pos), 0, 1);
      return `<path d="M0,0 V-6" ${LEG}/><path d="M10,0 V-6" ${LEG}/><path d="M20,0 V-6" ${LEG}/>
        <rect x="-6" y="-38" width="32" height="32" rx="3" fill="#2d5fb5" stroke="#173a75"/>
        <circle cx="10" cy="-22" r="12" fill="#e9e9ea" stroke="#9a9a9a"/>
        <g transform="rotate(${ang.toFixed(1)} 10 -22)"><rect x="8.6" y="-33" width="2.8" height="11" rx="1.2" fill="#444"/></g>`;
    },
  });

  // ---------------------------------------------------------------- Photoresistor
  WB.defPart('ldr', {
    label: 'Photoresistor (LDR)', category: 'Sensors', prefix: 'LDR', dynamic: true,
    interact: 'knob', knob: { key: 'light', min: 0, max: 100, fmt: (v) => 'light ' + Math.round(v) + '%' },
    defaults: { light: 50 },
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: '2', label: 'Pin 2', x: 20, y: 0 }],
    bbox: () => [-2, -25, 24, 28],
    summary: () => '1 kΩ–200 kΩ',
    inspector: [{ key: 'light', label: 'Light level', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + '%' }],
    resistance: (light) => 200000 * Math.pow(1000 / 200000, WB.clamp(light, 0, 100) / 100),
    elements(c) { return [{ t: 'R', a: c.n('1'), b: c.n('2'), r: this.resistance(Number(c.props.light)) }]; },
    render(p) {
      const l = WB.clamp(Number(p.props.light), 0, 100) / 100;
      return `<path d="M0,0 V-8 L5,-10" ${LEG}/><path d="M20,0 V-8 L15,-10" ${LEG}/>
        <circle cx="10" cy="-14" r="9" fill="${WB.mix('#7a4a1a', '#e8a24a', l)}" stroke="#5a3510"/>
        <path d="M4,-17 h9 v2 h-7 v2 h7 v2 h-9" stroke="#c0392b" stroke-width="1.1" fill="none"/>
        <circle cx="10" cy="-14" r="9" fill="#fff" opacity="${(0.1 + 0.25 * l).toFixed(2)}"/>`;
    },
  });

  // ---------------------------------------------------------------- TMP36
  WB.defPart('tmp36', {
    label: 'Temp sensor (TMP36)', category: 'Sensors', prefix: 'U', dynamic: true,
    interact: 'knob', knob: { key: 'temp', min: -40, max: 125, fmt: (v) => Math.round(v) + ' °C' },
    defaults: { temp: 25 },
    pins: () => [{ id: 'VS', label: '+Vs (2.7–5.5 V)', x: 0, y: 0 }, { id: 'VOUT', label: 'Vout (10 mV/°C, 500 mV @ 0 °C)', x: 10, y: 0 }, { id: 'GND', label: 'GND', x: 20, y: 0 }],
    bbox: () => [-5, -24, 30, 27],
    summary: () => 'analog temperature',
    inspector: [{ key: 'temp', label: 'Temperature', type: 'range', min: -40, max: 125, step: 1, fmt: (v) => Math.round(v) + ' °C' }],
    elements(c) {
      const v = 0.5 + Number(c.props.temp) * 0.01;
      return [{ t: 'V', a: c.n('VOUT'), b: c.n('GND'), v, r: 50, cond: { a: c.n('VS'), b: c.n('GND'), min: 2.6 } }, { t: 'R', a: c.n('VS'), b: c.n('GND'), r: 60000 }];
    },
    render(p) {
      return `<path d="M0,0 V-8" ${LEG}/><path d="M10,0 V-8" ${LEG}/><path d="M20,0 V-8" ${LEG}/>
        <path d="M-4,-8 H24 V-14 A14,9 0 0 0 -4,-14 Z" fill="#222" stroke="#000"/>
        <text x="10" y="-11" font-size="5.5" text-anchor="middle" fill="#ddd" font-family="monospace">TMP36</text>
        <text x="10" y="-26" font-size="6" text-anchor="middle" fill="#9fb0c3" font-family="sans-serif">${Math.round(p.props.temp)}°C</text>`;
    },
  });

  // ---------------------------------------------------------------- PIR motion sensor (HC-SR501 style)
  WB.defPart('pir', {
    label: 'PIR motion sensor', category: 'Sensors', prefix: 'PIR', dynamic: true, interact: 'toggle', toggleKey: 'motion',
    defaults: { motion: false },
    pins: () => [{ id: 'VCC', label: 'VCC (5 V)', x: 0, y: 0, kind: 'pwr' }, { id: 'OUT', label: 'OUT (3.3 V when motion)', x: 10, y: 0 }, { id: 'GND', label: 'GND', x: 20, y: 0, kind: 'gnd' }],
    bbox: () => [-16, -54, 52, 57],
    summary: () => 'digital, 3.3 V out',
    inspector: [{ key: 'motion', label: 'Motion', type: 'select', options: [[false, 'No motion'], [true, 'Motion detected']] }],
    elements(c) {
      const cond = { a: c.n('VCC'), b: c.n('GND'), min: 4.0 };
      return [
        { t: 'V', a: c.n('OUT'), b: c.n('GND'), v: c.props.motion ? 3.3 : 0, r: 100, cond },
        { t: 'R', a: c.n('VCC'), b: c.n('GND'), r: 50000 },
      ];
    },
    visualize(c) { return { powered: c.V('VCC') - c.V('GND') >= 4.0 }; },
    render(p, v) {
      const m = !!p.props.motion;
      return `<path d="M0,0 V-8" ${LEG}/><path d="M10,0 V-8" ${LEG}/><path d="M20,0 V-8" ${LEG}/>
        <rect x="-14" y="-52" width="48" height="44" rx="3" fill="#1d6b3a" stroke="#0f3d20"/>
        <circle cx="10" cy="-30" r="17" fill="${m ? '#fff4d6' : '#f2f2ee'}" stroke="#bbb"/>
        <path d="M-2,-36 h24 M-4,-30 h28 M-2,-24 h24 M4,-44 v28 M10,-46 v32 M16,-44 v28" stroke="#d8d8d2" stroke-width="1"/>
        ${m ? '<circle cx="10" cy="-30" r="22" fill="#ffd166" opacity=".25" filter="url(#wbGlow)"/><text x="10" y="-56" font-size="7" text-anchor="middle" fill="#ffd166" font-family="sans-serif">MOTION</text>' : ''}`;
    },
  });

  // ---------------------------------------------------------------- Ultrasonic distance sensor (HC-SR04)
  WB.defPart('hcsr04', {
    label: 'Ultrasonic sensor (HC-SR04)', category: 'Sensors', prefix: 'US', dynamic: true,
    interact: 'knob', knob: { key: 'cm', min: 2, max: 400, fmt: (v) => Math.round(v) + ' cm' },
    defaults: { cm: 50 },
    pins: () => [{ id: 'VCC', label: 'VCC (5 V)', x: 0, y: 0, kind: 'pwr' }, { id: 'TRIG', label: 'Trig (10 µs pulse starts a measurement)', x: 10, y: 0 }, { id: 'ECHO', label: 'Echo (pulse length = distance; use pulseIn)', x: 20, y: 0 }, { id: 'GND', label: 'GND', x: 30, y: 0, kind: 'gnd' }],
    bbox: () => [-32, -56, 94, 59],
    summary: () => '2–400 cm',
    inspector: [{ key: 'cm', label: 'Distance to object', type: 'range', min: 2, max: 400, step: 1, fmt: (v) => Math.round(v) + ' cm' }],
    elements(c) {
      return [
        { t: 'R', a: c.n('VCC'), b: c.n('GND'), r: 2000 },
        { t: 'V', a: c.n('ECHO'), b: c.n('GND'), v: 0, r: 100, cond: { a: c.n('VCC'), b: c.n('GND'), min: 4.0 } },
      ];
    },
    render(p) {
      const can = (cx) => `<circle cx="${cx}" cy="-30" r="15" fill="#d9dde2" stroke="#8a9096"/><circle cx="${cx}" cy="-30" r="10" fill="#2b2f33"/><circle cx="${cx}" cy="-30" r="10" fill="none" stroke="#555" stroke-dasharray="1.5 1.5"/>`;
      return `<path d="M0,0 V-8" ${LEG}/><path d="M10,0 V-8" ${LEG}/><path d="M20,0 V-8" ${LEG}/><path d="M30,0 V-8" ${LEG}/>
        <rect x="-30" y="-54" width="90" height="46" rx="3" fill="#1e5aa8" stroke="#123a70"/>
        ${can(-8)}${can(38)}
        <rect x="9" y="-50" width="12" height="7" rx="1" fill="#c0c0c0"/>
        <text x="15" y="-12" font-size="6" text-anchor="middle" fill="#cfe0ff" font-family="monospace">HC-SR04</text>
        <text x="15" y="-62" font-size="7" text-anchor="middle" fill="#9fb0c3" font-family="sans-serif">${Math.round(p.props.cm)} cm</text>`;
    },
  });

  // ---------------------------------------------------------------- Soil moisture sensor (analog)
  WB.defPart('soil', {
    label: 'Soil moisture sensor', category: 'Sensors', prefix: 'SM', dynamic: true,
    interact: 'knob', knob: { key: 'moisture', min: 0, max: 100, fmt: (v) => 'moisture ' + Math.round(v) + '%' },
    defaults: { moisture: 40 },
    pins: () => [{ id: 'VCC', label: 'VCC (3.3–5 V)', x: 0, y: 0, kind: 'pwr' }, { id: 'GND', label: 'GND', x: 10, y: 0, kind: 'gnd' }, { id: 'AO', label: 'AO (analog: lower = wetter)', x: 20, y: 0 }],
    bbox: () => [-12, -92, 44, 95],
    summary: () => 'analog out',
    inspector: [{ key: 'moisture', label: 'Soil moisture', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + '%' }],
    elements(c) {
      const f = 1 - 0.8 * WB.clamp(Number(c.props.moisture), 0, 100) / 100; // AO / VCC
      return [{ t: 'R', a: c.n('VCC'), b: c.n('AO'), r: Math.max(1, 10000 * (1 - f)) }, { t: 'R', a: c.n('AO'), b: c.n('GND'), r: Math.max(1, 10000 * f) }];
    },
    render(p) {
      const m = WB.clamp(Number(p.props.moisture), 0, 100) / 100;
      return `<path d="M0,0 V-8" ${LEG}/><path d="M10,0 V-8" ${LEG}/><path d="M20,0 V-8" ${LEG}/>
        <rect x="-10" y="-30" width="40" height="22" rx="2" fill="#1f3f8f" stroke="#10275e"/>
        <text x="10" y="-16" font-size="5.5" text-anchor="middle" fill="#cfe0ff" font-family="monospace">SOIL</text>
        <path d="M-6,-30 V-84 a3,3 0 0 1 6,0 V-30 Z M20,-30 V-84 a3,3 0 0 1 6,0 V-30 Z" fill="#c9a227" stroke="#8a6d10"/>
        <rect x="-10" y="${-30 - 50 * m}" width="40" height="${50 * m}" fill="#6b4a2a" opacity=".45"/>
        <text x="10" y="-88" font-size="7" text-anchor="middle" fill="#9fb0c3" font-family="sans-serif">${Math.round(m * 100)}%</text>`;
    },
  });

  // ---------------------------------------------------------------- Tilt switch
  WB.defPart('tilt', {
    label: 'Tilt switch', category: 'Sensors', prefix: 'SW', dynamic: true, interact: 'toggle', toggleKey: 'tilted',
    defaults: { tilted: false },
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: '2', label: 'Pin 2', x: 10, y: 0 }],
    bbox: () => [-6, -30, 22, 33],
    summary: () => 'closed when upright',
    inspector: [{ key: 'tilted', label: 'Position', type: 'select', options: [[false, 'Upright (closed)'], [true, 'Tilted (open)']] }],
    elements(c) { return c.props.tilted ? [] : [{ t: 'R', a: c.n('1'), b: c.n('2'), r: 0.05 }]; },
    render(p) {
      const t = !!p.props.tilted;
      return `<path d="M0,0 V-8" ${LEG}/><path d="M10,0 V-8" ${LEG}/>
        <g transform="rotate(${t ? 35 : 0} 5 -10)">
          <rect x="-4" y="-28" width="18" height="20" rx="4" fill="#2b2f36" stroke="#111"/>
          <circle cx="5" cy="${t ? -24 : -13}" r="3.2" fill="#c0c4ca"/>
        </g>`;
    },
  });

  // ---------------------------------------------------------------- Piezo buzzer
  WB.defPart('buzzer', {
    label: 'Piezo buzzer', category: 'Output', prefix: 'BZ', dynamic: true,
    defaults: { kind: 'passive' },
    pins: () => [{ id: '+', label: '+', x: 0, y: 0 }, { id: '-', label: '−', x: 20, y: 0 }],
    bbox: () => [-8, -42, 36, 45],
    summary: (p) => p.props.kind,
    inspector: [{ key: 'kind', label: 'Type', type: 'select', options: [['passive', 'Passive (needs tone())'], ['active', 'Active (beeps on DC)']] }],
    elements: (c) => [{ t: 'R', a: c.n('+'), b: c.n('-'), r: 1000 }],
    visualize(c) {
      const e = c.els[0];
      const on = e && Math.abs(e.i) > 0.0008;
      let freq = 0;
      if (on) {
        for (const name in c.sim.pins) {
          const st = c.sim.pins[name];
          if (!st.tone) continue;
          const bn = c.boardNode(name);
          if (bn === c.n('+') || bn === c.n('-')) { freq = st.tone; break; }
          if (!freq) freq = st.tone;
        }
        if (!freq && c.props.kind === 'active') freq = 2300;
      }
      return { on: !!(on && freq), freq };
    },
    render(p, v) {
      const on = v && v.on;
      return `<path d="M0,0 V-8" ${LEG}/><path d="M20,0 V-8" ${LEG}/>
        <circle cx="10" cy="-22" r="16" fill="#1d1d1f" stroke="#000"/>
        <circle cx="10" cy="-22" r="11" fill="none" stroke="#333"/>
        <circle cx="10" cy="-22" r="2.6" fill="#000"/>
        <text x="-1" y="-30" font-size="7" fill="#bbb" font-family="sans-serif">+</text>
        ${on ? `<path d="M30,-30 q5,8 0,16 M34,-34 q8,12 0,24" stroke="#ffd166" stroke-width="1.5" fill="none" stroke-linecap="round"/>` : ''}`;
    },
  });

  // ---------------------------------------------------------------- Servo
  WB.defPart('servo', {
    label: 'Micro servo', category: 'Output', prefix: 'M', dynamic: true,
    defaults: {},
    pins: () => [{ id: 'GND', label: 'GND (brown)', x: 0, y: 0, kind: 'gnd' }, { id: 'V+', label: 'V+ 5 V (red)', x: 10, y: 0, kind: 'pwr' }, { id: 'SIG', label: 'Signal (orange)', x: 20, y: 0 }],
    bbox: () => [-32, -104, 84, 110],
    summary: () => '0–180°',
    elements: (c) => [{ t: 'R', a: c.n('V+'), b: c.n('GND'), r: 1000 }],
    visualize(c) {
      if (c.state.angle === undefined) c.state.angle = 90;
      const powered = c.V('V+') - c.V('GND') > 3.0;
      const sig = c.n('SIG');
      if (powered && sig >= 0) for (const s of c.sim.servos) if (s.pin && c.boardNode(s.pin) === sig) c.state.angle = s.angle;
      return { angle: Math.round(c.state.angle), powered };
    },
    render(p, v) {
      const ang = v && v.angle !== undefined ? v.angle : 90;
      return `<path d="M0,-4 C0,-20 -6,-26 -6,-40" stroke="#6b3e1f" stroke-width="2.2" fill="none"/>
        <path d="M10,-4 C10,-20 4,-26 4,-40" stroke="#d62828" stroke-width="2.2" fill="none"/>
        <path d="M20,-4 C20,-20 14,-26 14,-40" stroke="#f08c00" stroke-width="2.2" fill="none"/>
        <rect x="-4" y="-6" width="28" height="10" rx="1" fill="#111"/>
        <rect x="-30" y="-100" width="80" height="60" rx="4" fill="#2766c9" stroke="#163f80"/>
        <rect x="-38" y="-80" width="96" height="6" rx="2" fill="#2766c9" stroke="#163f80"/>
        <text x="10" y="-48" font-size="7" text-anchor="middle" fill="#cfe0ff" font-family="sans-serif">SERVO</text>
        <circle cx="-4" cy="-78" r="13" fill="#1e56ad"/>
        <g transform="rotate(${(ang - 90).toFixed(1)} -4 -78)">
          <path d="M-8,-78 L-6,-112 A3,3 0 0 1 -2,-112 L0,-78 Z" fill="#f4f4f4" stroke="#999"/>
          <circle cx="-4" cy="-78" r="6" fill="#f4f4f4" stroke="#999"/>
        </g>
        <circle cx="-4" cy="-78" r="2" fill="#888"/>
        <text x="40" y="-90" font-size="7" text-anchor="end" fill="#cfe0ff" font-family="monospace">${Math.round(ang)}°</text>`;
    },
  });

  // ---------------------------------------------------------------- Battery
  WB.defPart('battery', {
    label: 'Battery', category: 'Power', prefix: 'BAT', refPin: '-',
    defaults: { volts: 9 },
    pins: () => [{ id: '+', label: '+', x: 0, y: 0, kind: 'pwr' }, { id: '-', label: '−', x: 20, y: 0, kind: 'gnd' }],
    bbox: () => [-22, -86, 64, 89],
    summary: (p) => p.props.volts + ' V',
    inspector: [{ key: 'volts', label: 'Voltage', type: 'select', options: [[1.5, '1.5 V (1×AA)'], [3, '3 V (2×AA)'], [4.5, '4.5 V (3×AA)'], [6, '6 V (4×AA)'], [3.7, '3.7 V (Li-ion)'], [5, '5 V'], [9, '9 V']] }],
    elements: (c) => [{ t: 'V', a: c.n('+'), b: c.n('-'), v: Number(c.props.volts) || 9, r: 0.5 }],
    visualize(c) {
      const e = c.els[0];
      if (e && Math.abs(e.i) > 2) c.warn(`${c.name}: short circuit (${e.i.toFixed(1)} A)!`);
      return {};
    },
    render(p) {
      const volts = Number(p.props.volts) || 9;
      const wires = (y) => `<path d="M0,0 C0,-12 4,${y + 14} 4,${y}" stroke="#7a1414" stroke-width="2.6" fill="none"/><path d="M0,0 C0,-12 4,${y + 14} 4,${y}" stroke="#e03131" stroke-width="1.7" fill="none"/>
        <path d="M20,0 C20,-12 16,${y + 14} 16,${y}" stroke="#000" stroke-width="2.6" fill="none"/><path d="M20,0 C20,-12 16,${y + 14} 16,${y}" stroke="#2d2f33" stroke-width="1.7" fill="none"/>
        <circle cx="0" cy="0" r="1.3" fill="#d0d4d8"/><circle cx="20" cy="0" r="1.3" fill="#d0d4d8"/>`;
      const T = (x, y, s, t, c, extra = '') => `<text x="${x}" y="${y}" font-size="${s}" text-anchor="middle" fill="${c}" font-family="sans-serif"${extra}>${t}</text>`;
      // AA cells in a black holder (1–4 cells), lying side by side, alternating direction.
      const cells = { 1.5: 1, 3: 2, 4.5: 3, 6: 4 }[volts];
      if (cells) {
        const h = 50 / cells, top = -82;
        let s = `<rect x="-20" y="-84" width="60" height="54" rx="3" fill="url(#wbPlastic)" stroke="#000" stroke-width=".6"/>`;
        for (let k = 0; k < cells; k++) {
          const y = top + k * h + 0.8, ch = h - 1.6, flip = k % 2 === 1;
          const x0 = -14, x1 = 34, nub = flip ? x0 - 2 : x1;
          s += `<rect x="${nub}" y="${y + ch * 0.32}" width="2" height="${ch * 0.36}" rx=".5" fill="url(#wbMetalV)"/>
            <rect x="${x0}" y="${y}" width="${x1 - x0}" height="${ch}" rx="${Math.min(3, ch / 3)}" fill="#2f6fc0"/>
            <rect x="${flip ? x0 : x1 - 13}" y="${y}" width="13" height="${ch}" fill="#c9d0d8"/>
            <rect x="${x0}" y="${y}" width="${x1 - x0}" height="${ch}" rx="${Math.min(3, ch / 3)}" fill="url(#wbShadeV)" stroke="#0006" stroke-width=".4"/>
            ${ch > 9 ? T(flip ? 14.5 : 8.5, y + ch / 2 + 2.2, Math.min(6, ch * 0.45), 'AA 1.5V', '#fff', ' font-weight="700"') : ''}
            ${T(flip ? 31 : -11, y + ch / 2 + 2, Math.min(7, ch * 0.55), flip ? '−' : '+', '#fff', ' font-weight="700"')}`;
        }
        return wires(-30) + s;
      }
      // 3.7 V: one 18650 Li-ion cell in a holder.
      if (volts === 3.7) {
        return `${wires(-38)}<rect x="-20" y="-80" width="60" height="42" rx="3" fill="url(#wbPlastic)" stroke="#000" stroke-width=".6"/>
          <rect x="-18" y="-70" width="3" height="22" fill="url(#wbMetal)"/><rect x="35" y="-70" width="3" height="22" fill="url(#wbMetal)"/>
          <rect x="-15" y="-74" width="50" height="30" rx="4" fill="#1d8f86"/>
          <rect x="31" y="-74" width="4" height="30" fill="#c9d0d8"/>
          <rect x="-15" y="-74" width="50" height="30" rx="4" fill="url(#wbShadeV)" stroke="#0006" stroke-width=".4"/>
          ${T(8, -60, 7, 'Li-ion 18650', '#fff', ' font-weight="700"')}${T(8, -51, 7, '3.7 V', '#e6fffb')}`;
      }
      // 9 V (and others): rectangular battery, snap terminals on top, two-tone label.
      return `${wires(-30)}<rect x="-20" y="-76" width="60" height="46" rx="3.5" fill="#2a2b2f"/>
        <rect x="-20" y="-76" width="60" height="21" rx="3.5" fill="#d9a520"/><rect x="-20" y="-59" width="60" height="4" fill="#d9a520"/>
        <rect x="-20" y="-76" width="60" height="46" rx="3.5" fill="url(#wbShadeH)" stroke="#000" stroke-width=".6"/>
        <rect x="-16" y="-80" width="52" height="5" rx="1.2" fill="url(#wbMetalV)" stroke="#6b7179" stroke-width=".4"/>
        <circle cx="-3" cy="-82" r="4.2" fill="url(#wbMetal)" stroke="#5f656c" stroke-width=".5"/><circle cx="-3" cy="-82" r="2" fill="#7d838b"/>
        <path d="M18.4,-82 l2.3,-4 h4.6 l2.3,4 l-2.3,4 h-4.6 Z" fill="url(#wbMetal)" stroke="#5f656c" stroke-width=".5"/>
        ${T(-3, -62, 9, '+', '#3a2a00', ' font-weight="700"')}${T(23, -62, 9, '−', '#3a2a00', ' font-weight="700"')}
        ${T(10, -37, 15, volts + 'V', '#f4f4f4', ' font-weight="800"')}`;
    },
  });

  // ---------------------------------------------------------------- Capacitors
  // Simulated through time: a circuit with a capacitor runs the time-domain solver.
  WB.fmtFarads = (f) => {
    f = Number(f) || 0;
    if (f >= 1e-3) return +(f * 1e3).toPrecision(3) + ' mF';
    if (f >= 1e-6) return +(f * 1e6).toPrecision(3) + ' µF';
    if (f >= 1e-9) return +(f * 1e9).toPrecision(3) + ' nF';
    return +(f * 1e12).toPrecision(3) + ' pF';
  };
  const CAP_CERAMIC = [1e-9, 10e-9, 22e-9, 47e-9, 100e-9, 220e-9, 470e-9, 1e-6].map((f) => [f, WB.fmtFarads(f)]);
  const CAP_ELECTRO = [1e-6, 4.7e-6, 10e-6, 22e-6, 47e-6, 100e-6, 220e-6, 470e-6, 1000e-6].map((f) => [f, WB.fmtFarads(f)]);
  const capValue = (p, def) => Math.max(1e-12, Number(p.farads) || def);
  WB.defPart('capacitor', {
    label: 'Ceramic capacitor', category: 'Passive', prefix: 'C',
    defaults: { farads: 100e-9 },
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: '2', label: 'Pin 2', x: 10, y: 0 }],
    bbox: () => [-6, -24, 22, 27],
    summary: (p) => WB.fmtFarads(p.props.farads),
    inspector: [{ key: 'farads', label: 'Capacitance', type: 'select', options: CAP_CERAMIC }],
    elements: (c) => [{ t: 'C', a: c.n('1'), b: c.n('2'), c: capValue(c.props, 100e-9), st: c.state }],
    render(p) {
      const lbl = WB.fmtFarads(p.props.farads).replace(' ', '');
      return `<path d="M0,0 V-8 L2,-11" ${MLEG}/><path d="M10,0 V-8 L8,-11" ${MLEG}/>
        <ellipse cx="5" cy="-16" rx="9" ry="7.5" fill="#d9822b" stroke="#8a4d12" stroke-width=".8"/>
        <ellipse cx="5" cy="-16" rx="9" ry="7.5" fill="url(#wbCap)" opacity=".8"/>
        <text x="5" y="-14" font-size="4.6" text-anchor="middle" fill="#3a1f05" font-family="sans-serif" font-weight="700">${WB.esc(lbl)}</text>`;
    },
  });
  WB.defPart('ecap', {
    label: 'Electrolytic capacitor', category: 'Passive', prefix: 'C', dynamic: true,
    defaults: { farads: 100e-6 },
    pins: () => [{ id: '+', label: '+ (long leg)', x: 0, y: 0 }, { id: '-', label: '− (stripe side)', x: 10, y: 0 }],
    bbox: () => [-6, -40, 22, 43],
    summary: (p) => WB.fmtFarads(p.props.farads) + ', polarized',
    inspector: [{ key: 'farads', label: 'Capacitance', type: 'select', options: CAP_ELECTRO }],
    elements: (c) => [{ t: 'C', a: c.n('+'), b: c.n('-'), c: capValue(c.props, 100e-6), st: c.state }],
    visualize(c) {
      const vc = (c.state && c.state.vc) || 0;
      if (vc < -1) { c.warn(`${c.name} is connected backwards (${vc.toFixed(1)} V). The stripe (−) side must go to the lower voltage.`); return { bad: true }; }
      return {};
    },
    render(p, v) {
      const bad = v && v.bad;
      return `<path d="M0,0 V-8" ${MLEG}/><path d="M10,0 V-8" ${MLEG}/>
        <rect x="-4" y="-38" width="18" height="30" rx="3" fill="${bad ? '#7a2f2f' : '#1f3f8f'}" stroke="#0d214f" stroke-width=".8"/>
        <rect x="8" y="-38" width="6" height="30" fill="#c9d3e8" opacity=".85"/>
        <text x="11" y="-31" font-size="5" text-anchor="middle" fill="#1f3f8f" font-family="sans-serif" font-weight="700">−</text>
        <text x="11" y="-14" font-size="5" text-anchor="middle" fill="#1f3f8f" font-family="sans-serif" font-weight="700">−</text>
        <rect x="-4" y="-38" width="18" height="30" rx="3" fill="url(#wbShadeH)"/>
        <ellipse cx="5" cy="-38" rx="9" ry="2" fill="url(#wbMetal)"/><path d="M1,-38 h8 M5,-39.6 v3.2" stroke="#7d838b" stroke-width=".5"/>
        <text x="2" y="-21" font-size="4.6" text-anchor="middle" fill="#e6ecf8" font-family="sans-serif" transform="rotate(-90 2 -21)">${WB.esc(WB.fmtFarads(p.props.farads).replace(' ', ''))}</text>`;
    },
  });

  // ---------------------------------------------------------------- Diode
  const DIODES = { '1N4148': { vf: 0.65, rs: 2, label: '1N4148 (small signal)' }, '1N4001': { vf: 0.75, rs: 0.3, label: '1N4001 (rectifier)' }, schottky: { vf: 0.3, rs: 0.5, label: '1N5817 (Schottky)' } };
  WB.defPart('diode', {
    label: 'Diode', category: 'Passive', prefix: 'D',
    defaults: { model: '1N4148' },
    pins: () => [{ id: 'A', label: 'Anode (+)', x: 0, y: 0 }, { id: 'K', label: 'Cathode (−, band side)', x: 40, y: 0 }],
    bbox: () => [-4, -7, 48, 14],
    summary: (p) => (DIODES[p.props.model] || DIODES['1N4148']).label,
    inspector: [{ key: 'model', label: 'Type', type: 'select', options: Object.keys(DIODES).map((k) => [k, DIODES[k].label]) }],
    elements(c) { const d = DIODES[c.props.model] || DIODES['1N4148']; return [{ t: 'D', a: c.n('A'), b: c.n('K'), vf: d.vf, rs: d.rs }]; },
    render(p) {
      const big = p.props.model === '1N4001';
      return `<line x1="0" y1="0" x2="40" y2="0" ${LEG}/>
        <rect x="${big ? 9 : 11}" y="${big ? -5 : -4}" width="${big ? 22 : 18}" height="${big ? 10 : 8}" rx="2" fill="${big ? '#1d1d1f' : '#c0392b'}" fill-opacity="${big ? 1 : 0.8}" stroke="#0007" stroke-width=".6"/>
        <rect x="${big ? 26 : 25}" y="${big ? -5 : -4}" width="2.6" height="${big ? 10 : 8}" fill="${big ? '#d8d8d8' : '#111'}"/>
        <rect x="${big ? 9 : 11}" y="${big ? -5 : -4}" width="${big ? 22 : 18}" height="${big ? 10 : 8}" rx="2" fill="url(#wbShadeV)"/>`;
    },
  });

  // ---------------------------------------------------------------- Zener diode
  // Forward: like a diode. Reverse: conducts once the voltage exceeds Vz (breakdown),
  // which holds the cathode about Vz above the anode — a simple voltage regulator.
  const ZENERS = {
    '3V3': { vz: 3.3, label: '3.3 V (1N4728A)' }, '5V1': { vz: 5.1, label: '5.1 V (1N4733A)' },
    '9V1': { vz: 9.1, label: '9.1 V (1N4739A)' }, '12V': { vz: 12, label: '12 V (1N4742A)' },
  };
  WB.defPart('zener', {
    label: 'Zener diode', category: 'Passive', prefix: 'D', dynamic: true,
    defaults: { model: '5V1' },
    pins: () => [{ id: 'A', label: 'Anode (to the lower voltage, e.g. GND)', x: 0, y: 0 }, { id: 'K', label: 'Cathode (band side, to the regulated voltage)', x: 40, y: 0 }],
    bbox: () => [-4, -7, 48, 14],
    summary: (p) => 'Zener ' + (ZENERS[p.props.model] || ZENERS['5V1']).label,
    inspector: [{ key: 'model', label: 'Zener voltage', type: 'select', options: Object.keys(ZENERS).map((k) => [k, ZENERS[k].label]) }],
    elements(c) { const z = ZENERS[c.props.model] || ZENERS['5V1']; return [{ t: 'D', a: c.n('A'), b: c.n('K'), vf: 0.7, rs: 5, vz: z.vz }]; },
    visualize(c) {
      const e = c.els[0], z = ZENERS[c.props.model] || ZENERS['5V1'];
      if (!e) return {};
      const p = Math.abs(e.i) * (e.i < 0 ? z.vz : 0.7);
      if (p > 1) c.warn(`${c.name}: ${p.toFixed(1)} W is too much for a 1 W zener — use a bigger series resistor.`);
      return { on: Math.abs(e.i) > 1e-4, hot: p > 1 };
    },
    render(p, v) {
      const z = ZENERS[p.props.model] ? p.props.model : '5V1';
      return `<line x1="0" y1="0" x2="40" y2="0" ${LEG}/>
        <rect x="11" y="-4.5" width="18" height="9" rx="2" fill="${v && v.hot ? '#ff5a3c' : '#e8a33a'}" fill-opacity=".85" stroke="#0007" stroke-width=".6"/>
        <rect x="25" y="-4.5" width="2.6" height="9" fill="#111"/>
        <text x="18" y="1.6" font-size="4.2" text-anchor="middle" fill="#3a2205" font-family="sans-serif" font-weight="700"${(p.rot || 0) === 180 ? ' transform="rotate(180 18 0)"' : ''}>Z${z}</text>`;
    },
  });

  // ---------------------------------------------------------------- Inductor
  // Simulated through time (BDF2, with its winding resistance in series).
  // In a steady DC circuit it is just a short through the winding resistance.
  WB.fmtHenries = (h) => {
    h = Number(h) || 0;
    if (h >= 1) return +h.toPrecision(3) + ' H';
    if (h >= 1e-3) return +(h * 1e3).toPrecision(3) + ' mH';
    return +(h * 1e6).toPrecision(3) + ' µH';
  };
  const INDUCTORS = [[10e-6, 0.05], [47e-6, 0.15], [100e-6, 0.3], [470e-6, 1], [1e-3, 2], [4.7e-3, 6], [10e-3, 12], [47e-3, 35], [100e-3, 60], [1, 200]];
  const indRw = (h) => (INDUCTORS.find((x) => x[0] === +h) || [0, 1])[1];
  WB.defPart('inductor', {
    label: 'Inductor (coil)', category: 'Passive', prefix: 'L', dynamic: true,
    defaults: { henries: 10e-3 },
    pins: () => [{ id: '1', label: 'Pin 1', x: 0, y: 0 }, { id: '2', label: 'Pin 2', x: 40, y: 0 }],
    bbox: () => [-4, -14, 48, 24],
    summary: (p) => `${WB.fmtHenries(p.props.henries)}, ${indRw(p.props.henries)} Ω winding`,
    inspector: [{ key: 'henries', label: 'Inductance', type: 'select', options: INDUCTORS.map(([h, r]) => [h, `${WB.fmtHenries(h)} (${r} Ω winding)`]) }],
    elements: (c) => [{ t: 'L', a: c.n('1'), b: c.n('2'), l: Math.max(1e-9, Number(c.props.henries) || 10e-3), rw: indRw(c.props.henries), st: c.state }],
    visualize(c) {
      const vd = Math.abs(c.V('1') - c.V('2'));
      if (vd > 60) c.warn(`${c.name}: ${Math.round(vd)} V across the coil — interrupting an inductor's current makes a voltage spike. Add a flyback diode across it.`);
      return {};
    },
    render(p) {
      let turns = '';
      for (let i = 0; i < 7; i++) { const x = 10 + i * 3.2; turns += `<path d="M${x},-6.5 C${x + 2.6},-6.5 ${x + 2.6},6.5 ${x + 1.3},6.5" fill="none" stroke="#b8732a" stroke-width="1.6"/>`; }
      return `<line x1="0" y1="0" x2="40" y2="0" ${LEG}/>
        <rect x="8" y="-5" width="25" height="10" rx="2" fill="#2d2d2d" stroke="#000" stroke-width=".5"/>
        <path d="M9,-6.5 H32 M9,6.5 H32" stroke="#d48a3c" stroke-width="1.1"/>
        ${turns}
        <text x="20.5" y="-8.5" font-size="4.2" text-anchor="middle" fill="#555" font-family="sans-serif" font-weight="700"${(p.rot || 0) === 180 ? ' transform="rotate(180 20.5 -10)"' : ''}>${WB.esc(WB.fmtHenries(p.props.henries).replace(' ', ''))}</text>`;
    },
  });

  // ---------------------------------------------------------------- DC power supply (bench)
  // Constant voltage until the current limit is reached, then constant current.
  // Front panel buttons (part coordinates): voltage −1 / −0.1 / +0.1 / +1 V under the display,
  // current limit I+ / I− on the right.
  const PS_I = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 1.5, 2, 3, 5];
  const PSBTN = [];
  [['v--', '−1'], ['v-', '−.1'], ['v+', '+.1'], ['v++', '+1']].forEach(([a, t], k) => PSBTN.push({ a, x: -32 + k * 15.25, y: -52, w: 14, h: 11, t }));
  PSBTN.push({ a: 'i+', x: 34, y: -88, w: 28, h: 12, t: 'I +' }, { a: 'i-', x: 34, y: -73, w: 28, h: 12, t: 'I −' });
  WB.defPart('psu', {
    label: 'DC power supply', category: 'Instruments', prefix: 'PS', dynamic: true, refPin: '-', interact: 'panel',
    defaults: { volts: 5, ilimit: 1 },
    pins: () => [{ id: '+', label: '+ output (red)', x: 0, y: 0, kind: 'pwr' }, { id: '-', label: '− output (black)', x: 30, y: 0, kind: 'gnd' }],
    bbox: () => [-40, -96, 110, 102],
    summary: (p) => Number(p.props.volts).toFixed(1) + ' V, limit ' + Number(p.props.ilimit) + ' A',
    inspector: [
      { key: 'volts', label: 'Voltage', type: 'range', min: 0, max: 30, step: 0.1, fmt: (v) => Number(v).toFixed(1) + ' V', live: true },
      { key: 'ilimit', label: 'Current limit', type: 'range', min: 0.01, max: 5, step: 0.01, fmt: (v) => Number(v).toFixed(2) + ' A', live: true },
    ],
    hit(lx, ly) { const b = PSBTN.find((q) => lx >= q.x && lx <= q.x + q.w && ly >= q.y && ly <= q.y + q.h); return b ? b.a : null; },
    panelAction(part, act) {
      const pr = part.props;
      const dv = { 'v--': -1, 'v-': -0.1, 'v+': 0.1, 'v++': 1 }[act];
      if (dv !== undefined) { pr.volts = +WB.clamp((Number(pr.volts) || 0) + dv, 0, 30).toFixed(1); return; }
      const cur = Number(pr.ilimit) || 1;
      const nx = act === 'i+' ? PS_I.find((x) => x > cur + 1e-9) : [...PS_I].reverse().find((x) => x < cur - 1e-9);
      if (nx !== undefined) pr.ilimit = nx;
    },
    elements(c) {
      const vset = WB.clamp(Number(c.props.volts) || 0, 0, 30), ilim = WB.clamp(Number(c.props.ilimit) || 1, 0.001, 5);
      // CC mode: a current source (Norton equivalent with a very high resistance)
      if (c.state.cc) return [{ t: 'V', a: c.n('+'), b: c.n('-'), v: ilim * 1e6, r: 1e6 }];
      return [{ t: 'V', a: c.n('+'), b: c.n('-'), v: vset, r: 0.01 }];
    },
    visualize(c) {
      const e = c.els[0];
      if (!e) return { v: 0, i: 0 };
      const vset = WB.clamp(Number(c.props.volts) || 0, 0, 30), ilim = WB.clamp(Number(c.props.ilimit) || 1, 0.001, 5);
      const vout = c.V('+') - c.V('-');
      let again = false;
      if (!c.state.cc && e.i > ilim * 1.001) { c.state.cc = true; again = true; }
      else if (c.state.cc && vout > vset) { c.state.cc = false; again = true; }
      return { v: +Math.min(vout, vset).toFixed(2), i: +Math.max(0, e.i).toFixed(3), cc: !!c.state.cc, again };
    },
    render(p, v) {
      v = v || {};
      const vs = v.v !== undefined ? v.v.toFixed(2) : Number(p.props.volts).toFixed(2);
      const is = v.i !== undefined ? v.i.toFixed(3) : '0.000';
      const lim = Number(p.props.ilimit) || 1;
      const btns = PSBTN.map((b) => `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" fill="#3a404b" stroke="#1d2129" stroke-width=".7"/>
        <text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 2}" font-size="5.6" text-anchor="middle" fill="#eef1f6" font-family="sans-serif" font-weight="700">${b.t}</text></g>`).join('');
      return `<rect x="-38" y="-94" width="106" height="88" rx="6" fill="#d7dbe0" stroke="#7d848c"/>
        <rect x="-32" y="-89" width="60" height="33" rx="3" fill="#10151b"/>
        <text x="20" y="-75" font-size="12" text-anchor="end" fill="#ff5a4a" font-family="monospace" font-weight="700">${vs}</text>
        <text x="21.5" y="-75" font-size="6" fill="#ff5a4a" font-family="monospace">V</text>
        <text x="20" y="-60" font-size="9" text-anchor="end" fill="#4ade80" font-family="monospace" font-weight="700">${is}</text>
        <text x="21.5" y="-60" font-size="6" fill="#4ade80" font-family="monospace">A</text>
        <text x="-30" y="-60" font-size="4.3" fill="#7f8a99" font-family="monospace">≤${lim}A</text>
        ${btns}
        <text x="48" y="-55" font-size="4.6" text-anchor="middle" fill="#444" font-family="sans-serif">current limit</text>
        <circle cx="-26" cy="-34" r="2.5" fill="${v.cc ? '#333' : '#4ade80'}"/><text x="-21" y="-32" font-size="5.5" fill="#333" font-family="sans-serif">CV</text>
        <circle cx="-6" cy="-34" r="2.5" fill="${v.cc ? '#ff5a4a' : '#333'}"/><text x="-1" y="-32" font-size="5.5" fill="#333" font-family="sans-serif">CC</text>
        <text x="48" y="-36" font-size="6" text-anchor="middle" fill="#333" font-family="sans-serif" font-weight="700">DC POWER</text>
        <circle cx="0" cy="-17" r="6" fill="#111" stroke="#d62828" stroke-width="2.2"/><circle cx="30" cy="-17" r="6" fill="#111" stroke="#555" stroke-width="2.2"/>
        <text x="-10" y="-15" font-size="6.5" text-anchor="middle" fill="#d62828" font-family="sans-serif" font-weight="700">+</text>
        <text x="40" y="-15" font-size="6.5" text-anchor="middle" fill="#333" font-family="sans-serif" font-weight="700">−</text>
        <path d="M0,-11 V0" stroke="#d62828" stroke-width="2"/><path d="M30,-11 V0" stroke="#222" stroke-width="2"/>`;
    },
  });

  // ---------------------------------------------------------------- Function generator
  const FG_SHAPES = [['sine', 'Sine'], ['square', 'Square'], ['triangle', 'Triangle'], ['sawtooth', 'Sawtooth']];
  const FG_CODE = { sine: 1, square: 2, triangle: 3, sawtooth: 4 };
  WB.fmtHz = (f) => { f = Number(f) || 0; return f >= 1e6 ? +(f / 1e6).toPrecision(4) + ' MHz' : f >= 1e3 ? +(f / 1e3).toPrecision(4) + ' kHz' : +f.toPrecision(4) + ' Hz'; };
  const FG_GLYPH = {
    sine: 'M0,0 C3,-9 7,-9 10,0 C13,9 17,9 20,0',
    square: 'M0,6 V-6 H10 V6 H20 V-6',
    triangle: 'M0,0 L5,-7 L15,7 L20,0',
    sawtooth: 'M0,6 L10,-6 V6 L20,-6 V6',
  };
  // Front panel (part coordinates): waveform keys under the display, FREQ / AMPL / OFFSET
  // buttons and the OUTPUT key on the right. Values step through "nice" numbers.
  const FG_FREQ_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  const FG_VPP = [0, 0.1, 0.2, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20];
  const FG_FREQ_LIST = [];
  for (let e = -1; e <= 6; e++) for (const m of FG_FREQ_STEPS) { const x = +(m * 10 ** e).toPrecision(3); if (x >= 0.1 && x <= 1e6) FG_FREQ_LIST.push(x); }
  const fgNextIn = (list, v, dir) => {
    v = Number(v) || 0;
    const nx = dir > 0 ? list.find((x) => x > v * 1.0001 + 1e-9) : [...list].reverse().find((x) => x < v * 0.9999 - 1e-9);
    return nx === undefined ? v : nx;
  };
  const FBTN = [];
  FG_SHAPES.forEach(([k], i) => FBTN.push({ a: 'shape:' + k, x: -62 + i * 32, y: -68, w: 28, h: 13, shape: k }));
  [['f/10', '÷10'], ['f-', '−'], ['f+', '+'], ['f*10', '×10']].forEach(([a, t], i) => FBTN.push({ a, x: 72 + i * 24, y: -113, w: 21, h: 13, t }));
  FBTN.push({ a: 'a-', x: 72, y: -88, w: 44, h: 13, t: '−' }, { a: 'a+', x: 120, y: -88, w: 44, h: 13, t: '+' });
  FBTN.push({ a: 'o-', x: 72, y: -63, w: 44, h: 13, t: '−' }, { a: 'o+', x: 120, y: -63, w: 44, h: 13, t: '+' });
  FBTN.push({ a: 'out', x: 72, y: -43, w: 92, h: 16, out: true });
  const hitList = (list) => (lx, ly) => {
    const b = list.find((q) => lx >= q.x - 1 && lx <= q.x + q.w + 1 && ly >= q.y - 1 && ly <= q.y + q.h + 1);
    return b ? b.a : null;
  };
  WB.defPart('fgen', {
    label: 'Function generator', category: 'Instruments', prefix: 'FG', dynamic: true, interact: 'panel',
    groundPins: (pr) => (pr.floating ? [] : ['COM']), // like a real bench generator, COM is earthed (shared with the scope's ground) unless set to floating
    defaults: { shape: 'sine', freq: 1000, vpp: 5, offset: 0, out: true },
    pins: () => [{ id: '+', label: 'Output + (red)', x: 0, y: 0, kind: 'pwr' }, { id: 'COM', label: 'COM − (black)', x: 30, y: 0, kind: 'gnd' }],
    bbox: () => [-72, -132, 244, 138],
    summary: (p) => `${(FG_SHAPES.find((s) => s[0] === p.props.shape) || FG_SHAPES[0])[1]}, ${WB.fmtHz(p.props.freq)}, ${Number(p.props.vpp)} Vpp` + (p.props.out === false ? ', output off' : ''),
    inspector: [
      { key: 'shape', label: 'Waveform', type: 'select', options: FG_SHAPES, live: true },
      { key: 'freq', label: 'Frequency (Hz)', type: 'number', min: 0.1, step: 'any', live: true, suggestions: [1, 10, 50, 60, 100, 440, 1000, 5000, 10000, 50000], sugFmt: WB.fmtHz },
      { key: 'vpp', label: 'Amplitude (V peak-to-peak)', type: 'number', min: 0, step: 'any', live: true, allowZero: true },
      { key: 'offset', label: 'DC offset (V)', type: 'number', step: 'any', live: true, allowZero: true },
      { key: 'out', label: 'Output', type: 'select', options: [[true, 'On'], [false, 'Off (disconnected)']], live: true },
      { key: 'floating', label: 'COM terminal', type: 'select', options: [[false, 'Earthed (joined to the scope ground)'], [true, 'Floating (isolated output)']] },
    ],
    // Output off = the 50 Ω output is disconnected (very high resistance, no signal).
    elements: (c) => {
      const on = c.props.out !== false;
      return [{
        t: 'V', a: c.n('+'), b: c.n('COM'), r: on ? 50 : 1e9,
        v: on ? WB.clamp(Number(c.props.offset) || 0, -20, 20) : 0,
        shape: FG_CODE[c.props.shape] || 1,
        freq: WB.clamp(Number(c.props.freq) || 1000, 0.1, 1e6),
        amp: on ? WB.clamp(Number(c.props.vpp) || 0, 0, 40) / 2 : 0,
      }];
    },
    visualize(c) {
      const e = c.els[0];
      if (e && Math.abs(e.ipk) > 0.2) c.warn(`${c.name}: output overloaded (${Math.round(Math.abs(e.ipk) * 1000)} mA peak). It has a 50 Ω output — add a resistor.`);
      return {};
    },
    hit: hitList(FBTN),
    panelAction(p, act) {
      const pr = p.props;
      if (act.startsWith('shape:')) pr.shape = act.slice(6);
      else if (act === 'f-' || act === 'f+') pr.freq = fgNextIn(FG_FREQ_LIST, pr.freq, act === 'f+' ? 1 : -1);
      else if (act === 'f*10') pr.freq = +WB.clamp((Number(pr.freq) || 1000) * 10, 0.1, 1e6).toPrecision(6);
      else if (act === 'f/10') pr.freq = +WB.clamp((Number(pr.freq) || 1000) / 10, 0.1, 1e6).toPrecision(6);
      else if (act === 'a-' || act === 'a+') pr.vpp = fgNextIn(FG_VPP, pr.vpp, act === 'a+' ? 1 : -1);
      else if (act === 'o-' || act === 'o+') pr.offset = WB.clamp(Math.round(((Number(pr.offset) || 0) + (act === 'o+' ? 0.5 : -0.5)) * 2) / 2, -10, 10);
      else if (act === 'out') pr.out = pr.out === false;
    },
    render(p) {
      const shape = FG_GLYPH[p.props.shape] ? p.props.shape : 'sine';
      const off = Number(p.props.offset) || 0, on = p.props.out !== false;
      const btns = FBTN.map((b) => {
        if (b.shape) {
          const sel = b.shape === shape;
          return `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2.5" fill="${sel ? '#0f2a36' : '#3a3f47'}" stroke="${sel ? '#5ee0ff' : '#23262b'}" stroke-width="${sel ? 1.1 : 0.8}"/>
            <path d="${FG_GLYPH[b.shape]}" transform="translate(${b.x + 6} ${b.y + 6.5}) scale(.8 .6)" fill="none" stroke="${sel ? '#5ee0ff' : '#e6e9ee'}" stroke-width="1.6" stroke-linejoin="round"/></g>`;
        }
        if (b.out) {
          return `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" fill="${on ? '#1f7a3d' : '#4a4f57'}" stroke="${on ? '#5be08a' : '#2a2d33'}" stroke-width=".9"/>
            <circle cx="${b.x + 10}" cy="${b.y + 8}" r="2.6" fill="${on ? '#b8ff9e' : '#2b2b2b'}" stroke="${on ? '#8dff7a' : '#111'}" stroke-width=".8"/>
            <text x="${b.x + b.w / 2 + 6}" y="${b.y + 10.8}" font-size="7.5" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">OUTPUT ${on ? 'ON' : 'OFF'}</text></g>`;
        }
        return `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2.5" fill="#3a3f47" stroke="#23262b" stroke-width=".8"/>
          <text x="${b.x + b.w / 2}" y="${b.y + 9.6}" font-size="${b.t.length > 1 ? 6.5 : 8.5}" text-anchor="middle" fill="#f2f4f7" font-family="sans-serif" font-weight="700">${b.t}</text></g>`;
      }).join('');
      const lab = (y, t) => `<text x="72" y="${y}" font-size="5.5" fill="#3b4048" font-family="sans-serif" font-weight="700">${t}</text>`;
      return `<rect x="-70" y="-130" width="240" height="124" rx="7" fill="#cfd5dc" stroke="#7d848c"/>
        <rect x="-64" y="-124" width="128" height="52" rx="4" fill="#0b1f28" stroke="#3d4a52"/>
        <g opacity="${on ? 1 : 0.45}">
          <path d="${FG_GLYPH[shape]}" transform="translate(-58 -108) scale(1.2)" fill="none" stroke="#5ee0ff" stroke-width="1.5" stroke-linejoin="round"/>
          <text x="58" y="-104" font-size="13" text-anchor="end" fill="#5ee0ff" font-family="monospace" font-weight="700">${WB.esc(WB.fmtHz(p.props.freq))}</text>
          <text x="-58" y="-88" font-size="7.5" fill="#9fe9ff" font-family="monospace">AMPL ${Number(p.props.vpp).toFixed(2)} Vpp</text>
          <text x="-58" y="-78" font-size="7.5" fill="#9fe9ff" font-family="monospace">OFFS ${off > 0 ? '+' : ''}${off.toFixed(2)} V</text>
        </g>
        <text x="58" y="-78" font-size="6.5" text-anchor="end" fill="${on ? '#8dff7a' : '#ff8a80'}" font-family="monospace" font-weight="700">${on ? 'OUT ON' : 'OUT OFF'}</text>
        ${lab(-117, 'FREQUENCY')}${lab(-92, 'AMPLITUDE')}${lab(-67, 'OFFSET')}
        ${btns}
        <text x="-62" y="-44" font-size="6.5" fill="#333" font-family="sans-serif" font-weight="700">FUNCTION GENERATOR</text>
        <text x="-62" y="-36" font-size="5" fill="#555" font-family="sans-serif">50 Ω output · click the buttons</text>
        <circle cx="0" cy="-17" r="6" fill="#111" stroke="#d62828" stroke-width="2.2"/><circle cx="30" cy="-17" r="6" fill="#111" stroke="#555" stroke-width="2.2"/>
        <text x="-10" y="-15" font-size="6" text-anchor="end" fill="#d62828" font-family="sans-serif" font-weight="700">OUT</text>
        <text x="40" y="-15" font-size="6" fill="#333" font-family="sans-serif" font-weight="700">COM</text>
        <path d="M0,-11 V0" stroke="#d62828" stroke-width="2"/><path d="M30,-11 V0" stroke="#222" stroke-width="2"/>`;
    },
  });

  // ---------------------------------------------------------------- Multimeter
  // Jacks: A (current), COM, VΩ (voltage / resistance). Measures with real circuit elements:
  // V = 10 MΩ input, A = 50 mΩ shunt, Ω = 0.5 V test source through 1 kΩ.
  // V~ / A~ are true-RMS readings of the AC part of the signal (the DC part is removed).
  const METER_MODES = [['V', 'DC voltage (V)'], ['V~', 'AC voltage (V rms)'], ['A', 'DC current (A)'], ['A~', 'AC current (A rms)'], ['Ω', 'Resistance (Ω)']];
  function fmtMeter(mode, x) {
    if (x === null || x === undefined) return '- - - -';
    if (x === 'OL') return 'OL';
    const a = Math.abs(x);
    if (mode === 'V' || mode === 'V~') return a < 1 ? (x * 1000).toFixed(1) + ' mV' : x.toFixed(a < 10 ? 3 : 2) + ' V';
    if (mode === 'A' || mode === 'A~') return a < 1e-3 ? (x * 1e6).toFixed(0) + ' µA' : a < 1 ? (x * 1000).toFixed(2) + ' mA' : x.toFixed(3) + ' A';
    return a >= 1e6 ? (x / 1e6).toFixed(2) + ' MΩ' : a >= 1e3 ? (x / 1e3).toFixed(2) + ' kΩ' : x.toFixed(1) + ' Ω';
  }
  // Dial positions: click a mode label to jump to it, or the knob to step to the next mode.
  const DIAL = [['V', -70], ['V~', -35], ['A', 0], ['A~', 35], ['Ω', 70]].map(([k, a]) => {
    const r = 29, x = 20 + r * Math.sin((a * Math.PI) / 180), y = -67 - r * Math.cos((a * Math.PI) / 180);
    return { k, a, x, y };
  });
  WB.defPart('multimeter', {
    label: 'Multimeter', category: 'Instruments', prefix: 'DMM', dynamic: true, interact: 'panel',
    hit(lx, ly) {
      const d = DIAL.find((q) => Math.abs(lx - q.x) <= 8 && Math.abs(ly - q.y) <= 7);
      if (d) return 'mode:' + d.k;
      return (lx - 20) ** 2 + (ly + 67) ** 2 <= 20 * 20 ? 'next' : null;
    },
    panelAction(p, act) {
      const keys = METER_MODES.map((m) => m[0]);
      p.props.mode = act === 'next' ? keys[(keys.indexOf(p.props.mode) + 1) % keys.length] : act.slice(5);
    },
    defaults: { mode: 'V' },
    pins: () => [
      { id: 'A', label: 'A jack — current (put the meter in series)', x: 0, y: 0, kind: 'pwr' },
      { id: 'COM', label: 'COM jack — common (black lead)', x: 20, y: 0, kind: 'gnd' },
      { id: 'V', label: 'VΩ jack — voltage / resistance (red lead)', x: 40, y: 0, kind: 'pwr' },
    ],
    bbox: () => [-30, -150, 100, 156],
    summary: (p) => (METER_MODES.find((m) => m[0] === p.props.mode) || METER_MODES[0])[1],
    inspector: [{ key: 'mode', label: 'Measure', type: 'select', options: METER_MODES, live: true }],
    elements(c) {
      const m = c.props.mode;
      if (m === 'A' || m === 'A~') return [{ t: 'R', a: c.n('A'), b: c.n('COM'), r: 0.05, tag: 'meter' }];
      if (m === 'Ω') return [{ t: 'V', a: c.n('V'), b: c.n('COM'), v: 0.5, r: 1000, tag: 'meter' }];
      return [{ t: 'R', a: c.n('V'), b: c.n('COM'), r: 1e7, tag: 'meter' }];
    },
    visualize(c) {
      const m = c.props.mode, e = c.els[0];
      if (!e) return { reading: 'OL' };
      // AC readings are averaged over several frames (like a real meter's ~0.3 s update), so a
      // frame that holds a fraction of a period doesn't make the display jump.
      const s = c.state;
      if (s.mode !== m) { s.mode = m; s.ai = e.i; s.ai2 = e.i2 || 0; }
      else { s.ai += 0.15 * (e.i - s.ai); s.ai2 += 0.15 * ((e.i2 || 0) - s.ai2); }
      const acRms = () => Math.sqrt(Math.max(0, s.ai2 - s.ai * s.ai));
      if (m === 'A') return { reading: +e.i.toPrecision(4) };
      if (m === 'A~') return { reading: +acRms().toPrecision(4) };
      if (m === 'V~') return { reading: +(acRms() * 1e7).toFixed(4) };
      const vt = c.V('V') - c.V('COM');
      if (m === 'V') return { reading: +vt.toFixed(4) };
      const i = (0.5 - vt) / 1000;
      if (i < 1e-10 || vt < -1e-6) return { reading: 'OL' };
      const R = vt / i;
      return { reading: R > 2e7 ? 'OL' : +R.toPrecision(4) };
    },
    render(p, v) {
      const m = p.props.mode || 'V';
      const ang = (DIAL.find((d) => d.k === m) || DIAL[0]).a;
      const reading = v && 'reading' in v ? fmtMeter(m, v.reading) : '- - - -';
      const ac = m === 'V~' || m === 'A~';
      return `<rect x="-28" y="-148" width="96" height="150" rx="10" fill="#f2b705" stroke="#8a6a00"/>
        <rect x="-20" y="-140" width="80" height="138" rx="6" fill="#2b2f36"/>
        <rect x="-14" y="-133" width="68" height="28" rx="3" fill="#b9c7a3" stroke="#5f6b50"/>
        <text x="50" y="-113" font-size="12.5" text-anchor="end" fill="#1d2416" font-family="monospace" font-weight="700">${WB.esc(reading)}</text>
        <text x="-10" y="-125" font-size="6" fill="#3a4430" font-family="sans-serif">${m === 'Ω' ? '' : ac ? 'AC rms' : 'DC'}</text>
        <circle cx="20" cy="-67" r="20" fill="#1b1d21" stroke="#555" style="cursor:pointer"/>
        <g transform="rotate(${ang} 20 -67)" style="cursor:pointer"><rect x="17.5" y="-85" width="5" height="18" rx="2" fill="#e8e8e8"/></g>
        ${DIAL.map(({ k, x, y }) => {
          const on = m === k;
          return `<g style="cursor:pointer"><rect x="${(x - 7.5).toFixed(1)}" y="${(y - 6.5).toFixed(1)}" width="15" height="12" rx="3" fill="${on ? '#4a3d10' : '#23262c'}" stroke="${on ? '#ffd23f' : '#4a4f58'}" stroke-width=".8"/>
            <text x="${x.toFixed(1)}" y="${(y + 2.8).toFixed(1)}" font-size="${k.length > 1 ? 7 : 8.5}" text-anchor="middle" fill="${on ? '#ffd23f' : '#c8ccd2'}" font-family="sans-serif" font-weight="700">${k}</text></g>`;
        }).join('')}
        <text x="20" y="-40" font-size="5.5" text-anchor="middle" fill="#888" font-family="sans-serif">click a mode to select it</text>
        <circle cx="0" cy="-14" r="6" fill="#111" stroke="#d62828" stroke-width="2"/><circle cx="20" cy="-14" r="6" fill="#111" stroke="#777" stroke-width="2"/><circle cx="40" cy="-14" r="6" fill="#111" stroke="#d62828" stroke-width="2"/>
        <text x="0" y="-24" font-size="6" text-anchor="middle" fill="#ddd" font-family="sans-serif">A</text>
        <text x="20" y="-24" font-size="6" text-anchor="middle" fill="#ddd" font-family="sans-serif">COM</text>
        <text x="40" y="-24" font-size="6" text-anchor="middle" fill="#ddd" font-family="sans-serif">VΩ</text>
        <path d="M0,-8 V0" stroke="#d62828" stroke-width="2"/><path d="M20,-8 V0" stroke="#222" stroke-width="2"/><path d="M40,-8 V0" stroke="#d62828" stroke-width="2"/>`;
    },
  });

  // ---------------------------------------------------------------- Compact panel meters
  // Small 2-pin digital panel meters that plug into the breadboard (pins 0.1" apart):
  // Voltmeter = 10 MΩ across its + / − pins (connect in parallel),
  // Ammeter = 50 mΩ shunt between + and − (connect in series; current flows in at +).
  // Click the DC / AC badge (or use the Inspector) to switch; AC = true-RMS of the AC part.
  const PANEL_MODES = [['DC', 'DC'], ['AC', 'AC (true RMS)']];
  function panelMeter(kind) {
    const volt = kind === 'V';
    const unitMode = (p) => (volt ? 'V' : 'A') + (p.props.mode === 'AC' ? '~' : '');
    return {
      label: volt ? 'Voltmeter (compact)' : 'Ammeter (compact)',
      category: 'Instruments', prefix: volt ? 'VM' : 'AM', dynamic: true, interact: 'panel',
      hit: (lx, ly) => (lx >= 7 && lx <= 23 && ly >= -15 && ly <= -6 ? 'mode' : null),
      panelAction(p) { p.props.mode = p.props.mode === 'AC' ? 'DC' : 'AC'; },
      defaults: { mode: 'DC' },
      pins: () => [
        { id: '+', label: volt ? '+ (red): the point to measure' : '+ (red): current flows in here', x: 0, y: 0, kind: 'pwr' },
        { id: '-', label: volt ? '− (black): the reference, usually GND' : '− (black): current flows out here', x: 10, y: 0, kind: 'gnd' },
      ],
      bbox: () => [-15, -36, 40, 40],
      summary: (p) => `${volt ? 'Voltmeter' : 'Ammeter'}, ${p.props.mode === 'AC' ? 'AC rms' : 'DC'}`,
      inspector: [{ key: 'mode', label: 'Measure', type: 'select', options: PANEL_MODES, live: true }],
      elements(c) {
        return [{ t: 'R', a: c.n('+'), b: c.n('-'), r: volt ? 1e7 : 0.05, tag: 'meter' }];
      },
      visualize(c) {
        const e = c.els[0];
        if (!e) return { reading: null };
        const ac = c.props.mode === 'AC', s = c.state;
        if (s.mode !== c.props.mode) { s.mode = c.props.mode; s.ai = e.i; s.ai2 = e.i2 || 0; }
        else { s.ai += 0.15 * (e.i - s.ai); s.ai2 += 0.15 * ((e.i2 || 0) - s.ai2); }
        if (ac) {
          const rms = Math.sqrt(Math.max(0, s.ai2 - s.ai * s.ai));
          return { reading: volt ? +(rms * 1e7).toFixed(4) : +rms.toPrecision(4) };
        }
        return { reading: volt ? +(c.V('+') - c.V('-')).toFixed(4) : +e.i.toPrecision(4) };
      },
      render(p, v) {
        const ac = p.props.mode === 'AC';
        const reading = v && v.reading !== null && v.reading !== undefined ? fmtMeter(unitMode(p), v.reading) : '- - -';
        const digit = volt ? '#ff4b3e' : '#4fc3ff';
        return `<rect x="-14" y="-35" width="38" height="31" rx="3" fill="#1d2027" stroke="#05070a"/>
          <rect x="-11" y="-32" width="32" height="14" rx="1.5" fill="#0a0c10" stroke="#3a3f48" stroke-width=".6"/>
          <text x="19" y="-22" font-size="${reading.length > 8 ? 6 : 7}" text-anchor="end" fill="${digit}" font-family="monospace" font-weight="700">${WB.esc(reading)}</text>
          <text x="-10" y="-8" font-size="7.5" fill="#e8e8e8" font-family="sans-serif" font-weight="700">${volt ? 'V' : 'A'}</text>
          <g style="cursor:pointer"><rect x="7" y="-15" width="16" height="9" rx="2" fill="${ac ? '#3b2f0a' : '#23262c'}" stroke="${ac ? '#ffd23f' : '#5a606b'}" stroke-width=".7"/>
          <text x="15" y="-8.6" font-size="5.8" text-anchor="middle" fill="${ac ? '#ffd23f' : '#c8ccd2'}" font-family="sans-serif" font-weight="700">${ac ? 'AC' : 'DC'}</text></g>
          <text x="-1" y="-8" font-size="6" fill="#ff6b5e" font-family="sans-serif" font-weight="700">+</text>
          <path d="M0,-4 V0" stroke="#d62828" stroke-width="1.6"/><path d="M10,-4 V0" stroke="#222" stroke-width="1.6"/>`;
      },
    };
  }
  WB.defPart('voltmeter', panelMeter('V'));
  WB.defPart('ammeter', panelMeter('A'));

  // ---------------------------------------------------------------- Oscilloscope (2 channels)
  // Inputs CH1, CH2 (1 MΩ to GND). The app samples the channel voltages while simulating;
  // PWM is drawn as a square wave from the solver's phase voltages. Front panel (clickable):
  // time base, per-channel volts/div, DC/AC coupling and position, and AUTO (autoset).
  const SCOPE = { x0: -110, y0: -230, w: 250, h: 160, divX: 10, divY: 8 };
  const TDIV = [[0.01, '10 µs/div'], [0.02, '20 µs/div'], [0.05, '50 µs/div'], [0.1, '100 µs/div'], [0.2, '200 µs/div'], [0.5, '500 µs/div'],
    [1, '1 ms/div'], [2, '2 ms/div'], [5, '5 ms/div'], [10, '10 ms/div'], [20, '20 ms/div'], [50, '50 ms/div'], [100, '100 ms/div'], [200, '200 ms/div'], [500, '500 ms/div'], [1000, '1 s/div']];
  const VDIV = [[0.01, '10 mV/div'], [0.02, '20 mV/div'], [0.05, '50 mV/div'], [0.1, '0.1 V/div'], [0.2, '0.2 V/div'], [0.5, '0.5 V/div'],
    [1, '1 V/div'], [2, '2 V/div'], [5, '5 V/div'], [10, '10 V/div'], [20, '20 V/div']];
  const COUPLING = [['DC', 'DC — shows the whole signal'], ['AC', 'AC — removes the DC part']];
  const POS = [4, 3, 2, 1, 0, -1, -2, -3, -4].map((v) => [v, v === 0 ? 'centre' : (v > 0 ? '+' : '') + v + ' div']);
  WB.SCOPE_DIVX = SCOPE.divX;
  const scopeAuto = new Map(); // part id -> pending AUTO measurement
  WB.scopeAuto = scopeAuto;
  const optLabel = (list, v) => (list.find((o) => o[0] === +v) || [0, '?'])[1];
  // Three significant digits for small readings: 850 µV, 8.69 mV, 17.4 mV, 512 mV, 5.00 V.
  const fmtV = (v) => {
    const a = Math.abs(v);
    if (a < 0.5e-6) return '0 mV';
    if (a < 0.9995e-3) return (v * 1e6).toFixed(0) + ' µV';
    if (a < 0.009995) return (v * 1e3).toFixed(2) + ' mV';
    if (a < 0.09995) return (v * 1e3).toFixed(1) + ' mV';
    if (a < 0.9995) return (v * 1e3).toFixed(0) + ' mV';
    return v.toFixed(2) + ' V';
  };
  // Does a channel really swing (vs. solver round-off on a steady level)? At least 1 µV and
  // 0.01 % of the level, so a 10 mV ripple on 5 V counts but 1e-12 V of jitter does not.
  const swings = (lo, hi) => hi - lo > Math.max(1e-6, 1e-4 * Math.max(Math.abs(lo), Math.abs(hi)));
  // Per-channel settings; pos = where 0 V sits, in divisions above the screen centre.
  const chCfg = (p, n) => ({
    vdiv: +(n === 1 ? p.props.vdiv : p.props.vdiv2) || 1,
    ac: (n === 1 ? p.props.cpl1 : p.props.cpl2) === 'AC',
    pos: WB.clamp(Math.round(Number(n === 1 ? p.props.pos1 : p.props.pos2) || 0), -4, 4),
    inv: !!(n === 1 ? p.props.inv1 : p.props.inv2),
  });
  // Channels set to INV are shown upside down (the samples are negated before drawing).
  function invertData(p, data) {
    const i1 = !!p.props.inv1, i2 = !!p.props.inv2;
    if (!i1 && !i2) return data;
    const nv = (v) => (v === null || v === undefined ? v : -v);
    const nw = (w) => (w ? { hi: -w.lo, lo: -w.hi, duty: 1 - w.duty, periodMs: w.periodMs } : w);
    return data.map((s) => Object.assign({}, s, i1 ? { v1: nv(s.v1), w1: nw(s.w1) } : {}, i2 ? { v2: nv(s.v2), w2: nw(s.w2) } : {}));
  }
  // X-Y mode: CH1 moves the dot sideways, CH2 up and down (the time base sets how much history is drawn).
  function xyTrace(samples, from, c1, c2) {
    const { x0, y0, w, h, divX, divY } = SCOPE, dx = w / divX, dy = h / divY;
    const xc = x0 + w / 2 + c1.pos * dx, yc = y0 + h / 2 - c2.pos * dy;
    const pts = samples.filter((s) => s.t >= from && s.v1 !== null && s.v1 !== undefined && s.v2 !== null && s.v2 !== undefined);
    const stride = Math.max(1, Math.floor(pts.length / 1500));
    let d = '';
    for (let i = 0; i < pts.length; i += stride) {
      const s = pts[i];
      const x = WB.clamp(xc + (s.v1 / c1.vdiv) * dx, x0, x0 + w), y = WB.clamp(yc - (s.v2 / c2.vdiv) * dy, y0, y0 + h);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    if (pts.length === 1) d += 'h0.1';
    return d;
  }
  // Voltage -> screen y for a channel (off = DC level removed by AC coupling).
  function yMap(c, off) {
    const { y0, h, divY } = SCOPE, dy = h / divY, zero = y0 + h / 2 - c.pos * dy;
    return (v) => WB.clamp(zero - ((v - off) / c.vdiv) * dy, y0, y0 + h);
  }
  // Time-domain samples ({t, v1, v2, lin}): latest rising crossings of the mid level (with hysteresis).
  function risingEdges(samples, key, from, to) {
    let lo = Infinity, hi = -Infinity;
    for (const s of samples) if (s.t >= from && s.t <= to && s[key] !== null) { lo = Math.min(lo, s[key]); hi = Math.max(hi, s[key]); }
    if (!swings(lo, hi)) return { edges: [], lo, hi };
    const mid = (hi + lo) / 2, hyst = (hi - lo) * 0.1;
    const edges = [];
    let armed = false, prev = null;
    for (const s of samples) {
      if (s.t < from || s.t > to || s[key] === null) continue;
      const v = s[key];
      if (v < mid - hyst) armed = true;
      if (armed && prev && prev[key] < mid && v >= mid) {
        edges.push(prev.t + ((mid - prev[key]) / (v - prev[key] || 1)) * (s.t - prev.t));
        armed = false;
      }
      prev = s;
    }
    return { edges, lo, hi };
  }
  // Average, AC rms, min/max and frequency of a channel; averages over whole periods when periodic.
  function chanStats(data, k, from, to) {
    const r = risingEdges(data, k, from, to);
    const per = r.edges.length >= 2;
    const a = per ? r.edges[0] : from, b = per ? r.edges[r.edges.length - 1] : to;
    let s1 = 0, s2 = 0, n = 0;
    for (const s of data) if (s.t >= a && s.t <= b && s[k] !== null) { s1 += s[k]; s2 += s[k] * s[k]; n++; }
    const last = data[data.length - 1][k];
    const avg = n ? s1 / n : last;
    return {
      avg, rms: n ? Math.sqrt(Math.max(0, s2 / n - avg * avg)) : 0,
      lo: Number.isFinite(r.lo) ? r.lo : last, hi: Number.isFinite(r.hi) ? r.hi : last,
      freq: per ? (1000 * (r.edges.length - 1)) / (b - a) : 0,
    };
  }
  function linTrace(samples, key, t0, W, Y) {
    const { x0, w } = SCOPE;
    let d = '', pen = false, n = 0;
    const inWin = samples.filter((s) => s.t >= t0 - W * 0.01 && s.t <= t0 + W * 1.01);
    const stride = Math.max(1, Math.floor(inWin.length / 1200));
    for (let i = 0; i < inWin.length; i += stride) {
      const s = inWin[i];
      if (s[key] === null) { pen = false; continue; }
      const x = x0 + WB.clamp((s.t - t0) / W, 0, 1) * w;
      d += (pen ? 'L' : 'M') + x.toFixed(1) + ',' + Y(s[key]).toFixed(1);
      pen = true; n++;
    }
    return n > 1 ? d : '';
  }
  function scopeTrace(samples, key, wkey, now, W, Ymap) {
    const { x0, w } = SCOPE;
    const t0 = now - W;
    const X = (t) => (x0 + ((t - t0) / W) * w).toFixed(1);
    const Y = (v) => Ymap(v).toFixed(1);
    let d = '', pen = false;
    const pt = (t, v) => { d += (pen ? 'L' : 'M') + X(t) + ',' + Y(v); pen = true; };
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i], nx = samples[i + 1];
      const a = Math.max(s.t, t0), b = nx ? Math.min(nx.t, now) : now;
      if (b <= t0 || b <= a) continue;
      if (s[key] === null) { pen = false; continue; }
      const wv = s[wkey];
      if (wv && W / wv.periodMs <= 80) {
        const P = wv.periodMs, D = wv.duty * P;
        let t = a, level = ((t % P) + P) % P < D ? wv.hi : wv.lo;
        pt(t, level);
        for (let guard = 0; guard < 2000 && t < b; guard++) {
          const ph = ((t % P) + P) % P;
          const edge = ph < D ? t - ph + D : t - ph + P;
          const te = Math.min(edge <= t ? t + P : edge, b);
          pt(te, level);
          if (te >= b) break;
          level = level === wv.hi ? wv.lo : wv.hi;
          pt(te, level);
          t = te;
        }
      } else { pt(a, s[key]); pt(b, s[key]); }
    }
    return d;
  }
  // AUTO: volts/div and position so the signal fills about 6 of the 8 divisions.
  function pickVdiv(lo, hi) {
    const span = hi - lo, c = (hi + lo) / 2;
    if (!swings(lo, hi) || span < 0.002 * Math.abs(c)) { // (nearly) steady DC: ripple too small to show around its level
      if (Math.abs(c) < 0.005) return { vdiv: 1, pos: 0 };
      const d = VDIV.find(([v]) => Math.abs(c) <= 5 * v) || VDIV[VDIV.length - 1];
      return { vdiv: d[0], pos: c >= 0 ? -2 : 2 };
    }
    for (const [v] of VDIV) {
      if (span / v > 6) continue;
      const pos = WB.clamp(Math.round(-c / v), -4, 4);
      if (Math.abs(c / v + pos) + span / (2 * v) <= 4) return { vdiv: v, pos };
    }
    return { vdiv: VDIV[VDIV.length - 1][0], pos: 0 };
  }
  // Runs each frame while AUTO is pending; returns true once the settings were chosen.
  function autoStep(p, data, app) {
    const st = scopeAuto.get(p.id);
    st.frames++;
    const last = data[data.length - 1];
    const has = (k) => last[k] !== null && last[k] !== undefined;
    const stats = {};
    let P = 0; // period in ms
    if (last.lin) {
      const key = has('v1') ? 'v1' : 'v2';
      const t0 = data[0].t, t1 = last.t;
      const r = risingEdges(data, key, t0, t1);
      if (r.edges.length >= 4) P = (r.edges[r.edges.length - 1] - r.edges[0]) / (r.edges.length - 1);
      else {
        const flat = !swings(r.lo, r.hi);
        if (!((flat && data.length > 100) || data.length >= 5900 || st.frames > 400)) return false; // keep measuring
      }
      const from = P ? t1 - Math.min(t1 - t0, 4 * P) : t0;
      for (const n of [1, 2]) if (has('v' + n)) stats[n] = chanStats(data, 'v' + n, from, t1);
    } else {
      const wv = last.w1 || last.w2;
      if (wv) P = wv.periodMs;
      for (const n of [1, 2]) {
        const k = 'v' + n, w = last['w' + n];
        if (!has(k)) continue;
        if (w) { stats[n] = { avg: last[k], lo: w.lo, hi: w.hi }; continue; }
        let lo = Infinity, hi = -Infinity, s = 0, c = 0;
        for (const x of data) if (x.t > last.t - 1000 && x[k] !== null) { lo = Math.min(lo, x[k]); hi = Math.max(hi, x[k]); s += x[k]; c++; }
        stats[n] = { avg: s / c, lo, hi };
      }
    }
    scopeAuto.delete(p.id);
    if (P > 0) p.props.tdiv = (TDIV.find(([t]) => t * SCOPE.divX >= 2.5 * P) || TDIV[TDIV.length - 1])[0];
    const parts = [optLabel(TDIV, p.props.tdiv)];
    for (const n of [1, 2]) {
      const s = stats[n];
      if (!s) continue;
      const c = chCfg(p, n), off = c.ac ? s.avg : 0;
      const { vdiv, pos } = pickVdiv(s.lo - off, s.hi - off);
      p.props[n === 1 ? 'vdiv' : 'vdiv2'] = vdiv;
      p.props['pos' + n] = pos;
      parts.push(`CH${n} ${optLabel(VDIV, vdiv)}`);
    }
    app.editor.rerenderBody(p);
    app.refreshInspector();
    app.refreshPropDialog();
    app.saveLocalSoon();
    app.toast(`${p.name} AUTO: ${parts.join(', ')}` + (P > 0 || !Object.keys(stats).length ? '' : ' (no repeating signal found)'));
    return true;
  }
  // Front-panel controls (part coordinates), to the right of the screen.
  const PX = 152, PW = 66;
  const SBTN = [];
  const pmRow = (y, minus, plus, t) => SBTN.push({ a: minus, x: PX, y, w: 16, h: 13, t: t ? t[0] : '−' }, { a: plus, x: PX + PW - 16, y, w: 16, h: 13, t: t ? t[1] : '+' });
  pmRow(-219, 'tdiv-', 'tdiv+');
  for (const [n, y] of [[1, -201], [2, -149]]) {
    SBTN.push({ a: 'cpl' + n, x: PX + PW - 26, y, w: 26, h: 12, cpl: n });
    SBTN.push({ a: 'inv' + n, x: PX + 18, y, w: 19, h: 12, inv: n });
    pmRow(y + 16, 'v' + n + '-', 'v' + n + '+');
    pmRow(y + 33, 'p' + n + '-', 'p' + n + '+', ['▼', '▲']);
  }
  SBTN.push({ a: 'auto', x: PX, y: -96, w: 40, h: 18, t: 'AUTO' });
  SBTN.push({ a: 'xy', x: PX + 43, y: -96, w: PW - 43, h: 18, xy: true });
  const stepOpt = (list, v, d) => {
    const i = list.findIndex((o) => o[0] === +v);
    return list[WB.clamp((i < 0 ? 0 : i) + d, 0, list.length - 1)][0];
  };
  WB.defPart('scope', {
    label: 'Oscilloscope', category: 'Instruments', prefix: 'OSC', dynamic: true, interact: 'panel',
    groundPins: ['GND'], // the probe ground is earthed, as on a real scope
    defaults: { tdiv: 20, vdiv: 1, vdiv2: 1, cpl1: 'DC', cpl2: 'DC', pos1: 0, pos2: 0 },
    pins: () => [
      { id: 'CH1', label: 'CH1 input (yellow trace)', x: 0, y: 0 },
      { id: 'CH2', label: 'CH2 input (cyan trace)', x: 20, y: 0 },
      { id: 'GND', label: 'Ground (connect to circuit GND)', x: 40, y: 0, kind: 'gnd' },
    ],
    bbox: () => [-122, -242, 349, 246],
    summary: (p) => `${optLabel(TDIV, p.props.tdiv)}, CH1 ${optLabel(VDIV, p.props.vdiv)} ${p.props.cpl1 || 'DC'}, CH2 ${optLabel(VDIV, p.props.vdiv2)} ${p.props.cpl2 || 'DC'}`,
    inspector: [
      { key: 'tdiv', label: 'Time base', type: 'select', options: TDIV, live: true },
      { key: 'vdiv', label: 'CH1 volts/div', type: 'select', options: VDIV, live: true },
      { key: 'cpl1', label: 'CH1 coupling', type: 'select', options: COUPLING, live: true },
      { key: 'pos1', label: 'CH1 position (0 V level)', type: 'select', options: POS, live: true },
      { key: 'vdiv2', label: 'CH2 volts/div', type: 'select', options: VDIV, live: true },
      { key: 'cpl2', label: 'CH2 coupling', type: 'select', options: COUPLING, live: true },
      { key: 'pos2', label: 'CH2 position (0 V level)', type: 'select', options: POS, live: true },
      { key: 'inv1', label: 'CH1 invert', type: 'select', options: [[false, 'Normal'], [true, 'Inverted (INV)']], live: true },
      { key: 'inv2', label: 'CH2 invert', type: 'select', options: [[false, 'Normal'], [true, 'Inverted (INV)']], live: true },
      { key: 'xy', label: 'Display', type: 'select', options: [[false, 'Y-T (voltage against time)'], [true, 'X-Y (CH1 sideways, CH2 up/down)']], live: true },
    ],
    elements: (c) => [{ t: 'R', a: c.n('CH1'), b: c.n('GND'), r: 1e6 }, { t: 'R', a: c.n('CH2'), b: c.n('GND'), r: 1e6 }],
    hit: (lx, ly) => {
      const b = SBTN.find((q) => lx >= q.x - 1 && lx <= q.x + q.w + 1 && ly >= q.y - 1 && ly <= q.y + q.h + 1);
      return b ? b.a : null;
    },
    panelAction(p, act, app) {
      const pr = p.props;
      if (act === 'tdiv-' || act === 'tdiv+') pr.tdiv = stepOpt(TDIV, pr.tdiv, act.endsWith('+') ? 1 : -1);
      else if (/^v[12][-+]$/.test(act)) { const k = act[1] === '1' ? 'vdiv' : 'vdiv2'; pr[k] = stepOpt(VDIV, pr[k], act.endsWith('+') ? 1 : -1); }
      else if (/^p[12][-+]$/.test(act)) { const k = 'pos' + act[1]; pr[k] = WB.clamp(Math.round(Number(pr[k]) || 0) + (act.endsWith('+') ? 1 : -1), -4, 4); }
      else if (act === 'cpl1' || act === 'cpl2') { const k = act; pr[k] = pr[k] === 'AC' ? 'DC' : 'AC'; }
      else if (act === 'inv1' || act === 'inv2') pr[act] = !pr[act];
      else if (act === 'xy') pr.xy = !pr.xy;
      else if (act === 'auto') {
        if (!app.sim) { app.toast('Start the simulation first — AUTO measures the signals to choose the settings.'); return; }
        const buf = app.sim.scope && app.sim.scope[p.id];
        if (buf && buf.length && buf[buf.length - 1].lin) buf.length = 0; // re-measure at full resolution
        scopeAuto.set(p.id, { frames: 0 });
      }
    },
    render(p) {
      const { x0, y0, w, h, divX, divY } = SCOPE;
      const dx = w / divX, dy = h / divY;
      let grid = '';
      for (let i = 1; i < divX; i++) grid += `<line x1="${x0 + i * dx}" y1="${y0}" x2="${x0 + i * dx}" y2="${y0 + h}"/>`;
      for (let j = 1; j < divY; j++) grid += `<line x1="${x0}" y1="${y0 + j * dy}" x2="${x0 + w}" y2="${y0 + j * dy}"/>`;
      // minor ticks on the centre axes
      let ticks = '';
      for (let i = 0; i < divX * 5; i++) { const x = x0 + (i * dx) / 5; ticks += `<line x1="${x}" y1="${y0 + h / 2 - 1.5}" x2="${x}" y2="${y0 + h / 2 + 1.5}"/>`; }
      for (let j = 0; j < divY * 5; j++) { const y = y0 + (j * dy) / 5; ticks += `<line x1="${x0 + w / 2 - 1.5}" y1="${y}" x2="${x0 + w / 2 + 1.5}" y2="${y}"/>`; }
      const c1 = chCfg(p, 1), c2 = chCfg(p, 2);
      const z1 = y0 + h / 2 - c1.pos * dy, z2 = y0 + h / 2 - c2.pos * dy;
      const short = (s) => s.replace('/div', '');
      const td = optLabel(TDIV, p.props.tdiv), v1 = optLabel(VDIV, p.props.vdiv), v2 = optLabel(VDIV, p.props.vdiv2);
      const val = { 'tdiv-': short(td), 'v1-': short(v1), 'v2-': short(v2), 'p1-': 'POS', 'p2-': 'POS' };
      const btns = SBTN.map((b) => {
        if (b.inv || b.xy) {
          const on = b.xy ? !!p.props.xy : (b.inv === 1 ? c1 : c2).inv;
          return `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.xy ? 4 : 2.5}" fill="${on ? '#5a2d6e' : '#232831'}" stroke="${on ? '#d79bff' : '#6a7486'}" stroke-width=".8"/>
            <text x="${b.x + b.w / 2}" y="${b.y + (b.xy ? 12 : 8.6)}" font-size="${b.xy ? 7 : 5.8}" text-anchor="middle" fill="${on ? '#f0d9ff' : '#cfd5df'}" font-family="sans-serif" font-weight="700">${b.xy ? 'X-Y' : 'INV'}</text></g>`;
        }
        if (b.cpl) {
          const ac = (b.cpl === 1 ? c1 : c2).ac;
          return `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2.5" fill="${ac ? '#4a3a1c' : '#203a28'}" stroke="${ac ? '#ffb347' : '#5fc77a'}" stroke-width=".8"/>
            <text x="${b.x + b.w / 2}" y="${b.y + 8.6}" font-size="6.5" text-anchor="middle" fill="${ac ? '#ffc46b' : '#9fe0a8'}" font-family="sans-serif" font-weight="700">${ac ? 'AC' : 'DC'}</text></g>`;
        }
        const auto = b.a === 'auto';
        let s = `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${auto ? 4 : 2.5}" fill="${auto ? '#2d5fa8' : '#232831'}" stroke="${auto ? '#7fb0ff' : '#6a7486'}" stroke-width=".8"/>
          <text x="${b.x + b.w / 2}" y="${b.y + (auto ? 12.3 : 9.6)}" font-size="${auto ? 8 : 8}" text-anchor="middle" fill="#eef1f6" font-family="sans-serif" font-weight="700">${b.t}</text></g>`;
        if (val[b.a]) s += `<text x="${PX + PW / 2}" y="${b.y + 9.2}" font-size="${val[b.a] === 'POS' ? 5.5 : 6.5}" text-anchor="middle" fill="${val[b.a] === 'POS' ? '#aab3c2' : '#ffffff'}" font-family="monospace">${val[b.a]}</text>`;
        return s;
      }).join('');
      const head = (y, txt, col) => `<text x="${PX}" y="${y}" font-size="6.5" fill="${col}" font-family="sans-serif" font-weight="700">${txt}</text>`;
      return `<rect x="-120" y="-240" width="345" height="242" rx="9" fill="#3b4250" stroke="#1d2129"/>
        <rect x="${PX - 6}" y="-234" width="${PW + 12}" height="168" rx="5" fill="#333946" stroke="#2a2f3a"/>
        <rect x="${x0 - 5}" y="${y0 - 5}" width="${w + 10}" height="${h + 10}" rx="4" fill="#0b0f0c"/>
        <g stroke="#1f3a2a" stroke-width=".6">${grid}</g>
        <g stroke="#2e5a40" stroke-width=".6">${ticks}</g>
        <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="#2e5a40" stroke-width=".8"/>
        ${p.props.xy ? (() => { const xz = x0 + w / 2 + c1.pos * dx; return `<path d="M${xz},${y0} l-3.5,-5 h7 z" fill="#ffd23f"/><text x="${xz + 5}" y="${y0 - 1}" font-size="5.5" fill="#ffd23f" font-family="sans-serif" font-weight="700">1</text>`; })()
          : `<path d="M${x0 - 5},${z1} l5,-3.5 v7 z" fill="#ffd23f"/><text x="${x0 - 9}" y="${z1 + 2}" font-size="5.5" text-anchor="end" fill="#ffd23f" font-family="sans-serif" font-weight="700">1</text>`}
        <path d="M${x0 + w + 5},${z2} l-5,-3.5 v7 z" fill="#3fd0ff"/><text x="${x0 + w + 8}" y="${z2 + 2}" font-size="5.5" fill="#3fd0ff" font-family="sans-serif" font-weight="700">2</text>
        <path class="tr2" d="" fill="none" stroke="#3fd0ff" stroke-width="1.4" stroke-linejoin="round"/>
        <path class="tr1" d="" fill="none" stroke="#ffd23f" stroke-width="1.4" stroke-linejoin="round"/>
        <text class="scope-msg" x="${x0 + w / 2}" y="${y0 + h / 2 - 6}" font-size="8" text-anchor="middle" fill="#4f8a65" font-family="sans-serif">Start the simulation to see signals</text>
        <text class="scope-speed" x="${x0 + w - 3}" y="${y0 + 9}" font-size="6" text-anchor="end" fill="#7fbf95" font-family="monospace"></text>
        <text x="${x0}" y="${y0 + h + 13}" font-size="7" fill="#d8dde6" font-family="monospace">${p.props.xy ? 'X-Y' : td}  <tspan fill="#ffd23f">${p.props.xy ? 'X=' : ''}CH1 ${v1} ${c1.ac ? 'AC' : 'DC'}${c1.inv ? ' INV' : ''}</tspan>  <tspan fill="#3fd0ff">${p.props.xy ? 'Y=' : ''}CH2 ${v2} ${c2.ac ? 'AC' : 'DC'}${c2.inv ? ' INV' : ''}</tspan></text>
        <text class="ro1" x="${x0}" y="${y0 + h + 24}" font-size="7" fill="#ffd23f" font-family="monospace">CH1 —</text>
        <text class="ro2" x="${x0}" y="${y0 + h + 35}" font-size="7" fill="#3fd0ff" font-family="monospace">CH2 —</text>
        <text x="${PX + PW / 2}" y="-223" font-size="5.5" text-anchor="middle" fill="#cfd5df" font-family="sans-serif" font-weight="700">TIME / DIV</text>
        ${head(-192, 'CH1', '#ffd23f')}${head(-140, 'CH2', '#3fd0ff')}
        ${btns}
        <text x="${PX + PW}" y="-60" font-size="7" text-anchor="end" fill="#9aa5b6" font-family="sans-serif" font-weight="700">SCOPE</text>
        <text x="${PX + PW}" y="-51" font-size="5" text-anchor="end" fill="#7d8798" font-family="sans-serif">click the buttons</text>
        <circle cx="0" cy="-13" r="5.5" fill="#111" stroke="#ffd23f" stroke-width="2"/><circle cx="20" cy="-13" r="5.5" fill="#111" stroke="#3fd0ff" stroke-width="2"/><circle cx="40" cy="-13" r="5.5" fill="#111" stroke="#888" stroke-width="2"/>
        <circle cx="0" cy="-13" r="1.6" fill="#555"/><circle cx="20" cy="-13" r="1.6" fill="#555"/><circle cx="40" cy="-13" r="1.6" fill="#555"/>
        <text x="0" y="-22.5" font-size="5.5" text-anchor="middle" fill="#ffd23f" font-family="sans-serif" font-weight="700">CH1</text><text x="20" y="-22.5" font-size="5.5" text-anchor="middle" fill="#3fd0ff" font-family="sans-serif" font-weight="700">CH2</text><text x="40" y="-22.5" font-size="5.5" text-anchor="middle" fill="#ddd" font-family="sans-serif" font-weight="700">⏚ GND</text>
        <path d="M0,-7.5 V0" stroke="#ffd23f" stroke-width="2"/><path d="M20,-7.5 V0" stroke="#3fd0ff" stroke-width="2"/><path d="M40,-7.5 V0" stroke="#222" stroke-width="2"/>`;
    },
    // Called every frame while simulating: redraw the traces from captured samples.
    liveUpdate(p, g, app) {
      const raw = app.sim && app.sim.scope && app.sim.scope[p.id];
      const msg = g.querySelector('.scope-msg');
      const st = g.querySelector('.scope-speed');
      if (!raw || !raw.length) return;
      const data = invertData(p, raw);
      if (scopeAuto.has(p.id) && autoStep(p, data, app)) return;
      if (msg) msg.textContent = '';
      const W = (+p.props.tdiv || 20) * SCOPE.divX;
      if (p.props.xy) {
        const c1 = chCfg(p, 1), c2 = chCfg(p, 2), last = data[data.length - 1];
        const from = last.t - W;
        const offs = {};
        for (const n of [1, 2]) { const c = n === 1 ? c1 : c2; offs[n] = c.ac ? chanStats(data, 'v' + n, from, last.t).avg : 0; }
        const shifted = offs[1] || offs[2] ? data.map((s) => Object.assign({}, s, { v1: s.v1 == null ? s.v1 : s.v1 - offs[1], v2: s.v2 == null ? s.v2 : s.v2 - offs[2] })) : data;
        g.querySelector('.tr2').setAttribute('d', '');
        g.querySelector('.tr1').setAttribute('d', xyTrace(shifted, from, c1, c2));
        const ok1 = last.v1 !== null && last.v1 !== undefined, ok2 = last.v2 !== null && last.v2 !== undefined;
        const rng = (k) => { let lo = Infinity, hi = -Infinity; for (const s of data) if (s.t >= from && s[k] != null) { lo = Math.min(lo, s[k]); hi = Math.max(hi, s[k]); } return Number.isFinite(lo) ? `${fmtV(lo)} … ${fmtV(hi)}` : '—'; };
        g.querySelector('.ro1').textContent = ok1 ? `X (CH1) ${rng('v1')}` : 'X: CH1 not connected';
        g.querySelector('.ro2').textContent = ok2 ? `Y (CH2) ${rng('v2')}` : 'Y: CH2 not connected';
        if (st) st.textContent = 'X-Y';
        return;
      }
      const cfg = { 1: chCfg(p, 1), 2: chCfg(p, 2) };
      const last = data[data.length - 1];
      const autoTxt = scopeAuto.has(p.id) ? 'AUTO… ' : '';
      if (last.lin) {
        // Time-domain samples: trigger on a rising edge of CH1 (else CH2) and put it at the screen centre.
        const now = last.t;
        const key = last.v1 !== null ? 'v1' : 'v2';
        const trig = risingEdges(data, key, now - 2 * W, now);
        const usable = trig.edges.filter((t) => t <= now - W / 2 && t >= now - 1.5 * W);
        const t0 = usable.length ? usable[usable.length - 1] - W / 2 : now - W;
        const from = now - Math.max(W, 1) - W;
        for (const n of [1, 2]) {
          const k = 'v' + n, c = cfg[n];
          const tr = g.querySelector('.tr' + n), ro = g.querySelector('.ro' + n);
          if (last[k] === null || last[k] === undefined) { tr.setAttribute('d', ''); ro.textContent = `CH${n} not connected`; continue; }
          const s = chanStats(data, k, from, now);
          tr.setAttribute('d', linTrace(data, k, t0, W, yMap(c, c.ac ? s.avg : 0)));
          const sw = swings(s.lo, s.hi);
          // an AC signal's average is ~0 up to round-off; don't print that as "3 µV avg"
          const avg = sw && Math.abs(s.avg) < 1e-3 * (s.hi - s.lo) ? 0 : s.avg;
          let txt = `CH${n} ${c.ac ? 'AC' : 'DC'}  ` + (c.ac ? fmtV(s.rms) + 'rms' : fmtV(avg) + ' avg');
          if (sw) txt += `  ${fmtV(s.hi - s.lo)}pp`;
          if (s.freq) txt += `  ${WB.fmtHz(s.freq)}`;
          if (c.ac) txt += `  (DC ${fmtV(avg)})`;
          ro.textContent = txt;
        }
        const sp = app.results && app.results.analog ? app.results.analog.speed : 1;
        if (st) st.textContent = autoTxt + (usable.length ? 'TRIG ' : 'ROLL ') + (sp < 0.95 ? `slow-mo ${Math.max(1, Math.round(sp * 100))}%` : '');
        return;
      }
      // One sample per frame (DC / PWM circuits without capacitors).
      const now = performance.now() - app.sim.t0;
      for (const n of [1, 2]) {
        const k = 'v' + n, wk = 'w' + n, c = cfg[n], v = last[k], wv = last[wk];
        const tr = g.querySelector('.tr' + n), ro = g.querySelector('.ro' + n);
        if (v === null || v === undefined) { tr.setAttribute('d', ''); ro.textContent = `CH${n} not connected`; continue; }
        let off = 0;
        if (c.ac) {
          if (wv) off = v; // v is the PWM average
          else { let s = 0, m = 0; for (const x of data) if (x.t >= now - W && x[k] !== null) { s += x[k]; m++; } off = m ? s / m : v; }
        }
        tr.setAttribute('d', scopeTrace(data, k, wk, now, W, yMap(c, off)));
        let txt = `CH${n} ${c.ac ? 'AC' : 'DC'}  ` + (c.ac ? fmtV(wv ? (wv.hi - wv.lo) * Math.sqrt(wv.duty * (1 - wv.duty)) : 0) + 'rms' : fmtV(v) + ' avg');
        if (wv) txt += `  ${Math.round(1000 / wv.periodMs)} Hz  ${Math.round(wv.duty * 100)}%  ${fmtV(wv.hi - wv.lo)}pp`;
        if (c.ac) txt += `  (DC ${fmtV(v)})`;
        ro.textContent = txt;
      }
      if (st) st.textContent = autoTxt;
    },
  });

  // ---------------------------------------------------------------- Bode plotter
  // A frequency-response analyser: OUT drives the circuit's input with a small sine, IN measures
  // the output, COM is earthed (like the scope's GND). SWEEP steps the frequency from START to
  // STOP and plots gain (dB, yellow) and phase (degrees, cyan dashed) against log frequency:
  //   H(f) = V(IN) / V(OUT). See WB.Circuit.bodeSweep for how it is measured.
  const BODE = { x0: -96, y0: -222, w: 224, h: 128, div: 8 };
  const BODE_F = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6].map((f) => [f, WB.fmtHz(f)]);
  const BODE_PPD = [[5, '5 points / decade (quick)'], [10, '10 points / decade'], [20, '20 points / decade (fine)']];
  const BODE_AMP = [[0.01, '10 mV'], [0.05, '50 mV'], [0.1, '100 mV'], [0.5, '0.5 V'], [1, '1 V']].map(([v, l]) => [v, l + ' amplitude']);
  const BBTN = [
    { a: 'f0-', x: 160, y: -206, w: 14, h: 13, t: '−' }, { a: 'f0+', x: 206, y: -206, w: 14, h: 13, t: '+' },
    { a: 'f1-', x: 160, y: -175, w: 14, h: 13, t: '−' }, { a: 'f1+', x: 206, y: -175, w: 14, h: 13, t: '+' },
    { a: 'ppd', x: 160, y: -149, w: 60, h: 13 },
    { a: 'sweep', x: 160, y: -126, w: 60, h: 22, t: 'SWEEP' },
  ];
  WB.bodeResults = new Map(); // part id -> { f, db, ph, ok, status, done, total, error, key }
  const bodeFreqs = (p) => {
    let a = +p.props.fstart || 10, b = +p.props.fstop || 1e5;
    if (b < a) [a, b] = [b, a];
    const ppd = +p.props.ppd || 10, n = Math.max(2, Math.round(Math.log10(b / a) * ppd) + 1);
    return Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));
  };
  // −3 dB points relative to the highest gain (log-interpolated between sweep points)
  function bodeCorners(r) {
    let iMax = 0;
    r.db.forEach((d, i) => { if (d > r.db[iMax]) iMax = i; });
    const lvl = r.db[iMax] - 3, out = [];
    const cross = (i, j) => { const t = (lvl - r.db[i]) / (r.db[j] - r.db[i]); return { f: r.f[i] * Math.pow(r.f[j] / r.f[i], t), ph: r.ph[i] + t * (r.ph[j] - r.ph[i]) }; };
    for (let i = iMax; i > 0; i--) if (r.db[i - 1] < lvl) { out.push(cross(i, i - 1)); break; }
    for (let i = iMax; i < r.db.length - 1; i++) if (r.db[i + 1] < lvl) { out.push(cross(i, i + 1)); break; }
    return { iMax, corners: out.sort((x, y) => x.f - y.f) };
  }
  WB.defPart('bode', {
    label: 'Bode plotter', category: 'Instruments', prefix: 'BP', dynamic: true, interact: 'panel',
    groundPins: ['COM'], // earthed, like the scope's ground
    defaults: { fstart: 10, fstop: 1e5, ppd: 10, amp: 0.1 },
    pins: () => [
      { id: 'OUT', label: 'OUT — sine generator: connect to the circuit input', x: 0, y: 0, kind: 'pwr' },
      { id: 'IN', label: 'IN — measuring input: connect to the circuit output', x: 20, y: 0 },
      { id: 'COM', label: 'COM — ground (connect to circuit GND)', x: 40, y: 0, kind: 'gnd' },
    ],
    bbox: () => [-112, -238, 344, 242],
    summary: (p) => `${WB.fmtHz(+p.props.fstart || 10)} … ${WB.fmtHz(+p.props.fstop || 1e5)}, ${+p.props.ppd || 10} points/decade`,
    inspector: [
      { key: 'fstart', label: 'Start frequency', type: 'select', options: BODE_F, live: true },
      { key: 'fstop', label: 'Stop frequency', type: 'select', options: BODE_F, live: true },
      { key: 'ppd', label: 'Resolution', type: 'select', options: BODE_PPD, live: true },
      { key: 'amp', label: 'Test signal', type: 'select', options: BODE_AMP, live: true },
    ],
    // During a sweep OUT is a sine source (50 Ω, like a function generator); otherwise it holds 0 V.
    elements(c) {
      const sw = c.sweep && c.sweep.id === c.part.id;
      return [
        sw ? { t: 'V', a: c.n('OUT'), b: c.n('COM'), v: 0, r: 50, shape: 1, freq: 1000, amp: c.sweep.amp || 0.1, tag: 'bode-src' }
          : { t: 'V', a: c.n('OUT'), b: c.n('COM'), v: 0, r: 50, tag: 'bode-src' },
        { t: 'R', a: c.n('IN'), b: c.n('COM'), r: 1e6, tag: 'bode-in' },
      ];
    },
    hit: (lx, ly) => {
      const b = BBTN.find((q) => lx >= q.x - 1 && lx <= q.x + q.w + 1 && ly >= q.y - 1 && ly <= q.y + q.h + 1);
      return b ? b.a : null;
    },
    panelAction(p, act, app) {
      const pr = p.props;
      if (act === 'sweep') { app.runBodeSweep(p); return; }
      if (act === 'ppd') { const l = BODE_PPD.map((o) => o[0]); pr.ppd = l[(l.indexOf(+pr.ppd || 10) + 1) % l.length]; return; }
      const k = act.startsWith('f0') ? 'fstart' : 'fstop';
      pr[k] = stepOpt(BODE_F, pr[k] || (k === 'fstart' ? 10 : 1e5), act.endsWith('+') ? 1 : -1);
    },
    render(p) {
      const { x0, y0, w, h, div } = BODE;
      const r = WB.bodeResults.get(p.id);
      const f0 = +p.props.fstart || 10, f1 = +p.props.fstop || 1e5;
      const lo = Math.min(f0, f1), hi = Math.max(f0, f1);
      const X = (f) => x0 + (w * Math.log10(f / lo)) / Math.log10(hi / lo);
      // decade grid lines (with 2 and 5 as fainter lines)
      let grid = '', flab = '';
      for (let d = Math.floor(Math.log10(lo)); d <= Math.ceil(Math.log10(hi)); d++) {
        for (const m of [1, 2, 5]) {
          const f = m * Math.pow(10, d);
          if (f < lo * 0.999 || f > hi * 1.001) continue;
          const x = X(f).toFixed(1);
          grid += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + h}" stroke="${m === 1 ? '#2e5a40' : '#1a3324'}"/>`;
          if (m === 1 || (m !== 1 && hi / lo < 200)) flab += `<text x="${x}" y="${y0 + h + 8}" font-size="5.5" text-anchor="middle" fill="#9fbfaa" font-family="monospace">${WB.fmtHz(f).replace(' ', '')}</text>`;
        }
      }
      for (let j = 1; j < div; j++) grid += `<line x1="${x0}" y1="${y0 + (j * h) / div}" x2="${x0 + w}" y2="${y0 + (j * h) / div}" stroke="#1f3a2a"/>`;
      let traces = '', glab = '', plab = '', info = '', msg = '';
      const has = r && r.f && r.f.length > 1 && r.key === `${lo}|${hi}`;
      if (has) {
        const mx = Math.max(...r.db), mn = Math.min(...r.db);
        const step = mx - mn > 80 ? 20 : 10;
        const top = Math.ceil((mx + 1) / step) * step, bot = top - step * div;
        const Y = (db) => y0 + (h * (top - WB.clamp(db, bot, top))) / (top - bot);
        const phTop = 180 * Math.ceil(Math.max(...r.ph) / 180 - 1e-9) || 180, phBot = phTop - 360;
        const YP = (ph) => y0 + (h * (phTop - WB.clamp(ph, phBot, phTop))) / 360;
        const n = r.f.length;
        traces += `<path d="${r.f.map((f, i) => (i ? 'L' : 'M') + X(f).toFixed(1) + ',' + YP(r.ph[i]).toFixed(1)).join('')}" fill="none" stroke="#3fd0ff" stroke-width="1.1" stroke-dasharray="3 2"/>`;
        traces += `<path d="${r.f.map((f, i) => (i ? 'L' : 'M') + X(f).toFixed(1) + ',' + Y(r.db[i]).toFixed(1)).join('')}" fill="none" stroke="#ffd23f" stroke-width="1.5" stroke-linejoin="round"/>`;
        for (let j = 0; j <= div; j += 2) {
          glab += `<text x="${x0 - 3}" y="${y0 + (j * h) / div + 2}" font-size="5.5" text-anchor="end" fill="#ffd23f" font-family="monospace">${top - j * step}</text>`;
          plab += `<text x="${x0 + w + 3}" y="${y0 + (j * h) / div + 2}" font-size="5.5" fill="#3fd0ff" font-family="monospace">${phTop - j * 45}°</text>`;
        }
        if (r.status === 'done') {
          const { iMax, corners } = bodeCorners(r);
          const fmtDb = (d) => (d >= 0 ? '+' : '') + d.toFixed(1) + ' dB';
          info = `max ${fmtDb(r.db[iMax])} @ ${WB.fmtHz(r.f[iMax])}`;
          info += corners.length ? `   −3 dB: ${corners.map((c) => WB.fmtHz(c.f) + ' (' + Math.round(c.ph) + '°)').join(', ')}` : '   no −3 dB point in range';
          for (const c of corners) traces += `<line x1="${X(c.f).toFixed(1)}" y1="${y0}" x2="${X(c.f).toFixed(1)}" y2="${y0 + h}" stroke="#ff7a59" stroke-width=".7" stroke-dasharray="2 2"/>`;
          if (r.ok.some((o) => !o)) msg = 'some points did not fully settle';
        }
        if (n < r.total) traces += `<line x1="${X(r.f[n - 1]).toFixed(1)}" y1="${y0}" x2="${X(r.f[n - 1]).toFixed(1)}" y2="${y0 + h}" stroke="#7fbf95" stroke-width=".6"/>`;
      }
      const status = !r ? 'Press SWEEP to measure the frequency response'
        : r.error ? r.error
          : r.status === 'running' ? `Sweeping… ${Math.round((100 * (r.done || 0)) / (r.total || 1))} %`
            : !has ? 'Settings changed — press SWEEP again' : '';
      const btn = (b) => {
        const sweep = b.a === 'sweep', ppd = b.a === 'ppd';
        const label = ppd ? `${+p.props.ppd || 10} pts/dec` : sweep && r && r.status === 'running' ? 'STOP' : b.t;
        return `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${sweep ? 4 : 2.5}" fill="${sweep ? '#2d5fa8' : '#232831'}" stroke="${sweep ? '#7fb0ff' : '#6a7486'}" stroke-width=".8"/>
          <text x="${b.x + b.w / 2}" y="${b.y + (sweep ? 14.5 : ppd ? 9 : 10)}" font-size="${sweep ? 8 : ppd ? 6.2 : 9}" text-anchor="middle" fill="#eef1f6" font-family="sans-serif" font-weight="700">${label}</text></g>`;
      };
      const val = (y, v) => `<text x="190" y="${y}" font-size="6.5" text-anchor="middle" fill="#fff" font-family="monospace">${WB.fmtHz(v)}</text>`;
      return `<rect x="-110" y="-236" width="340" height="238" rx="9" fill="#3b4250" stroke="#1d2129"/>
        <rect x="${x0 - 8}" y="${y0 - 8}" width="${w + 30}" height="${h + 34}" rx="4" fill="#0b0f0c"/>
        <g stroke-width=".6">${grid}</g>
        <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="#2e5a40" stroke-width=".8"/>
        ${traces}${glab}${plab}${flab}
        <text x="${x0 + w / 2}" y="${y0 + h / 2}" font-size="7.5" text-anchor="middle" fill="${r && r.error ? '#ff9a7a' : '#4f8a65'}" font-family="sans-serif">${WB.esc(status)}</text>
        <text x="${x0 + w - 2}" y="${y0 + 8}" font-size="5.5" text-anchor="end" fill="#7fbf95" font-family="monospace">${WB.esc(msg)}</text>
        <text x="${x0}" y="${y0 + h + 22}" font-size="6.5" fill="#d8dde6" font-family="monospace"><tspan fill="#ffd23f">— gain (dB)</tspan>  <tspan fill="#3fd0ff">- - phase</tspan>  ${WB.esc(info)}</text>
        <text x="190" y="-212" font-size="5.5" text-anchor="middle" fill="#cfd5df" font-family="sans-serif" font-weight="700">START</text>${val(-197, lo)}
        <text x="190" y="-181" font-size="5.5" text-anchor="middle" fill="#cfd5df" font-family="sans-serif" font-weight="700">STOP</text>${val(-166, hi)}
        ${BBTN.map(btn).join('')}
        <text x="220" y="-60" font-size="7" text-anchor="end" fill="#9aa5b6" font-family="sans-serif" font-weight="700">BODE PLOTTER</text>
        <text x="220" y="-51" font-size="5" text-anchor="end" fill="#7d8798" font-family="sans-serif">OUT → circuit in · IN ← circuit out</text>
        <circle cx="0" cy="-13" r="5.5" fill="#111" stroke="#d62828" stroke-width="2"/><circle cx="20" cy="-13" r="5.5" fill="#111" stroke="#ffd23f" stroke-width="2"/><circle cx="40" cy="-13" r="5.5" fill="#111" stroke="#888" stroke-width="2"/>
        <text x="0" y="-22.5" font-size="5.5" text-anchor="middle" fill="#ff8a7a" font-family="sans-serif" font-weight="700">OUT</text><text x="20" y="-22.5" font-size="5.5" text-anchor="middle" fill="#ffd23f" font-family="sans-serif" font-weight="700">IN</text><text x="40" y="-22.5" font-size="5.5" text-anchor="middle" fill="#ddd" font-family="sans-serif" font-weight="700">⏚ COM</text>
        <path d="M0,-7.5 V0" stroke="#d62828" stroke-width="2"/><path d="M20,-7.5 V0" stroke="#ffd23f" stroke-width="2"/><path d="M40,-7.5 V0" stroke="#222" stroke-width="2"/>`;
    },
  });
  WB.bodeFreqs = bodeFreqs;

  // ---------------------------------------------------------------- Logic analyzer (8 channels)
  // Records the logic level (HIGH above the threshold) of CH1…CH8 against time and draws them as
  // timing diagrams, like a real logic analyzer. GND is earthed. While it is in the circuit the
  // app solves after every digitalWrite (clocked), so fast sequences such as shiftOut() are
  // captured edge by edge; each Arduino call takes ~4 µs of simulated time, as on a real UNO.
  // PWM pins show their square wave. TRIG picks the channel whose edge starts the screen.
  const LA = { x0: 4, y0: -222, w: 236, lane: 17, n: 8 };
  const LA_COL = ['#ffd23f', '#3fd0ff', '#ff7ab6', '#7dff8a', '#ffa24c', '#b59cff', '#ff6b6b', '#e6e6e6'];
  const LA_TDIV = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
    .map((ms) => [ms, (ms < 1 ? +(ms * 1000).toPrecision(3) + ' µs' : ms < 1000 ? ms + ' ms' : ms / 1000 + ' s') + '/div']);
  const LA_TRIG = [[0, 'Off (rolling display)']].concat(Array.from({ length: 8 }, (_, i) => [i + 1, 'CH' + (i + 1)]));
  const LA_THR = [[0.8, '0.8 V'], [1.4, '1.4 V (TTL, 3.3 V and 5 V logic)'], [2.5, '2.5 V (5 V CMOS)']];
  const LABTN = [
    { a: 'tdiv-', x: 262, y: -206, w: 14, h: 13, t: '−' }, { a: 'tdiv+', x: 306, y: -206, w: 14, h: 13, t: '+' },
    { a: 'trig', x: 262, y: -168, w: 58, h: 14 }, { a: 'edge', x: 262, y: -150, w: 58, h: 14 },
  ];
  WB.defPart('logicanalyzer', {
    label: 'Logic analyzer', category: 'Instruments', prefix: 'LA', dynamic: true, interact: 'panel', clocked: true,
    groundPins: ['GND'],
    defaults: { tdiv: 1, trig: 0, edge: 'rise', thr: 1.4 },
    pins: () => Array.from({ length: 8 }, (_, i) => ({ id: 'CH' + (i + 1), label: `CH${i + 1} input`, x: i * 10, y: 0 }))
      .concat([{ id: 'GND', label: 'Ground (connect to circuit GND)', x: 90, y: 0, kind: 'gnd' }]),
    bbox: () => [-26, -238, 354, 242],
    summary: (p) => `${optLabel(LA_TDIV, p.props.tdiv)}, trigger ${+p.props.trig ? 'CH' + p.props.trig + (p.props.edge === 'fall' ? ' falling' : ' rising') : 'off'}`,
    inspector: [
      { key: 'tdiv', label: 'Time base', type: 'select', options: LA_TDIV, live: true },
      { key: 'trig', label: 'Trigger channel', type: 'select', options: LA_TRIG, live: true },
      { key: 'edge', label: 'Trigger edge', type: 'select', options: [['rise', 'Rising ↑'], ['fall', 'Falling ↓']], live: true },
      { key: 'thr', label: 'Logic threshold', type: 'select', options: LA_THR, live: true },
    ],
    elements: (c) => Array.from({ length: 8 }, (_, i) => ({ t: 'R', a: c.n('CH' + (i + 1)), b: c.n('GND'), r: 1e6 })),
    hit: (lx, ly) => {
      const b = LABTN.find((q) => lx >= q.x - 1 && lx <= q.x + q.w + 1 && ly >= q.y - 1 && ly <= q.y + q.h + 1);
      return b ? b.a : null;
    },
    panelAction(p, act) {
      const pr = p.props;
      if (act === 'tdiv-' || act === 'tdiv+') pr.tdiv = stepOpt(LA_TDIV, pr.tdiv, act.endsWith('+') ? 1 : -1);
      else if (act === 'trig') pr.trig = ((+pr.trig || 0) + 1) % 9;
      else if (act === 'edge') pr.edge = pr.edge === 'fall' ? 'rise' : 'fall';
    },
    render(p) {
      const { x0, y0, w, lane, n } = LA, h = lane * n;
      let grid = '';
      for (let i = 1; i < 10; i++) grid += `<line x1="${x0 + (i * w) / 10}" y1="${y0}" x2="${x0 + (i * w) / 10}" y2="${y0 + h}"/>`;
      let lanes = '';
      for (let k = 0; k < n; k++) {
        const y = y0 + k * lane;
        if (k) lanes += `<line x1="${x0}" y1="${y}" x2="${x0 + w}" y2="${y}" stroke="#1a2a20" stroke-width=".5"/>`;
        lanes += `<text x="${x0 - 3}" y="${y + lane / 2 + 2}" font-size="6" text-anchor="end" fill="${LA_COL[k]}" font-family="monospace" font-weight="700">${k + 1}</text>
          <path class="lb${k}" d="" fill="${LA_COL[k]}" fill-opacity=".28" stroke="none"/>
          <path class="ln${k}" d="" fill="none" stroke="${LA_COL[k]}" stroke-width="1.1" stroke-linejoin="miter"/>
          <text class="lf${k}" x="${x0 + w - 2}" y="${y + 7}" font-size="5" text-anchor="end" fill="${LA_COL[k]}" font-family="monospace" opacity=".85"></text>`;
      }
      const trig = +p.props.trig || 0, fall = p.props.edge === 'fall';
      const btn = (b) => {
        const label = b.a === 'trig' ? (trig ? 'TRIG CH' + trig : 'TRIG OFF') : b.a === 'edge' ? (fall ? 'EDGE ↓' : 'EDGE ↑') : b.t;
        const on = b.a === 'trig' && trig;
        return `<g style="cursor:pointer"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2.5" fill="${on ? '#2d5fa8' : '#232831'}" stroke="${on ? '#7fb0ff' : '#6a7486'}" stroke-width=".8"/>
          <text x="${b.x + b.w / 2}" y="${b.y + (b.t ? 10 : 9.6)}" font-size="${b.t ? 9 : 6.5}" text-anchor="middle" fill="#eef1f6" font-family="sans-serif" font-weight="700">${label}</text></g>`;
      };
      const pinsSvg = Array.from({ length: 8 }, (_, i) => `<circle cx="${i * 10}" cy="-13" r="3.6" fill="#111" stroke="${LA_COL[i]}" stroke-width="1.6"/><text x="${i * 10}" y="-20" font-size="4.6" text-anchor="middle" fill="${LA_COL[i]}" font-family="sans-serif" font-weight="700">${i + 1}</text><path d="M${i * 10},-9.4 V0" stroke="${LA_COL[i]}" stroke-width="1.5"/>`).join('');
      return `<rect x="-24" y="-236" width="350" height="238" rx="9" fill="#3b4250" stroke="#1d2129"/>
        <rect x="-18" y="${y0 - 6}" width="${w + 28}" height="${h + 30}" rx="4" fill="#0b0f0c"/>
        <g stroke="#1f3a2a" stroke-width=".5">${grid}</g>
        ${lanes}
        <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="none" stroke="#2e5a40" stroke-width=".8"/>
        <path class="la-trig" d="" stroke="#ff7a59" stroke-width=".8" stroke-dasharray="2 2"/>
        <text class="la-msg" x="${x0 + w / 2}" y="${y0 + h / 2}" font-size="7.5" text-anchor="middle" fill="#4f8a65" font-family="sans-serif">Start the simulation to record signals</text>
        <text class="la-ro" x="${x0}" y="${y0 + h + 15}" font-size="6.5" fill="#d8dde6" font-family="monospace">${optLabel(LA_TDIV, p.props.tdiv)}</text>
        <text x="291" y="-212" font-size="5.5" text-anchor="middle" fill="#cfd5df" font-family="sans-serif" font-weight="700">TIME / DIV</text>
        <text x="291" y="-197" font-size="6.2" text-anchor="middle" fill="#fff" font-family="monospace">${optLabel(LA_TDIV, p.props.tdiv).replace('/div', '')}</text>
        <text x="291" y="-174" font-size="5.5" text-anchor="middle" fill="#cfd5df" font-family="sans-serif" font-weight="700">TRIGGER</text>
        ${LABTN.map(btn).join('')}
        <text x="320" y="-60" font-size="7" text-anchor="end" fill="#9aa5b6" font-family="sans-serif" font-weight="700">LOGIC ANALYZER</text>
        <text x="320" y="-51" font-size="5" text-anchor="end" fill="#7d8798" font-family="sans-serif">8 channels · threshold ${+p.props.thr || 1.4} V</text>
        ${pinsSvg}
        <circle cx="90" cy="-13" r="3.6" fill="#111" stroke="#888" stroke-width="1.6"/><text x="90" y="-20" font-size="4.6" text-anchor="middle" fill="#ddd" font-family="sans-serif" font-weight="700">GND</text><path d="M90,-9.4 V0" stroke="#222" stroke-width="1.5"/>`;
    },
    // Every frame while simulating: draw the recorded levels for the current window.
    liveUpdate(p, g, app) {
      const buf = app.sim && app.sim.la && app.sim.la[p.id];
      if (!buf || !buf.ev.length) return;
      const ev = buf.ev, { x0, y0, w, lane, n } = LA;
      const W = (+p.props.tdiv || 1) * 10;
      const rt = app.runtime;
      let now = buf.analog ? buf.tEnd : rt ? rt.millis() : performance.now() - app.sim.t0;
      now = Math.max(now, ev[ev.length - 1].t);
      // trigger: the latest edge on the trigger channel with a full screen after it (else the latest edge)
      const tc = (+p.props.trig || 0) - 1, fall = p.props.edge === 'fall';
      let te = null, full = false;
      if (tc >= 0) {
        for (let i = ev.length - 1; i > 0; i--) {
          const a = ev[i - 1].lv[tc], b = ev[i].lv[tc];
          if (a == null || b == null || a === b || (fall ? b !== 0 : b !== 1)) continue;
          if (te === null) te = ev[i].t;
          if (ev[i].t <= now - 0.9 * W) { te = ev[i].t; full = true; break; }
        }
      }
      const t0 = te !== null ? te - 0.1 * W : now - W, t1 = t0 + W, tEnd = Math.min(t1, now);
      const X = (t) => x0 + (w * (t - t0)) / W;
      // first event at or before t0
      let lo = 0, hi = ev.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ev[m].t <= t0) lo = m; else hi = m - 1; }
      const first = ev[lo].t <= t0 ? lo : 0;
      for (let k = 0; k < n; k++) {
        const yH = y0 + k * lane + 3.5, yL = y0 + (k + 1) * lane - 3.5;
        let d = '', band = '', rises = [], prevLv = null;
        for (let i = first; i < ev.length && ev[i].t < tEnd; i++) {
          const e = ev[i], ta = Math.max(t0, e.t), tb = Math.min(tEnd, i + 1 < ev.length ? ev[i + 1].t : tEnd);
          if (tb <= ta && i + 1 < ev.length) { prevLv = e.lv[k]; continue; }
          const lv = e.lv[k], pw = e.pw[k];
          if (lv == null) { prevLv = null; continue; }
          if (prevLv === 0 && lv === 1 && e.t >= t0) rises.push(e.t);
          const xa = X(ta), xb = X(Math.max(tb, ta));
          if (pw && pw.T > 0) {
            const px = (w * pw.T) / W;
            if (px < 3) band += `M${xa.toFixed(1)},${yH}H${xb.toFixed(1)}V${yL}H${xa.toFixed(1)}z`;
            else {
              // square wave from the segment start, at most ~400 cycles
              let t = ta, s = `M${xa.toFixed(1)},${yL}`;
              for (let c = 0; t < tb && c < 400; c++) {
                const xr = X(t), xf = X(Math.min(tb, t + pw.d * pw.T)), xn = X(Math.min(tb, t + pw.T));
                s += `L${xr.toFixed(1)},${yL}L${xr.toFixed(1)},${yH}L${xf.toFixed(1)},${yH}L${xf.toFixed(1)},${yL}L${xn.toFixed(1)},${yL}`;
                rises.push(t);
                t += pw.T;
              }
              d += s;
            }
          } else {
            const y = lv ? yH : yL;
            d += (prevLv == null || d === '' ? `M${xa.toFixed(1)},${y}` : `L${xa.toFixed(1)},${y}`) + `L${xb.toFixed(1)},${y}`;
          }
          prevLv = lv;
        }
        g.querySelector('.ln' + k).setAttribute('d', d);
        g.querySelector('.lb' + k).setAttribute('d', band);
        const last = ev[ev.length - 1];
        const lf = g.querySelector('.lf' + k);
        if (last.lv[k] == null) lf.textContent = '—';
        else if (last.pw[k]) lf.textContent = `${WB.fmtHz(1000 / last.pw[k].T)} ${Math.round(last.pw[k].d * 100)}%`;
        else if (rises.length >= 2) lf.textContent = WB.fmtHz((1000 * (rises.length - 1)) / (rises[rises.length - 1] - rises[0]));
        else lf.textContent = '';
      }
      g.querySelector('.la-msg').textContent = '';
      g.querySelector('.la-trig').setAttribute('d', te !== null ? `M${X(te).toFixed(1)},${y0}V${y0 + n * lane}` : '');
      g.querySelector('.la-ro').textContent = `${optLabel(LA_TDIV, p.props.tdiv)}  ` + (tc < 0 ? 'ROLL' : te === null ? `TRIG CH${tc + 1} ${fall ? '↓' : '↑'} waiting…` : `TRIG CH${tc + 1} ${fall ? '↓' : '↑'}${full ? '' : ' (capturing)'}`);
    },
  });

  // ---------------------------------------------------------------- Data plotter
  // Records up to four voltages over the whole run and draws them in the Plotter tab (next to the
  // Serial Monitor), from where they can be saved as CSV. Each channel measures between its + and −
  // pin; a channel whose − is left open is measured against GND. The probes are ideal (they draw no
  // current). The recording is made by WB.Plotter (js/plotter.js).
  WB.PLOT_COLORS = ['#f2c200', '#22b8cf', '#ff5a5f', '#40c057'];
  WB.defPart('plotter', {
    label: 'Data plotter', category: 'Instruments', prefix: 'PLT',
    pins: () => {
      const pins = [];
      for (let c = 1; c <= 4; c++) {
        pins.push({ id: `CH${c}+`, label: `CH${c} + (the point to measure)`, x: (c - 1) * 20, y: 0 });
        pins.push({ id: `CH${c}-`, label: `CH${c} − (reference; leave open to measure against GND)`, x: (c - 1) * 20 + 10, y: 0 });
      }
      return pins;
    },
    bbox: () => [-8, -50, 86, 53],
    summary: () => '4 channels · graph in the Plotter tab',
    elements: () => [],
    render(p) {
      const C = WB.PLOT_COLORS;
      const T = (x, y, s, t, fill, extra = '') => `<text x="${x}" y="${y}" font-size="${s}" text-anchor="middle" fill="${fill}" font-family="sans-serif"${extra}>${t}</text>`;
      let legs = '', labels = '', traces = '';
      for (let c = 0; c < 4; c++) {
        const x = c * 20;
        legs += `<path d="M${x},0 V-6" ${MLEG}/><path d="M${x + 10},0 V-6" ${MLEG}/>`;
        labels += `<rect x="${x - 3}" y="-13" width="16" height="6" rx="1.5" fill="${C[c]}"/>` + T(x, -8.6, 4.2, '+', '#111', ' font-weight="700"') + T(x + 10, -8.6, 4.2, '−', '#111', ' font-weight="700"') + T(x + 5, -15, 3.6, 'CH' + (c + 1), '#cfd6df', ' font-weight="700"');
      }
      // little screen with four sample traces
      const wave = [
        'M4,-25 C14,-25 16,-40 26,-40 S40,-25 52,-25 S66,-40 74,-40',
        'M4,-30 L18,-30 L18,-38 L36,-38 L36,-30 L54,-30 L54,-38 L74,-38',
        'M4,-27 Q30,-44 74,-43',
        'M4,-35 L74,-28',
      ];
      wave.forEach((d, i) => { traces += `<path d="${d}" stroke="${C[i]}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`; });
      return `${legs}
        <rect x="-7" y="-49" width="84" height="44" rx="3" fill="url(#wbPlastic)" stroke="#0b0b0b" stroke-width=".6"/>
        <rect x="1" y="-46" width="76" height="25" rx="1.5" fill="#0f141a" stroke="#2c3440" stroke-width=".5"/>
        <path d="M1,-33.5 H77 M20,-46 V-21 M39,-46 V-21 M58,-46 V-21" stroke="#223040" stroke-width=".4"/>
        ${traces}
        ${T(39, -18.4, 3.8, 'DATA PLOTTER', '#e6ebf1', ' font-weight="700" letter-spacing=".4"')}
        ${labels}`;
    },
  });

  // ---------------------------------------------------------------- Modulino (I2C / Qwiic modules)
  // Each module has the Qwiic signals GND, 3.3 V, SDA, SCL as pins along its bottom edge.
  // The sketch talks to it through the Modulino library (see runtime.js); a module is found
  // when its SDA/SCL reach the board's I2C bus and it has 3.3 V power.
  const MOD_PINS = [
    { id: 'GND', label: 'GND (Qwiic black)', x: 0, y: 0, kind: 'gnd' },
    { id: '3V3', label: '3.3 V (Qwiic red)', x: 10, y: 0, kind: 'pwr' },
    { id: 'SDA', label: 'SDA — I2C data (Qwiic blue)', x: 20, y: 0 },
    { id: 'SCL', label: 'SCL — I2C clock (Qwiic yellow)', x: 30, y: 0 },
  ];
  function modFrame(title, inner) {
    return `<path d="M0,0 V-8" stroke="#222" stroke-width="2"/><path d="M10,0 V-8" stroke="#d62828" stroke-width="2"/>
      <path d="M20,0 V-8" stroke="#2f7de1" stroke-width="2"/><path d="M30,0 V-8" stroke="#f2c200" stroke-width="2"/>
      <rect x="-45" y="-80" width="120" height="72" rx="6" fill="#e9edf0" stroke="#9aa6ad"/>
      <rect x="-45" y="-80" width="120" height="13" rx="6" fill="#00818a"/><rect x="-45" y="-72" width="120" height="5" fill="#00818a"/>
      <text x="15" y="-70.5" font-size="7" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">MODULINO · ${title}</text>
      <rect x="-42" y="-30" width="12" height="16" rx="1.5" fill="#f2f0e8" stroke="#9a968a"/><rect x="60" y="-30" width="12" height="16" rx="1.5" fill="#f2f0e8" stroke="#9a968a"/>
      ${inner}`;
  }
  function defModulino(type, title, d) {
    WB.defPart(type, Object.assign({
      label: 'Modulino ' + title, category: 'Modulino', prefix: 'MOD', dynamic: true, modulino: true,
      pins: () => MOD_PINS,
      bbox: () => [-45, -80, 120, 83],
      summary: () => 'I2C / Qwiic',
      elements: (c) => [{ t: 'R', a: c.n('3V3'), b: c.n('GND'), r: 33000 }],
    }, d, { defaults: d.defaults || {} }));
  }
  WB.MODULINO_LIB = {}; // class name -> part type (used by the runtime)

  defModulino('mod-buttons', 'Buttons', {
    lib: 'ModulinoButtons', interact: 'buttons',
    hit(lx, ly) { for (let i = 0; i < 3; i++) if (Math.hypot(lx - (-20 + i * 35), ly + 40) < 15) return i; return -1; },
    visualize(c) { const st = c.sim.modulino && c.sim.modulino[c.part.id]; return { leds: st && st.leds ? st.leds.slice() : [0, 0, 0] }; },
    render(p, v) {
      v = v || {};
      const pr = v.pressed || [], leds = v.leds || [];
      let s = '';
      for (let i = 0; i < 3; i++) {
        const x = -20 + i * 35, on = !!leds[i];
        s += `${on ? `<circle cx="${x}" cy="-60" r="7" fill="#3dff6a" opacity=".55" filter="url(#wbGlow)"/>` : ''}
          <rect x="${x - 3}" y="-62" width="6" height="4" rx="1" fill="${on ? '#3dff6a' : '#cfd8cf'}" stroke="#0004" stroke-width=".4"/>
          <rect x="${x - 11}" y="-51" width="22" height="22" rx="2" fill="#2b2f36"/>
          <circle cx="${x}" cy="-40" r="${pr[i] ? 7 : 8}" fill="${pr[i] ? '#555' : '#8a9099'}" stroke="#111"/>
          <text x="${x}" y="-21" font-size="7" text-anchor="middle" fill="#445" font-family="sans-serif">${'ABC'[i]}</text>`;
      }
      return modFrame('BUTTONS', s);
    },
  });

  defModulino('mod-buzzer', 'Buzzer', {
    lib: 'ModulinoBuzzer',
    visualize(c) { const st = c.sim.modulino && c.sim.modulino[c.part.id]; const f = st && st.tone; return { on: !!f, freq: f || 0 }; },
    render(p, v) {
      const on = v && v.on;
      return modFrame('BUZZER', `<circle cx="15" cy="-40" r="20" fill="#1d1d1f"/><circle cx="15" cy="-40" r="13" fill="none" stroke="#333"/><circle cx="15" cy="-40" r="3" fill="#000"/>
        ${on ? `<path d="M41,-50 q6,10 0,20 M47,-55 q10,15 0,30" stroke="#e08a00" stroke-width="1.6" fill="none" stroke-linecap="round"/><text x="15" y="-12" font-size="6" text-anchor="middle" fill="#445" font-family="monospace">${v.freq} Hz</text>` : ''}`);
    },
  });

  defModulino('mod-pixels', 'Pixels', {
    lib: 'ModulinoPixels',
    visualize(c) { const st = c.sim.modulino && c.sim.modulino[c.part.id]; return { px: st && st.pixels ? st.pixels.map((q) => q.slice()) : [] }; },
    render(p, v) {
      const px = (v && v.px) || [];
      let s = '';
      for (let i = 0; i < 8; i++) {
        const x = -38 + i * 15, q = px[i];
        const lit = q && q[3] > 0 && (q[0] || q[1] || q[2]);
        const k = lit ? 0.35 + 0.65 * Math.min(1, q[3] / 50) : 0;
        const col = lit ? `rgb(${Math.round(q[0] * k)},${Math.round(q[1] * k)},${Math.round(q[2] * k)})` : '#f4f4f4';
        if (lit) s += `<circle cx="${x}" cy="-42" r="9" fill="rgb(${q[0]},${q[1]},${q[2]})" opacity="${(0.25 + 0.4 * k).toFixed(2)}" filter="url(#wbGlow)"/>`;
        s += `<rect x="${x - 5}" y="-47" width="10" height="10" rx="1.5" fill="${col}" stroke="#bbb" stroke-width=".6"/>`;
      }
      return modFrame('PIXELS', s + '<text x="15" y="-20" font-size="6" text-anchor="middle" fill="#667" font-family="monospace">0 1 2 3 4 5 6 7</text>');
    },
  });

  defModulino('mod-knob', 'Knob', {
    lib: 'ModulinoKnob', interact: 'knob', knob: { key: 'value', min: -9999, max: 9999, perPx: 6, pressOnClick: true, fmt: (v) => 'value ' + Math.round(v) + ' (click to press)' },
    defaults: { value: 0 },
    inspector: [{ key: 'value', label: 'Encoder value', type: 'number', min: -9999, step: 1, allowZero: true }],
    render(p, v) {
      const val = Math.round(Number(p.props.value) || 0);
      const pr = v && v.pressed;
      return modFrame('KNOB', `<circle cx="15" cy="-40" r="21" fill="#2b2f36"/>
        <circle cx="15" cy="-40" r="${pr ? 14 : 15}" fill="${pr ? '#4a4f57' : '#6d737c'}" stroke="#111"/>
        <g transform="rotate(${(val * 18) % 360} 15 -40)"><rect x="13.6" y="-54" width="2.8" height="9" rx="1" fill="#eee"/></g>
        <text x="-30" y="-36" font-size="8" fill="#334" font-family="monospace">${val}</text>`);
    },
  });

  defModulino('mod-distance', 'Distance', {
    lib: 'ModulinoDistance', interact: 'knob', knob: { key: 'mm', min: 0, max: 1300, fmt: (v) => Math.round(v) + ' mm' },
    defaults: { mm: 250 },
    inspector: [{ key: 'mm', label: 'Distance to object', type: 'range', min: 0, max: 1300, step: 1, fmt: (v) => Math.round(v) + ' mm' }],
    render(p) {
      return modFrame('DISTANCE', `<rect x="3" y="-50" width="24" height="14" rx="2" fill="#1d1d1f"/><circle cx="9" cy="-43" r="3" fill="#4a1d6b"/><circle cx="21" cy="-43" r="3" fill="#333"/>
        <text x="15" y="-22" font-size="8" text-anchor="middle" fill="#334" font-family="monospace">${Math.round(p.props.mm)} mm</text>`);
    },
  });

  defModulino('mod-movement', 'Movement', {
    lib: 'ModulinoMovement', interact: 'knob', knob: { key: 'pitch', min: -90, max: 90, fmt: (v) => 'pitch ' + Math.round(v) + '°' },
    defaults: { pitch: 0, roll: 0 },
    inspector: [
      { key: 'pitch', label: 'Pitch (tilt forward/back)', type: 'range', min: -90, max: 90, step: 1, fmt: (v) => Math.round(v) + '°' },
      { key: 'roll', label: 'Roll (tilt left/right)', type: 'range', min: -90, max: 90, step: 1, fmt: (v) => Math.round(v) + '°' },
    ],
    render(p) {
      const pi = Number(p.props.pitch) || 0, ro = Number(p.props.roll) || 0;
      return modFrame('MOVEMENT', `<g transform="rotate(${ro} 15 -42)"><rect x="5" y="${-50 + pi / 18}" width="20" height="${Math.max(4, 16 * Math.cos(pi * Math.PI / 180))}" rx="2" fill="#1d1d1f"/></g>
        <text x="15" y="-20" font-size="6.5" text-anchor="middle" fill="#334" font-family="monospace">pitch ${Math.round(pi)}° roll ${Math.round(ro)}°</text>`);
    },
  });

  defModulino('mod-thermo', 'Thermo', {
    lib: 'ModulinoThermo', interact: 'knob', knob: { key: 'temp', min: -20, max: 60, fmt: (v) => Math.round(v) + ' °C' },
    defaults: { temp: 24, humidity: 45 },
    inspector: [
      { key: 'temp', label: 'Temperature', type: 'range', min: -20, max: 60, step: 0.5, fmt: (v) => (+v).toFixed(1) + ' °C' },
      { key: 'humidity', label: 'Relative humidity', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + '%' },
    ],
    render(p) {
      return modFrame('THERMO', `<rect x="9" y="-52" width="12" height="12" rx="1.5" fill="#1d1d1f"/>
        <text x="15" y="-28" font-size="8" text-anchor="middle" fill="#334" font-family="monospace">${(+p.props.temp).toFixed(1)}°C</text>
        <text x="15" y="-17" font-size="7" text-anchor="middle" fill="#556" font-family="monospace">${Math.round(p.props.humidity)}% RH</text>`);
    },
  });
  for (const t in PARTS) if (PARTS[t].modulino) WB.MODULINO_LIB[PARTS[t].lib] = t;

  // ---------------------------------------------------------------- Breadboards
  const BB_ROWS = 'abcdefghij';
  const BB_ROWY = [40, 50, 60, 70, 80, 110, 120, 130, 140, 150];
  // A breadboard is 1 or more stacked blocks (190 high), each with 10 rows and 4 power rails.
  // Block 0 uses rows a–j and rails TP/TN/BN/BP; block 1 rows k–t and rails CP/CN/DN/DP.
  const BLOCK_ROWS = ['abcdefghij', 'klmnopqrst'];
  const BLOCK_RAILS = [{ TP: 'Top + rail', TN: 'Top − rail', BN: 'Bottom − rail', BP: 'Bottom + rail' }, { CP: 'Middle + rail', CN: 'Middle − rail', DN: 'Bottom − rail', DP: 'Bottom + rail' }];
  const bbCache = new Map();
  function bbLayout(cols, blocks) {
    blocks = blocks || 1;
    const key = cols + 'x' + blocks;
    if (bbCache.has(key)) return bbCache.get(key);
    const pins = [], groups = [];
    for (let b = 0; b < blocks; b++) {
      const y0 = b * 190, rows = BLOCK_ROWS[b];
      for (let c = 1; c <= cols; c++) {
        const top = [], bot = [];
        for (let r = 0; r < 10; r++) {
          const id = rows[r] + c;
          pins.push({ id, label: 'Hole ' + id, x: 10 + c * 10, y: y0 + BB_ROWY[r] });
          (r < 5 ? top : bot).push(id);
        }
        groups.push(top, bot);
      }
      const names = BLOCK_RAILS[b], ry = [10, 20, 170, 180];
      const rails = {};
      for (const r in names) rails[r] = [];
      let k = 0;
      for (let g = 0; g * 6 + 5 <= cols; g++) for (let i = 0; i < 5; i++) {
        k++;
        const x = 20 + (g * 6 + i) * 10;
        Object.keys(names).forEach((r, j) => {
          const id = r + k;
          rails[r].push(id);
          pins.push({ id, label: names[r], x, y: y0 + ry[j], kind: r[1] === 'P' ? 'pwr' : 'gnd' });
        });
      }
      for (const r in rails) groups.push(rails[r]);
    }
    const lay = { pins, groups, w: cols * 10 + 30, h: 190 * blocks };
    bbCache.set(key, lay);
    return lay;
  }
  WB.bbLayout = bbLayout;

  const BB_FRAME = 20;
  function bbRender(cols, blocks) {
    blocks = blocks || 1;
    const { w, h } = bbLayout(cols, blocks);
    // A 20 px frame (BB_FRAME) round the board: something to grab that is not a hole, so the
    // board is easy to move with a finger. The holes keep their positions.
    const F = BB_FRAME;
    let s = `<rect x="${-F}" y="${-F}" width="${w + 2 * F}" height="${h + 2 * F}" rx="9" fill="#d9d3c4" stroke="#b4ad9c"/>`;
    for (const [gx, gy, vertical] of [[w / 2, -F / 2, false], [w / 2, h + F / 2, false], [-F / 2, h / 2, true], [w + F / 2, h / 2, true]])
      for (let k = -2; k <= 2; k++) s += `<circle cx="${vertical ? gx : gx + k * 7}" cy="${vertical ? gy + k * 7 : gy}" r="1.6" fill="#b4ad9c"/>`;
    s += `<rect x="0" y="0" width="${w}" height="${h}" rx="5" fill="#f1efe8" stroke="#c9c4b5"/>`;
    for (let b = 0; b < blocks; b++) {
      const y = b * 190, rows = BLOCK_ROWS[b];
      if (b) s += `<line x1="4" y1="${y}" x2="${w - 4}" y2="${y}" stroke="#d6d1c3" stroke-width="1"/>`;
      s += `<rect x="4" y="${y + 91}" width="${w - 8}" height="8" rx="2" fill="#dcd8cc"/>
      <line x1="14" y1="${y + 4}" x2="${w - 14}" y2="${y + 4}" stroke="#e05252" stroke-width="1.2"/>
      <line x1="14" y1="${y + 26}" x2="${w - 14}" y2="${y + 26}" stroke="#4a78d0" stroke-width="1.2"/>
      <line x1="14" y1="${y + 164}" x2="${w - 14}" y2="${y + 164}" stroke="#4a78d0" stroke-width="1.2"/>
      <line x1="14" y1="${y + 186}" x2="${w - 14}" y2="${y + 186}" stroke="#e05252" stroke-width="1.2"/>
      <g font-family="sans-serif" font-size="7" fill="#9a9488" text-anchor="middle">`;
      for (const x of [7, w - 7]) s += `<text x="${x}" y="${y + 12.5}" fill="#e05252">+</text><text x="${x}" y="${y + 22.5}" fill="#4a78d0">−</text><text x="${x}" y="${y + 172.5}" fill="#4a78d0">−</text><text x="${x}" y="${y + 182.5}" fill="#e05252">+</text>`;
      for (let r = 0; r < 10; r++) s += `<text x="9" y="${y + BB_ROWY[r] + 2.5}">${rows[r]}</text><text x="${w - 9}" y="${y + BB_ROWY[r] + 2.5}">${rows[r]}</text>`;
      for (let c = 1; c <= cols; c++) if (c === 1 || c % 5 === 0) s += `<text x="${10 + c * 10}" y="${y + 33}">${c}</text><text x="${10 + c * 10}" y="${y + 162}">${c}</text>`;
      s += '</g>';
    }
    return s;
  }

  for (const [type, cols, blocks, label] of [['breadboard-half', 30, 1, 'Breadboard (half)'], ['breadboard-full', 63, 1, 'Breadboard (full)'], ['breadboard-large', 63, 2, 'Breadboard (large)']]) {
    let cached = null;
    WB.defPart(type, {
      label, category: 'Breadboards', prefix: 'BB', holes: true, layer: 0,
      pins: () => bbLayout(cols, blocks).pins,
      groups: () => bbLayout(cols, blocks).groups,
      bbox: () => [-BB_FRAME, -BB_FRAME, bbLayout(cols, blocks).w + 2 * BB_FRAME, 190 * blocks + 2 * BB_FRAME],
      summary: () => blocks > 1 ? `${blocks} × ${cols} columns, ${blocks * 4} power rails` : cols + ' columns',
      render: () => cached || (cached = bbRender(cols, blocks)),
    });
  }
})(window.WB);

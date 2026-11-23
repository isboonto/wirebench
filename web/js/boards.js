'use strict';
(function (WB) {
  // Microcontroller boards. Pin coordinates are on the 0.1" (10 px) grid.
  const BOARDS = (WB.BOARDS = {
    'board-uno-q': {
      label: 'Arduino UNO Q', short: 'UNO Q', layout: 'uno', vcc: 3.3, analogCount: 6, pwm: [3, 5, 6, 9, 10, 11],
      pcb: '#1f2e38', silk: '#d9e6ee', usb: 'c', matrix: { w: 13, h: 8, color: '#49b0ff' }, qwiic: true,
      info: 'Dual-processor board: Qualcomm QRB2210 (Linux) + STM32U585 microcontroller. The simulator runs your sketch on the MCU side with 3.3 V logic; the 13×8 LED matrix is supported. Bridge calls to the Linux side are stubbed.',
    },
    'board-uno-r4-wifi': {
      label: 'Arduino UNO R4 WiFi', short: 'UNO R4 WiFi', layout: 'uno', vcc: 5, analogCount: 6, pwm: [3, 5, 6, 9, 10, 11],
      pcb: '#0b6b73', silk: '#e6f6f7', usb: 'c', matrix: { w: 12, h: 8, color: '#ff4a3d' }, qwiic: true, i2cA4: true,
      info: 'Renesas RA4M1 (5 V logic) + ESP32-S3 radio, 12×8 red LED matrix.',
    },
    'board-uno-r4-minima': {
      label: 'Arduino UNO R4 Minima', short: 'UNO R4 Minima', layout: 'uno', vcc: 5, analogCount: 6, pwm: [3, 5, 6, 9, 10, 11],
      pcb: '#0b6b73', silk: '#e6f6f7', usb: 'c', i2cA4: true,
      info: 'Renesas RA4M1, 5 V logic.',
    },
    'board-uno-r3': {
      label: 'Arduino UNO R3', short: 'UNO R3', layout: 'uno', vcc: 5, analogCount: 6, pwm: [3, 5, 6, 9, 10, 11], avr: true,
      pcb: '#0d7c87', silk: '#e6f6f7', usb: 'b', i2cA4: true,
      info: 'ATmega328P, 5 V logic, 10-bit ADC.',
    },
    'board-nano': {
      label: 'Arduino Nano', short: 'Nano', layout: 'nano', vcc: 5, analogCount: 8, pwm: [3, 5, 6, 9, 10, 11], avr: true,
      pcb: '#1565a8', silk: '#e8f1fa', usb: 'mini',
      info: 'ATmega328P in a breadboard-friendly package. Plug it across the breadboard center gap.',
    },
    'board-mega': {
      label: 'Arduino Mega 2560', short: 'MEGA 2560', layout: 'mega', vcc: 5, avr: true,
      digitalCount: 54, analogCount: 16, analogBase: 54, // A0..A15 = pins 54..69
      pwm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46],
      intPins: [2, 3, 21, 20, 19, 18], // interrupt numbers 0..5
      pcb: '#0d7c87', silk: '#e6f6f7', usb: 'b',
      info: 'ATmega2560, 5 V logic, 10-bit ADC. 54 digital pins (15 with PWM ~), 16 analog inputs (A0–A15), 4 serial ports (Serial1–3 print to the Serial Monitor too), I2C on 20 (SDA) / 21 (SCL), external interrupts on 2, 3, 18, 19, 20, 21.',
    },
  });
  // Defaults for the UNO-style numbering: D0..D13, A0 = 14; AVR boards have interrupts 0/1 on pins 2/3.
  for (const t in BOARDS) {
    const b = BOARDS[t];
    if (b.digitalCount == null) b.digitalCount = 14;
    if (b.analogBase == null) b.analogBase = 14;
    if (!b.intPins && b.avr) b.intPins = [2, 3];
  }

  const DLBL = { D13: '13', D12: '12', D11: '~11', D10: '~10', D9: '~9', D8: '8', D7: '7', D6: '~6', D5: '~5', D4: '4', D3: '~3', D2: '2', D1: 'TX→1', D0: 'RX←0',
    D14: 'TX3 14', D15: 'RX3 15', D16: 'TX2 16', D17: 'RX2 17', D18: 'TX1 18', D19: 'RX1 19', D20: 'SDA 20', D21: 'SCL 21' };

  function unoPins() {
    const top = [['SCL', 80, 'SCL'], ['SDA', 90, 'SDA'], ['AREF', 100, 'AREF'], ['GND3', 110, 'GND'], ['D13', 120], ['D12', 130], ['D11', 140], ['D10', 150], ['D9', 160], ['D8', 170],
      ['D7', 190], ['D6', 200], ['D5', 210], ['D4', 220], ['D3', 230], ['D2', 240], ['D1', 250], ['D0', 260]];
    const bot = [['IOREF', 100, 'IOREF'], ['RESET', 110, 'RESET'], ['3V3', 120, '3.3V'], ['5V', 130, '5V'], ['GND', 140, 'GND'], ['GND2', 150, 'GND'], ['VIN', 160, 'VIN'],
      ['A0', 180, 'A0'], ['A1', 190, 'A1'], ['A2', 200, 'A2'], ['A3', 210, 'A3'], ['A4', 220, 'A4'], ['A5', 230, 'A5']];
    const pins = [];
    for (const [id, x, l] of top) pins.push({ id, x, y: 10, short: l || DLBL[id], side: 'top' });
    for (const [id, x, l] of bot) pins.push({ id, x, y: 200, short: l, side: 'bot' });
    return pins;
  }
  // Mega 2560: the UNO headers (same positions, so UNO shields fit), plus the COMMUNICATION
  // header (14..21) after pin 0, A8..A15 after A7, and the double row 22..53 at the right end
  // (5 V on top, GND at the bottom).
  const MEGA_DBL = { x0: 370, x1: 380, y0: 20 };
  function megaPins() {
    const pins = unoPins().map((p) => Object.assign({}, p, p.id === 'D2' || p.id === 'D3' || p.id === 'D4' || p.id === 'D7' || p.id === 'D8' || p.id === 'D12' || p.id === 'D13' ? { short: '~' + p.id.slice(1) } : {}));
    for (let i = 0; i < 8; i++) pins.push({ id: 'D' + (14 + i), x: 280 + i * 10, y: 10, short: DLBL['D' + (14 + i)], side: 'top' });
    for (let i = 8; i < 16; i++) pins.push({ id: 'A' + i, x: 270 + (i - 8) * 10, y: 200, short: 'A' + i, side: 'bot' });
    const { x0, x1, y0 } = MEGA_DBL;
    pins.push({ id: '5V_1', x: x0, y: y0, short: '5V', side: 'dblL' }, { id: '5V_2', x: x1, y: y0, short: '5V', side: 'dblR' });
    for (let r = 0; r < 16; r++) {
      const a = 22 + r * 2, b = a + 1, y = y0 + 10 + r * 10;
      pins.push({ id: 'D' + a, x: x0, y, short: (a >= 44 && a <= 46 ? '~' : '') + a, side: 'dblL' });
      pins.push({ id: 'D' + b, x: x1, y, short: (b >= 44 && b <= 46 ? '~' : '') + b, side: 'dblR' });
    }
    pins.push({ id: 'GND4', x: x0, y: y0 + 170, short: 'GND', side: 'dblL' }, { id: 'GND5', x: x1, y: y0 + 170, short: 'GND', side: 'dblR' });
    return pins;
  }
  function nanoPins() {
    const top = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RESET', 'GND', 'VIN'];
    const bot = ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND2', 'RESET2', 'D0', 'D1'];
    const nice = { '3V3': '3V3', RESET: 'RST', RESET2: 'RST', GND2: 'GND', AREF: 'REF' };
    const pins = [];
    top.forEach((id, i) => pins.push({ id, x: 20 + i * 10, y: 10, short: nice[id] || DLBL[id] || id, side: 'top' }));
    bot.forEach((id, i) => pins.push({ id, x: 20 + i * 10, y: 70, short: nice[id] || DLBL[id] || id, side: 'bot' }));
    return pins;
  }

  // Qwiic (I2C) connector: GND, 3.3 V, SDA, SCL — on the right edge of UNO-size boards.
  const QWIIC = [['QGND', 'Qwiic GND', 'gnd'], ['Q3V3', 'Qwiic 3.3 V', 'pwr'], ['QSDA', 'Qwiic SDA (I2C data)', ''], ['QSCL', 'Qwiic SCL (I2C clock)', '']];
  function qwiicPins() { return QWIIC.map(([id, label, kind], i) => ({ id, label, kind, x: 260, y: 120 + i * 10, short: '', side: 'qwiic' })); }

  function pinMeta(spec, p) {
    const out = Object.assign({}, p);
    if (p.side === 'qwiic') return out;
    const m = /^D(\d+)$/.exec(p.id);
    if (/^GND/.test(p.id)) { out.kind = 'gnd'; out.label = 'GND'; }
    else if (/^5V/.test(p.id) || p.id === '3V3' || p.id === 'VIN') { out.kind = 'pwr'; out.label = p.id === '3V3' ? '3.3 V' : /^5V/.test(p.id) ? '5V' : p.id; }
    else if (m) {
      const n = +m[1], extra = { 0: ' · RX0', 1: ' · TX0', 14: ' · TX3', 15: ' · RX3', 16: ' · TX2', 17: ' · RX2', 18: ' · TX1', 19: ' · RX1', 20: ' · SDA', 21: ' · SCL' };
      out.label = 'Digital ' + n + (spec.pwm.includes(n) ? ' (PWM ~)' : '') + (n === 13 ? ' · LED_BUILTIN' : '') + (spec.layout === 'mega' && extra[n] ? extra[n] : '')
        + (spec.intPins && spec.intPins.includes(n) ? ` · interrupt ${spec.intPins.indexOf(n)}` : '');
    }
    else if (/^A\d+$/.test(p.id)) out.label = 'Analog ' + p.id + (spec.layout === 'nano' && +p.id.slice(1) > 5 ? ' (analog in only)' : '') + (spec.analogBase !== 14 ? ` (pin ${spec.analogBase + +p.id.slice(1)})` : '');
    else out.label = p.id;
    return out;
  }

  function header(x0, x1, y) { return `<rect x="${x0}" y="${y - 6}" width="${x1 - x0}" height="12" rx="1.2" fill="#1a1a1a"/>`; }
  function holes(pins) { return pins.map((p) => `<rect x="${p.x - 2.5}" y="${p.y - 2.5}" width="5" height="5" fill="#000" stroke="#555" stroke-width=".5"/>`).join(''); }

  function smd(x, y, w, h, label, sub) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#16181b" stroke="#2c2f33"/>
      ${label ? `<text x="${x + w / 2}" y="${y + h / 2 + (sub ? -1 : 2)}" font-size="5.5" text-anchor="middle" fill="#8d949c" font-family="monospace">${label}</text>` : ''}
      ${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 6}" font-size="4.5" text-anchor="middle" fill="#6b7178" font-family="monospace">${sub}</text>` : ''}`;
  }

  function onboardLed(x, y, b, color, label, silk) {
    const on = b > 0.02;
    return `${on ? `<circle cx="${x}" cy="${y}" r="${5 + 4 * b}" fill="${color}" opacity="${(0.3 + 0.5 * b).toFixed(2)}" filter="url(#wbGlow)"/>` : ''}
      <rect x="${x - 3}" y="${y - 2}" width="6" height="4" rx=".8" fill="${on ? color : '#d8d0b8'}" stroke="#0004" stroke-width=".4"/>
      <text x="${x}" y="${y + 9}" font-size="5" text-anchor="middle" fill="${silk}" font-family="sans-serif">${label}</text>`;
  }

  function matrixSvg(spec, x, y, vis) {
    const { w, h, color } = spec.matrix;
    const pitch = 7;
    const buf = vis && vis.matrix;
    let s = `<rect x="${x - 5}" y="${y - 5}" width="${w * pitch + 3}" height="${h * pitch + 3}" rx="2" fill="#111417"/>`;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const v = buf ? buf[r * w + c] / 255 : 0;
      const cx = x + c * pitch, cy = y + r * pitch;
      s += `<rect x="${cx - 1.8}" y="${cy - 1.2}" width="3.6" height="2.4" rx=".6" fill="${v > 0.01 ? WB.mix('#2a2f35', color, 0.35 + 0.65 * v) : '#e9e4d2'}" ${v > 0.01 ? '' : 'opacity=".55"'}/>`;
      if (v > 0.01) s += `<circle cx="${cx}" cy="${cy}" r="3.4" fill="${color}" opacity="${(0.35 * v).toFixed(2)}"/>`;
    }
    return s;
  }

  function renderUno(spec, part, vis) {
    vis = vis || {};
    const pins = unoPins();
    const S = spec.silk;
    let s = `<path d="M6,0 H258 L270,12 V198 L258,210 H6 Q0,210 0,204 V6 Q0,0 6,0 Z" fill="${spec.pcb}" stroke="#0007"/>
      <circle cx="16" cy="12" r="4" fill="#d6d1c0" stroke="#999"/><circle cx="250" cy="200" r="4" fill="#d6d1c0" stroke="#999"/>
      <circle cx="16" cy="198" r="4" fill="#d6d1c0" stroke="#999"/><circle cx="256" cy="66" r="4" fill="#d6d1c0" stroke="#999"/>`;
    if (spec.usb === 'b') {
      s += `<rect x="-10" y="32" width="48" height="44" rx="1" fill="#c9cdd2" stroke="#7d8287"/><rect x="-6" y="40" width="10" height="28" fill="#9aa0a6"/>
        <rect x="-8" y="140" width="52" height="36" rx="2" fill="#1b1b1b" stroke="#000"/><circle cx="6" cy="158" r="7" fill="#333"/>`;
    } else {
      s += `<rect x="-8" y="66" width="28" height="34" rx="6" fill="#c9cdd2" stroke="#7d8287"/><rect x="-6" y="75" width="8" height="16" rx="3" fill="#6f757b"/>`;
    }
    s += header(73, 177, 10) + header(183, 267, 10) + header(93, 167, 200) + header(173, 237, 200) + holes(pins);
    for (const p of pins) {
      if (p.side === 'top') s += `<text transform="translate(${p.x - 2},20) rotate(90)" font-size="5.4" fill="${S}" font-family="monospace">${p.short}</text>`;
      else s += `<text transform="translate(${p.x + 2},190) rotate(-90)" font-size="5.4" fill="${S}" font-family="monospace">${p.short}</text>`;
    }
    s += `<text x="110" y="50" font-size="5" fill="${S}" font-family="sans-serif">DIGITAL (PWM ~)</text>
      <text x="196" y="166" font-size="5" fill="${S}" font-family="sans-serif">ANALOG IN</text>
      <text x="112" y="166" font-size="5" fill="${S}" font-family="sans-serif">POWER</text>`;
    if (part.type === 'board-uno-q') {
      s += smd(40, 108, 46, 46, 'QRB2210', 'Linux MPU') + smd(98, 132, 28, 28, 'STM32', 'U585');
      s += `<rect x="40" y="62" width="40" height="22" rx="1.5" fill="#1a1c1f" stroke="#2c2f33"/><text x="60" y="76" font-size="5" text-anchor="middle" fill="#8d949c" font-family="monospace">LPDDR4</text>`;
      s += matrixSvg(spec, 140, 66, vis);
    } else if (part.type === 'board-uno-r4-wifi') {
      s += smd(52, 120, 34, 34, 'RA4M1') + smd(220, 120, 30, 22, 'ESP32', 'S3');
      s += matrixSvg(spec, 142, 70, vis);
    } else if (part.type === 'board-uno-r4-minima') {
      s += smd(140, 100, 44, 44, 'RA4M1', 'Renesas');
    } else {
      s += `<rect x="134" y="128" width="112" height="26" rx="2" fill="#1b1b1b" stroke="#000"/><circle cx="140" cy="141" r="2.5" fill="#333"/>
        <text x="190" y="144" font-size="7" text-anchor="middle" fill="#8d949c" font-family="monospace">ATMEGA328P</text>`;
      for (let i = 0; i < 14; i++) s += `<rect x="${137 + i * 7.6}" y="124" width="3" height="4" fill="#bbb"/><rect x="${137 + i * 7.6}" y="154" width="3" height="4" fill="#bbb"/>`;
      s += smd(60, 90, 22, 22, '16U2');
    }
    if (spec.qwiic) {
      s += `<rect x="252" y="112" width="20" height="56" rx="2" fill="#f2f0e8" stroke="#9a968a"/>
        <rect x="256" y="116" width="8" height="48" rx="1" fill="#d9d5c8"/>
        <text transform="translate(248,140) rotate(-90)" font-size="5" text-anchor="middle" fill="${S}" font-family="sans-serif">Qwiic</text>`;
      qwiicPins().forEach((p, i) => { s += `<rect x="${p.x - 2}" y="${p.y - 2}" width="4" height="4" fill="${['#222', '#d62828', '#2f7de1', '#f2c200'][i]}"/>`; });
    }
    s += onboardLed(120, 32, vis.L || 0, '#ffb020', 'L', S);
    s += onboardLed(246, 38, vis.on ? 1 : 0, '#3dff6a', 'ON', S);
    s += `<text x="${part.type === 'board-uno-r3' ? 70 : 200}" y="${part.type === 'board-uno-r3' ? 70 : 154}" font-size="11" fill="${S}" font-family="sans-serif" font-weight="700" opacity=".9">${spec.short}</text>`;
    return s;
  }

  function renderMega(spec, part, vis) {
    vis = vis || {};
    const pins = megaPins();
    const S = spec.silk;
    let s = `<path d="M6,0 H388 L400,12 V198 L388,210 H6 Q0,210 0,204 V6 Q0,0 6,0 Z" fill="${spec.pcb}" stroke="#0007"/>
      <circle cx="16" cy="12" r="4" fill="#d6d1c0" stroke="#999"/><circle cx="16" cy="198" r="4" fill="#d6d1c0" stroke="#999"/>
      <circle cx="256" cy="66" r="4" fill="#d6d1c0" stroke="#999"/><circle cx="356" cy="18" r="4" fill="#d6d1c0" stroke="#999"/><circle cx="356" cy="194" r="4" fill="#d6d1c0" stroke="#999"/>
      <rect x="-10" y="32" width="48" height="44" rx="1" fill="#c9cdd2" stroke="#7d8287"/><rect x="-6" y="40" width="10" height="28" fill="#9aa0a6"/>
      <rect x="-8" y="140" width="52" height="36" rx="2" fill="#1b1b1b" stroke="#000"/><circle cx="6" cy="158" r="7" fill="#333"/>`;
    s += header(73, 177, 10) + header(183, 267, 10) + header(273, 357, 10)
      + header(93, 167, 200) + header(173, 257, 200) + header(263, 347, 200)
      + `<rect x="${MEGA_DBL.x0 - 6}" y="${MEGA_DBL.y0 - 6}" width="${MEGA_DBL.x1 - MEGA_DBL.x0 + 12}" height="182" rx="1.2" fill="#1a1a1a"/>`
      + holes(pins);
    for (const p of pins) {
      if (p.side === 'top') s += `<text transform="translate(${p.x - 2},20) rotate(90)" font-size="5.4" fill="${S}" font-family="monospace">${p.short}</text>`;
      else if (p.side === 'bot') s += `<text transform="translate(${p.x + 2},190) rotate(-90)" font-size="5.4" fill="${S}" font-family="monospace">${p.short}</text>`;
      else if (p.side === 'dblL') s += `<text x="${p.x - 8}" y="${p.y + 2}" font-size="5" text-anchor="end" fill="${S}" font-family="monospace">${p.short}</text>`;
      else s += `<text x="${p.x + 8}" y="${p.y + 2}" font-size="5" fill="${S}" font-family="monospace">${p.short}</text>`;
    }
    s += `<text x="110" y="50" font-size="5" fill="${S}" font-family="sans-serif">DIGITAL (PWM ~)</text>
      <text x="282" y="50" font-size="5" fill="${S}" font-family="sans-serif">COMMUNICATION</text>
      <text x="112" y="166" font-size="5" fill="${S}" font-family="sans-serif">POWER</text>
      <text x="236" y="166" font-size="5" fill="${S}" font-family="sans-serif">ANALOG IN</text>
      <text transform="translate(352,106) rotate(-90)" font-size="5" text-anchor="middle" fill="${S}" font-family="sans-serif">DIGITAL</text>`;
    // ATmega2560 (TQFP-100) and the USB chip
    s += `<g transform="rotate(45 230 108)"><rect x="206" y="84" width="48" height="48" rx="1.5" fill="#16181b" stroke="#2c2f33"/></g>
      <text x="230" y="106" font-size="5.5" text-anchor="middle" fill="#8d949c" font-family="monospace">ATMEGA</text>
      <text x="230" y="114" font-size="5.5" text-anchor="middle" fill="#8d949c" font-family="monospace">2560</text>`;
    s += smd(60, 90, 22, 22, '16U2');
    s += onboardLed(120, 32, vis.L || 0, '#ffb020', 'L', S);
    s += onboardLed(300, 72, vis.on ? 1 : 0, '#3dff6a', 'ON', S);
    s += `<text x="70" y="128" font-size="12" fill="${S}" font-family="sans-serif" font-weight="700" opacity=".9">MEGA 2560</text>`;
    return s;
  }

  function renderNano(spec, part, vis) {
    vis = vis || {};
    const pins = nanoPins();
    const S = spec.silk;
    let s = `<rect x="0" y="0" width="180" height="80" rx="4" fill="${spec.pcb}" stroke="#0007"/>
      <rect x="-10" y="28" width="26" height="24" rx="2" fill="#c9cdd2" stroke="#7d8287"/><rect x="-8" y="34" width="8" height="12" fill="#6f757b"/>`;
    s += holes(pins);
    for (const p of pins) {
      if (p.side === 'top') s += `<text transform="translate(${p.x - 2},18) rotate(90)" font-size="4.6" fill="${S}" font-family="monospace">${p.short}</text>`;
      else s += `<text transform="translate(${p.x + 2},62) rotate(-90)" font-size="4.6" fill="${S}" font-family="monospace">${p.short}</text>`;
    }
    s += `<g transform="rotate(45 112 40)"><rect x="100" y="28" width="24" height="24" rx="1" fill="#16181b" stroke="#2c2f33"/></g>
      <text x="112" y="42" font-size="4.5" text-anchor="middle" fill="#8d949c" font-family="monospace">328P</text>
      <rect x="150" y="32" width="14" height="10" rx="1" fill="#e8e8e8" stroke="#999"/>`;
    s += onboardLed(60, 34, vis.L || 0, '#ffb020', 'L', S);
    s += onboardLed(60, 48, vis.on ? 1 : 0, '#3dff6a', '', S);
    s += `<text x="80" y="46" font-size="7" fill="${S}" font-family="sans-serif" font-weight="700">NANO</text>`;
    return s;
  }

  for (const type in BOARDS) {
    const spec = BOARDS[type];
    const pinList = (spec.layout === 'nano' ? nanoPins() : spec.layout === 'mega' ? megaPins() : unoPins().concat(spec.qwiic ? qwiicPins() : [])).map((p) => pinMeta(spec, p));
    const ground = pinList.filter((p) => p.kind === 'gnd').map((p) => p.id);
    // Internal connections: Qwiic shares the I2C bus and 3.3 V; on classic UNO layouts SDA/SCL are A4/A5.
    const groups = [];
    if (spec.layout === 'nano') groups.push(['RESET', 'RESET2']);
    if (spec.qwiic) groups.push(['QSDA', 'SDA'], ['QSCL', 'SCL'], ['Q3V3', '3V3']);
    if (spec.i2cA4) groups.push(['SDA', 'A4'], ['SCL', 'A5']);
    // Mega: the SDA/SCL pins by AREF are pins 20/21; the 5 V pins of the double header are 5 V
    if (spec.layout === 'mega') groups.push(['SDA', 'D20'], ['SCL', 'D21'], ['5V', '5V_1', '5V_2']);
    spec.i2c = spec.layout === 'nano' ? { sda: 'A4', scl: 'A5' } : { sda: 'SDA', scl: 'SCL' };
    WB.defPart(type, {
      label: spec.label, category: 'Boards', prefix: 'U', dynamic: true, layer: 1, board: spec,
      pins: () => pinList,
      groundPins: ground,
      groups: () => groups,
      bbox: () => (spec.layout === 'nano' ? [-10, 0, 190, 80] : spec.layout === 'mega' ? [-10, 0, 410, 210] : [-10, 0, 280, 210]),
      summary: () => (spec.vcc === 3.3 ? '3.3 V logic' : '5 V logic'),
      elements(c) {
        const els = [];
        els.push({ t: 'V', a: c.n('5V'), b: 0, v: 5, r: 0.05, tag: '5V' });
        els.push({ t: 'V', a: c.n('3V3'), b: 0, v: 3.3, r: 0.1, tag: '3V3' });
        for (const name in c.sim.pins) {
          const st = c.sim.pins[name];
          const node = c.n(name);
          if (node < 0) continue;
          if (st.mode === 'OUTPUT') {
            // PWM frequency: tone() frequency, else ~490 Hz (980 Hz on pins 5/6 of AVR boards)
            const freq = st.tone || (spec.avr && (name === 'D5' || name === 'D6') ? 980 : 490);
            if (st.duty != null) els.push({ t: 'V', a: node, b: 0, v: spec.vcc, r: 25, duty: st.duty, freq, tag: 'pin:' + name });
            else els.push({ t: 'V', a: node, b: 0, v: st.value ? spec.vcc : 0, r: 25, tag: 'pin:' + name });
          } else if (st.mode === 'INPUT_PULLUP') els.push({ t: 'V', a: node, b: 0, v: spec.vcc, r: 35000, tag: 'pull:' + name });
          else if (st.mode === 'INPUT_PULLDOWN') els.push({ t: 'V', a: node, b: 0, v: 0, r: 35000, tag: 'pull:' + name });
        }
        // On-board "L" LED on pin 13 (series resistor + LED to ground)
        const m = c.newNode();
        els.push({ t: 'R', a: c.n('D13'), b: m, r: 1000 });
        els.push({ t: 'D', a: m, b: 0, vf: 1.8, rs: 10, tag: 'L' });
        return els;
      },
      visualize(c) {
        const vis = { on: true };
        for (const e of c.els) {
          if (e.tag === 'L') vis.L = +WB.clamp(Math.sqrt(Math.max(0, e.i) / 0.0012), 0, 1).toFixed(2);
          else if (e.tag && e.tag.startsWith('pin:') && Math.abs(e.ipk) > 0.03)
            c.warn(`${c.name} pin ${e.tag.slice(4)} is carrying ${Math.round(Math.abs(e.ipk) * 1000)} mA — above the safe I/O current. Add a series resistor.`);
          else if ((e.tag === '5V' || e.tag === '3V3') && Math.abs(e.i) > 0.8)
            c.warn(`Short circuit on the ${e.tag} supply of ${c.name}!`);
        }
        return vis;
      },
      render(part, vis) { return spec.layout === 'nano' ? renderNano(spec, part, vis) : spec.layout === 'mega' ? renderMega(spec, part, vis) : renderUno(spec, part, vis); },
    });
  }
})(window.WB);

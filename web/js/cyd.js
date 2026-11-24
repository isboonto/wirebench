'use strict';
// CYD — "Cheap Yellow Display" (ESP32-2432S028R): an ESP32 with a 2.8" 320 x 240 colour
// TFT (ILI9341), XPT2046 resistive touch, an RGB LED, a light sensor (LDR) and a BOOT button,
// all on one board. Simulated:
//   - the screen, drawn with the TFT_eSPI library (shapes, text in fonts 1/2/4/6/7/8, rotation);
//     GPIO21 is the backlight, as on the real board (tft.init() switches it on);
//   - the touch screen with the XPT2046_Touchscreen library (raw readings like the real panel);
//   - RGB LED on GPIO 4 / 16 / 17 (active LOW), LDR on GPIO34, BOOT button on GPIO0,
//     speaker connector driven by GPIO26 (tone());
//   - the connectors P1 (VIN, TX, RX, GND), P3 (GND, IO35, IO22, IO21) and CN1 (GND, IO22, IO27, 3.3V);
//   - ESP32 functions: ledc PWM, 12-bit analogRead, Serial2 on any pins, ESP.* basics.
(function (WB) {
  const W = 320, H = 240, K = 0.75;          // screen pixels; part units per pixel
  const SX = 16, SY = 14;                      // screen top-left on the board
  const BW = 336, BH = 252;                    // board outline

  // ---------------------------------------------------------------- the board spec
  const spec = {
    label: 'CYD — ESP32 Cheap Yellow Display (ESP32-2432S028R)', short: 'CYD', layout: 'cyd', vcc: 3.3, esp32: true, cyd: true,
    digitalCount: 40, analogCount: 0, analogBase: 100, adcBits: 12,
    adcPins: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33, 34, 35, 36, 39],
    inputOnly: [34, 35, 36, 39],
    pwm: [0, 1, 3, 4, 16, 17, 21, 22, 26, 27],
    reserved: { 2: 'the display (DC)', 12: 'the display (MISO)', 13: 'the display (MOSI)', 14: 'the display (SCK)', 15: 'the display (CS)',
      25: 'the touch controller (CLK)', 32: 'the touch controller (MOSI)', 33: 'the touch controller (CS)', 36: 'the touch controller (IRQ)', 39: 'the touch controller (MISO)',
      5: 'the SD card (CS)', 18: 'the SD card (SCK)', 19: 'the SD card (MISO)', 23: 'the SD card (MOSI)', 6: 'the flash memory', 7: 'the flash memory', 8: 'the flash memory', 9: 'the flash memory', 10: 'the flash memory', 11: 'the flash memory' },
    serialPins: ['D3', 'D1'],
    i2c: { sda: 'D27', scl: 'D22' },
    pcb: '#e8c21c', silk: '#3a3000',
    info: 'ESP32 (240 MHz, Wi-Fi/Bluetooth not simulated), 3.3 V logic, 12-bit ADC. 2.8" 320×240 touch screen (TFT_eSPI + XPT2046_Touchscreen libraries; GPIO21 = backlight), RGB LED on 4/16/17 (LOW = on), light sensor on 34, BOOT button on 0, speaker on 26. Free pins on the connectors: IO35 (input only), IO22, IO27, IO21 (shared with the backlight), TX/RX.',
  };
  WB.BOARDS['board-cyd'] = spec;

  // Connectors along the bottom edge; on-board parts as hidden pins (off the 0.1" grid so
  // nothing on the breadboard can touch them).
  const CONN = [
    { name: 'P1', x: 40, pins: [['VIN', 'VIN (5 V in)'], ['D1', 'TX · GPIO1 (Serial)'], ['D3', 'RX · GPIO3 (Serial)'], ['GND', 'GND']] },
    { name: 'P3', x: 120, pins: [['GND2', 'GND'], ['D35', 'IO35 (input only, analog)'], ['D22', 'IO22'], ['D21', 'IO21 (also the screen backlight)']] },
    { name: 'CN1', x: 200, pins: [['GND3', 'GND'], ['D22_2', 'IO22'], ['D27', 'IO27 (analog)'], ['3V3', '3.3 V out']] },
  ];
  const HIDDEN = [['D0', 'BOOT button (GPIO0)'], ['D4', 'RGB LED red (GPIO4, LOW = on)'], ['D16', 'RGB LED green (GPIO16, LOW = on)'],
    ['D17', 'RGB LED blue (GPIO17, LOW = on)'], ['D34', 'light sensor (GPIO34)'], ['D26', 'speaker (GPIO26)']];
  const PINS = [];
  for (const c of CONN) c.pins.forEach(([id, label], i) => PINS.push({ id, label, x: c.x + i * 10, y: 240, short: id.replace(/^D(\d+).*/, 'IO$1').replace(/^GND\d/, 'GND'), side: 'bot',
    kind: /^GND/.test(id) ? 'gnd' : id === 'VIN' || id === '3V3' ? 'pwr' : undefined }));
  HIDDEN.forEach(([id, label], i) => PINS.push({ id, label, x: 303 + i, y: 7, hidden: true }));

  const css565 = (c) => {
    c = Math.trunc(Number(c)) & 0xffff;
    return `rgb(${Math.round((((c >> 11) & 31) * 255) / 31)},${Math.round((((c >> 5) & 63) * 255) / 63)},${Math.round(((c & 31) * 255) / 31)})`;
  };

  // ---------------------------------------------------------------- screen device
  // The panel is drawn on a 320 x 240 canvas in its landscape orientation (rotation 1).
  function screenOf(sim) {
    if (!sim.cyd) {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      sim.cyd = { cv, ctx, ver: 1, url: null, urlVer: 0, invert: false };
    }
    return sim.cyd;
  }
  function screenURL(d) {
    if (d.urlVer !== d.ver) { d.url = d.cv.toDataURL('image/png'); d.urlVer = d.ver; }
    return d.url;
  }

  // rotation -> canvas transform, logical size
  const ROT = [
    { w: 240, h: 320, m: [0, -1, 1, 0, 0, 240] },
    { w: 320, h: 240, m: [1, 0, 0, 1, 0, 0] },
    { w: 240, h: 320, m: [0, 1, -1, 0, 320, 0] },
    { w: 320, h: 240, m: [-1, 0, 0, -1, 320, 240] },
  ];
  // landscape panel point -> logical point for a rotation (inverse of the transforms above)
  const toLogical = (r, X, Y) => (r === 1 ? [X, Y] : r === 3 ? [W - 1 - X, H - 1 - Y] : r === 0 ? [H - 1 - Y, X] : [Y, W - 1 - X]);

  // TFT_eSPI fonts: height in pixels at size 1, and how they are drawn here
  const FONTS = {
    1: { h: 8, mono: true },
    2: { h: 16, px: 14, fam: 'Arial, Helvetica, sans-serif' },
    4: { h: 26, px: 23, fam: 'Arial, Helvetica, sans-serif' },
    6: { h: 48, px: 44, fam: 'Arial, Helvetica, sans-serif' },
    7: { h: 48, px: 46, fam: '"Courier New", monospace', bold: true },
    8: { h: 75, px: 70, fam: 'Arial, Helvetica, sans-serif' },
  };

  const TFT_COLORS = {
    TFT_BLACK: 0x0000, TFT_NAVY: 0x000f, TFT_DARKGREEN: 0x03e0, TFT_DARKCYAN: 0x03ef, TFT_MAROON: 0x7800, TFT_PURPLE: 0x780f,
    TFT_OLIVE: 0x7be0, TFT_LIGHTGREY: 0xd69a, TFT_DARKGREY: 0x7bef, TFT_BLUE: 0x001f, TFT_GREEN: 0x07e0, TFT_CYAN: 0x07ff,
    TFT_RED: 0xf800, TFT_MAGENTA: 0xf81f, TFT_YELLOW: 0xffe0, TFT_WHITE: 0xffff, TFT_ORANGE: 0xfda0, TFT_GREENYELLOW: 0xb7e0,
    TFT_PINK: 0xfe19, TFT_BROWN: 0x9a60, TFT_GOLD: 0xfea0, TFT_SILVER: 0xc618, TFT_SKYBLUE: 0x867d, TFT_VIOLET: 0x915c, TFT_TRANSPARENT: 0x0120,
  };
  const DATUMS = { TL_DATUM: 0, TC_DATUM: 1, TR_DATUM: 2, ML_DATUM: 3, CL_DATUM: 3, MC_DATUM: 4, CC_DATUM: 4, MR_DATUM: 5, CR_DATUM: 5,
    BL_DATUM: 6, BC_DATUM: 7, BR_DATUM: 8, L_BASELINE: 9, C_BASELINE: 10, R_BASELINE: 11 };

  // ---------------------------------------------------------------- sketch API
  function extendApi(api, rt) {
    const fmt = WB.rtFmt.fmtNum, cprintf = WB.rtFmt.cprintf;
    const num = (v) => Math.trunc(Number(v)) || 0;
    Object.assign(api, TFT_COLORS, DATUMS, { TFT_WIDTH: 240, TFT_HEIGHT: 320, VSPI: 3, HSPI: 2, FSPI: 1, SPI_MODE0: 0, SPI_MODE1: 1, SPI_MODE2: 2, SPI_MODE3: 3 });

    class TFT {
      constructor() {
        this.rot = 0; this.cx = 0; this.cy = 0; this.fg = 0xffff; this.bg = 0xffff; this.size = 1; this.font = 1;
        this.datum = 0; this.wrapX = true; this.pad = 0;
      }
      get d() { return screenOf(rt.sim); }
      get ctx() {
        if (!rt.running) throw WB.STOP;
        const c = this.d.ctx;
        c.setTransform(...ROT[this.rot].m);
        return c;
      }
      done() { this.d.ver++; rt.dirty(); }
      // lifecycle
      init() {
        const st = rt.pinState('D21');      // backlight on (TFT_BL = 21, TFT_BACKLIGHT_ON = HIGH)
        st.mode = 'OUTPUT'; st.value = 1; st.duty = null;
        this.done();
      }
      begin() { this.init(); }
      setRotation(r) { this.rot = ((num(r) % 4) + 4) % 4; }
      getRotation() { return this.rot; }
      width() { return ROT[this.rot].w; }
      height() { return ROT[this.rot].h; }
      invertDisplay(i) { this.d.invert = !!i; this.done(); }
      setSwapBytes() {} getSwapBytes() { return false; } startWrite() {} endWrite() {} setViewport() {} resetViewport() {}
      color565(r, g, b) { return ((num(r) & 0xf8) << 8) | ((num(g) & 0xfc) << 3) | (num(b) >> 3); }
      color24to16(c) { c = num(c); return this.color565((c >> 16) & 255, (c >> 8) & 255, c & 255); }
      // pixels and shapes
      fill(c) { const x = this.ctx; x.fillStyle = css565(c); return x; }
      fillScreen(c) { this.fill(c).fillRect(0, 0, this.width(), this.height()); this.done(); }
      drawPixel(x, y, c) { this.fill(c).fillRect(num(x), num(y), 1, 1); this.done(); }
      readPixel(x, y) {
        let [X, Y] = [num(x), num(y)];
        const m = ROT[this.rot].m;
        const px = m[0] * X + m[2] * Y + m[4], py = m[1] * X + m[3] * Y + m[5];
        const R = this.rot === 0 ? [px, py - 1] : this.rot === 2 ? [px - 1, py] : this.rot === 3 ? [px - 1, py - 1] : [px, py];
        const p = this.d.ctx.getImageData(R[0], R[1], 1, 1).data;
        return this.color565(p[0], p[1], p[2]);
      }
      fillRect(x, y, w, h, c) { if (num(w) > 0 && num(h) > 0) this.fill(c).fillRect(num(x), num(y), num(w), num(h)); this.done(); }
      drawFastHLine(x, y, w, c) { this.fillRect(x, y, w, 1, c); }
      drawFastVLine(x, y, h, c) { this.fillRect(x, y, 1, h, c); }
      drawRect(x, y, w, h, c) {
        [x, y, w, h] = [x, y, w, h].map(num);
        if (w <= 0 || h <= 0) return;
        const g = this.fill(c);
        g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
        this.done();
      }
      linePx(g, x0, y0, x1, y1) {
        [x0, y0, x1, y1] = [x0, y0, x1, y1].map(num);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let e = dx + dy, n = 0;
        for (;;) {
          g.fillRect(x0, y0, 1, 1);
          if ((x0 === x1 && y0 === y1) || ++n > 4000) break;
          const e2 = 2 * e;
          if (e2 >= dy) { e += dy; x0 += sx; }
          if (e2 <= dx) { e += dx; y0 += sy; }
        }
      }
      drawLine(x0, y0, x1, y1, c) { this.linePx(this.fill(c), x0, y0, x1, y1); this.done(); }
      drawWideLine(x0, y0, x1, y1, w, c) {
        const g = this.ctx;
        g.strokeStyle = css565(c); g.lineWidth = Math.max(1, Number(w) || 1); g.lineCap = 'round';
        g.beginPath(); g.moveTo(Number(x0) + 0.5, Number(y0) + 0.5); g.lineTo(Number(x1) + 0.5, Number(y1) + 0.5); g.stroke();
        this.done();
      }
      drawCircle(x0, y0, r, c) {
        [x0, y0, r] = [x0, y0, r].map(num);
        const g = this.fill(c);
        let x = r, y = 0, err = 1 - r;
        while (x >= y) {
          for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) g.fillRect(x0 + a, y0 + b, 1, 1);
          y++;
          if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
        }
        this.done();
      }
      fillCircle(x0, y0, r, c) {
        [x0, y0, r] = [x0, y0, r].map(num);
        const g = this.fill(c);
        for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y) + 0.5); g.fillRect(x0 - w, y0 + y, 2 * w + 1, 1); }
        this.done();
      }
      fillSmoothCircle(x, y, r, c) { this.fillCircle(x, y, r, c); }
      drawSmoothCircle(x, y, r, c) { this.drawCircle(x, y, r, c); }
      path(build, c, fill) {
        const g = this.ctx;
        g.beginPath(); build(g);
        if (fill) { g.fillStyle = css565(c); g.fill(); } else { g.strokeStyle = css565(c); g.lineWidth = 1; g.stroke(); }
        this.done();
      }
      drawEllipse(x, y, rx, ry, c) { this.path((g) => g.ellipse(num(x) + 0.5, num(y) + 0.5, Math.abs(num(rx)), Math.abs(num(ry)), 0, 0, Math.PI * 2), c, false); }
      fillEllipse(x, y, rx, ry, c) { this.path((g) => g.ellipse(num(x) + 0.5, num(y) + 0.5, Math.abs(num(rx)) + 0.5, Math.abs(num(ry)) + 0.5, 0, 0, Math.PI * 2), c, true); }
      drawTriangle(x0, y0, x1, y1, x2, y2, c) { const g = this.fill(c); this.linePx(g, x0, y0, x1, y1); this.linePx(g, x1, y1, x2, y2); this.linePx(g, x2, y2, x0, y0); this.done(); }
      fillTriangle(x0, y0, x1, y1, x2, y2, c) {
        this.path((g) => { g.moveTo(num(x0) + 0.5, num(y0) + 0.5); g.lineTo(num(x1) + 0.5, num(y1) + 0.5); g.lineTo(num(x2) + 0.5, num(y2) + 0.5); g.closePath(); }, c, true);
        this.drawTriangle(x0, y0, x1, y1, x2, y2, c);
      }
      rrect(g, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      }
      drawRoundRect(x, y, w, h, r, c) { this.path((g) => this.rrect(g, num(x) + 0.5, num(y) + 0.5, num(w) - 1, num(h) - 1, num(r)), c, false); }
      fillRoundRect(x, y, w, h, r, c) { this.path((g) => this.rrect(g, num(x), num(y), num(w), num(h), num(r)), c, true); }
      fillSmoothRoundRect(x, y, w, h, r, c) { this.fillRoundRect(x, y, w, h, r, c); }
      // TFT_eSPI arcs: angles in degrees, 0 = straight down (6 o'clock), clockwise
      drawArc(x, y, r, ir, a0, a1, fg, bg) {
        const s = ((Number(a0) + 90) * Math.PI) / 180, e = ((Number(a1) + 90) * Math.PI) / 180;
        this.path((g) => { g.arc(num(x) + 0.5, num(y) + 0.5, num(r), s, e); g.arc(num(x) + 0.5, num(y) + 0.5, Math.max(0, num(ir)), e, s, true); g.closePath(); }, fg, true);
      }
      drawSmoothArc(x, y, r, ir, a0, a1, fg, bg) { this.drawArc(x, y, r, ir, a0, a1, fg, bg); }
      fillRectVGradient(x, y, w, h, c1, c2) { this.grad(x, y, w, h, c1, c2, true); }
      fillRectHGradient(x, y, w, h, c1, c2) { this.grad(x, y, w, h, c1, c2, false); }
      grad(x, y, w, h, c1, c2, vert) {
        [x, y, w, h] = [x, y, w, h].map(num);
        const g = this.ctx;
        const gr = vert ? g.createLinearGradient(0, y, 0, y + h) : g.createLinearGradient(x, 0, x + w, 0);
        gr.addColorStop(0, css565(c1)); gr.addColorStop(1, css565(c2));
        g.fillStyle = gr; g.fillRect(x, y, w, h);
        this.done();
      }
      // text
      F(f) { return FONTS[f === undefined ? this.font : num(f)] || FONTS[1]; }
      setCursor(x, y, f) { this.cx = num(x); this.cy = num(y); if (f !== undefined) this.setTextFont(f); }
      getCursorX() { return this.cx; }
      getCursorY() { return this.cy; }
      setTextColor(fg, bg) { this.fg = num(fg) & 0xffff; this.bg = bg === undefined ? this.fg : num(bg) & 0xffff; }
      setTextSize(s) { this.size = WB.clamp(num(s), 1, 7); }
      setTextFont(f) {
        f = num(f);
        if (!FONTS[f]) { rt.warnOnce('tftfont' + f, `TFT_eSPI: font ${f} is not loaded — the fonts are 1, 2, 4, 6, 7 and 8 (font 1 is used).`); f = 1; }
        this.font = f;
      }
      setTextDatum(d) { this.datum = WB.clamp(num(d), 0, 11); }
      getTextDatum() { return this.datum; }
      setTextWrap(x) { this.wrapX = !!x; }
      setTextPadding(p) { this.pad = Math.max(0, num(p)); }
      setFreeFont() { rt.warnOnce('freefont', 'TFT_eSPI: FreeFonts are not simulated — use setTextFont(1, 2, 4, 6, 7 or 8).'); }
      fontHeight(f) { return this.F(f).h * this.size; }
      textWidth(s, f) {
        s = fmt(s);
        const F = this.F(f);
        if (F.mono) return s.length * 6 * this.size;
        const g = this.d.ctx;
        g.font = `${F.bold ? 'bold ' : ''}${F.px * this.size}px ${F.fam}`;
        return Math.round(g.measureText(s).width);
      }
      glyphs(s, x, y, f) {
        // text with its top-left corner at x, y in font f; background filled if a background colour is set
        const F = this.F(f), g = this.ctx, sz = this.size, h = F.h * sz, w = this.textWidth(s, f);
        if (this.bg !== this.fg) { g.fillStyle = css565(this.bg); g.fillRect(x, y, Math.max(w, this.pad), h); }
        g.fillStyle = css565(this.fg);
        g.textBaseline = 'top';
        if (F.mono) {
          g.font = `bold ${9 * sz}px "Courier New", monospace`;
          for (let i = 0; i < s.length; i++) g.fillText(s[i], x + i * 6 * sz, y);
        } else {
          g.font = `${F.bold ? 'bold ' : ''}${F.px * sz}px ${F.fam}`;
          g.fillText(s, x, y + (F.h - F.px) * sz * 0.5);
        }
        return w;
      }
      emit(s) {
        const F = this.F(), sz = this.size, lh = F.h * sz;
        for (const part of String(s).split(/(\n)/)) {
          if (part === '\n') { this.cx = 0; this.cy += lh; continue; }
          if (part === '\r' || !part) continue;
          let rest = part.replace(/\r/g, '');
          while (rest.length) {
            let n = rest.length;
            if (this.wrapX) {
              while (n > 1 && this.cx + this.textWidth(rest.slice(0, n)) > this.width()) n--;
              if (this.cx > 0 && this.cx + this.textWidth(rest[0]) > this.width()) { this.cx = 0; this.cy += lh; continue; }
            }
            this.cx += this.glyphs(rest.slice(0, n), this.cx, this.cy);
            rest = rest.slice(n);
            if (rest.length) { this.cx = 0; this.cy += lh; }
          }
        }
        this.done();
      }
      print(v, f) { const s = fmt(v, f); this.emit(s); return s.length; }
      println(v, f) { const s = (v === undefined ? '' : fmt(v, f)) + '\n'; this.emit(s); return s.length; }
      printf(f, ...a) { const s = cprintf(f, a); this.emit(s); return s.length; }
      write(c) { this.emit(typeof c === 'number' ? String.fromCharCode(c) : fmt(c)); return 1; }
      drawString(s, x, y, f) {
        s = fmt(s);
        const F = this.F(f), w = this.textWidth(s, f), h = F.h * this.size;
        x = num(x); y = num(y);
        const d = this.datum, col = d % 3 === 1 || d === 10 ? 1 : d % 3 === 2 || d === 11 ? 2 : 0;
        if (d >= 9) { x -= col === 1 ? w / 2 : col === 2 ? w : 0; y -= Math.round(h * 0.75); }
        else { x -= col === 1 ? w / 2 : col === 2 ? w : 0; y -= d >= 6 ? h : d >= 3 ? h / 2 : 0; }
        // padding: clears the area a longer old string may have left (centre/right datums pad around)
        if (this.pad > w && this.bg !== this.fg) {
          const g = this.ctx;
          g.fillStyle = css565(this.bg);
          const px = col === 1 ? x - (this.pad - w) / 2 : col === 2 ? x - (this.pad - w) : x;
          g.fillRect(Math.round(px), Math.round(y), this.pad, h);
        }
        this.glyphs(s, Math.round(x), Math.round(y), f);
        this.done();
        return w;
      }
      drawCentreString(s, x, y, f) { const d = this.datum; this.datum = 1; const w = this.drawString(s, x, y, f); this.datum = d; return w; }
      drawCenterString(s, x, y, f) { return this.drawCentreString(s, x, y, f); }
      drawRightString(s, x, y, f) { const d = this.datum; this.datum = 2; const w = this.drawString(s, x, y, f); this.datum = d; return w; }
      drawNumber(n, x, y, f) { return this.drawString(String(Math.trunc(Number(n) || 0)), x, y, f); }
      drawFloat(v, dp, x, y, f) { return this.drawString((Number(v) || 0).toFixed(WB.clamp(num(dp), 0, 7)), x, y, f); }
      drawChar(a, b, c, color, bg, size) {
        if (size !== undefined) {   // Adafruit-style drawChar(x, y, char, color, bg, size)
          const keep = [this.fg, this.bg, this.size, this.font];
          this.fg = num(color) & 0xffff; this.bg = num(bg) & 0xffff; this.size = WB.clamp(num(size), 1, 7); this.font = 1;
          this.glyphs(typeof c === 'number' ? String.fromCharCode(c) : String(c)[0] || ' ', num(a), num(b), 1);
          [this.fg, this.bg, this.size, this.font] = keep;
          this.done(); return 6 * num(size);
        }
        const ch = typeof a === 'number' ? String.fromCharCode(a) : String(a)[0] || ' ';
        const keep = this.datum; this.datum = 0;
        const w = this.drawString(ch, b, c, color); this.datum = keep;
        return w;
      }
    }
    const tftFactory = function () { return new TFT(); };
    api.TFT_eSPI = tftFactory;

    // ---------------- XPT2046 touch controller
    class TSPoint { constructor(x, y, z) { this.x = num(x); this.y = num(y); this.z = num(z); } }
    api.TS_Point = function (x, y, z) { return new TSPoint(x, y, z); };
    const touchNow = () => { const t = rt.app.transient[rt.board.id]; return t && t.touch; };
    class Touch {
      constructor() { this.rot = 1; }
      begin() { return true; }
      setRotation(r) { this.rot = ((num(r) % 4) + 4) % 4; }
      touched() { if (!rt.running) throw WB.STOP; return !!touchNow(); }
      tirqTouched() { return this.touched(); }
      bufferEmpty() { return !this.touched(); }
      bufferSize() { return this.touched() ? 1 : 0; }
      getPoint() {
        const t = touchNow();
        if (!t) return new TSPoint(0, 0, 0);
        // raw 12-bit readings across the panel, as the CYD's XPT2046 gives them (about 200…3700 / 240…3800)
        const r = ROT[this.rot], [x, y] = toLogical(this.rot, t[0], t[1]);
        const jit = () => Math.round((Math.random() - 0.5) * 16);
        return new TSPoint(200 + Math.round((x / r.w) * 3500) + jit(), 240 + Math.round((y / r.h) * 3560) + jit(), 900 + Math.round(Math.random() * 300));
      }
    }
    api.XPT2046_Touchscreen = function () { return new Touch(); };

    // ---------------- SPI (the screen and touch buses are internal, so this only needs to exist)
    const spiObj = () => ({ begin() {}, end() {}, transfer() { return 0; }, transfer16() { return 0; }, beginTransaction() {}, endTransaction() {}, setFrequency() {}, setDataMode() {}, setBitOrder() {} });
    api.SPIClass = function () { return spiObj(); };
    api.SPI = spiObj();
    api.SPISettings = function () { return {}; };

    // ---------------- ESP32 extras
    const chans = {};            // LEDC channel -> { res, pins:Set }
    const pinRes = {};           // pin -> PWM resolution (ledcAttach, core 3.x)
    const setDuty = (p, duty, res) => {
      const n = rt.need(p), st = rt.pinState(n), max = Math.pow(2, res) - 1;
      duty = WB.clamp(num(duty), 0, max);
      st.mode = 'OUTPUT'; st.tone = null;
      if (duty === 0) { st.duty = null; st.value = 0; } else if (duty >= max) { st.duty = null; st.value = 1; } else { st.duty = duty / max; st.value = 1; }
      rt.dirty();
    };
    api.ledcSetup = (ch, freq, res) => { chans[num(ch)] = { res: num(res) || 8, pins: new Set() }; return freq; };
    api.ledcAttachPin = (p, ch) => { ch = num(ch); (chans[ch] = chans[ch] || { res: 8, pins: new Set() }).pins.add(num(p)); rt.need(p); };
    api.ledcAttach = (p, freq, res) => { rt.need(p); pinRes[num(p)] = num(res) || 8; return true; };
    api.ledcAttachChannel = (p, freq, res, ch) => { api.ledcSetup(ch, freq, res); api.ledcAttachPin(p, ch); return true; };
    api.ledcDetach = (p) => { delete pinRes[num(p)]; return true; };
    api.ledcDetachPin = (p) => { for (const c of Object.values(chans)) c.pins.delete(num(p)); };
    api.ledcWrite = (x, duty) => {
      x = num(x);
      if (pinRes[x] !== undefined) return setDuty(x, duty, pinRes[x]);
      const c = chans[x];
      if (c && c.pins.size) { for (const p of c.pins) setDuty(p, duty, c.res); return; }
      rt.warnOnce('ledc' + x, `ledcWrite(${x}, …): attach the pin first — ledcAttach(pin, freq, bits) (ESP32 core 3) or ledcSetup + ledcAttachPin (core 2).`);
    };
    api.ledcWriteTone = (x, f) => { x = num(x); const pins = pinRes[x] !== undefined ? [x] : chans[x] ? [...chans[x].pins] : []; for (const p of pins) (f ? api.tone(p, f) : api.noTone(p)); return f; };
    api.dacWrite = (p, v) => { if (![25, 26].includes(num(p))) throw new Error(`dacWrite(${p}): the ESP32's DAC is on pins 25 and 26 only`); setDuty(p, v, 8); };
    api.esp_random = () => Math.floor(Math.random() * 4294967296);
    api.esp_timer_get_time = () => Math.floor(rt.millis() * 1000);
    api.temperatureRead = () => 45 + Math.random();
    api.ESP = {
      getFreeHeap: () => 250000 + Math.floor(Math.random() * 2000), getHeapSize: () => 327680, getChipModel: () => 'ESP32-D0WD-V3', getChipRevision: () => 3,
      getCpuFreqMHz: () => 240, getFlashChipSize: () => 4194304, getEfuseMac: () => 0x1234567890ab, getSdkVersion: () => 'v4.4 (simulated)',
      restart: () => { rt.warnOnce('esprestart', 'ESP.restart(): the sketch stops here — press Run to start it again.'); throw WB.STOP; },
    };
  }

  // ---------------------------------------------------------------- drawing the board
  const T = (x, y, s, txt, fill, extra) => `<text x="${x}" y="${y}" font-size="${s}" text-anchor="middle" fill="${fill}" font-family="sans-serif"${extra || ''}>${txt}</text>`;
  const LIVE = { d: null };

  WB.defPart('board-cyd', {
    label: spec.label, category: 'Boards', prefix: 'U', dynamic: true, layer: 1, board: spec, interact: 'touch',
    defaults: { light: 60 },
    knob: { key: 'light', min: 0, max: 100, fmt: (v) => 'light ' + Math.round(v) + '%' },
    pins: () => PINS,
    groundPins: ['GND', 'GND2', 'GND3'],
    groups: () => [['D22', 'D22_2']],
    bbox: () => [-4, 0, BW + 10, BH + 2],
    summary: () => '3.3 V logic · 320×240 touch screen',
    // what is under the pointer (part coordinates): the screen, the BOOT button or the light sensor
    hit(lx, ly) {
      if (lx >= SX && ly >= SY && lx <= SX + W * K && ly <= SY + H * K) return { k: 'screen', x: WB.clamp(Math.floor((lx - SX) / K), 0, W - 1), y: WB.clamp(Math.floor((ly - SY) / K), 0, H - 1) };
      if (Math.hypot(lx - 284, ly - 168) < 10) return { k: 'boot' };
      if (Math.hypot(lx - 296, ly - 44) < 12) return { k: 'ldr' };
      return null;
    },
    elements(c) {
      const els = [];
      els.push({ t: 'V', a: c.n('VIN'), b: 0, v: 5, r: 0.05, tag: '5V' });
      els.push({ t: 'V', a: c.n('3V3'), b: 0, v: 3.3, r: 0.1, tag: '3V3' });
      for (const name in c.sim.pins) {
        const st = c.sim.pins[name];
        const node = c.n(name);
        if (node < 0) continue;
        if (st.mode === 'OUTPUT') {
          if (st.duty != null) els.push({ t: 'V', a: node, b: 0, v: 3.3, r: 30, duty: st.duty, freq: st.tone || 1000, tag: 'pin:' + name });
          else els.push({ t: 'V', a: node, b: 0, v: st.value ? 3.3 : 0, r: 30, tag: 'pin:' + name });
        } else if (st.mode === 'INPUT_PULLUP') els.push({ t: 'V', a: node, b: 0, v: 3.3, r: 45000, tag: 'pull:' + name });
        else if (st.mode === 'INPUT_PULLDOWN') els.push({ t: 'V', a: node, b: 0, v: 0, r: 45000, tag: 'pull:' + name });
      }
      // RGB LED: common anode on 3.3 V, each cathode through a resistor to its pin (LOW = on)
      const v33 = c.n('3V3');
      [['D4', 1.8, 'R'], ['D16', 2.4, 'G'], ['D17', 2.4, 'B']].forEach(([pin, vf, tag]) => {
        const m = c.newNode();
        els.push({ t: 'D', a: v33, b: m, vf, rs: 10, tag: 'rgb' + tag });
        els.push({ t: 'R', a: m, b: c.n(pin), r: 1000 });
      });
      // light sensor: 100 kΩ from 3.3 V, LDR to ground — more light, lower reading
      const light = WB.clamp(Number(c.props.light), 0, 100);
      els.push({ t: 'R', a: v33, b: c.n('D34'), r: 100000 });
      els.push({ t: 'R', a: c.n('D34'), b: 0, r: 1e6 * Math.pow(10, (-2.3 * (Number.isFinite(light) ? light : 60)) / 100) });
      // BOOT button on GPIO0 with its 10 kΩ pull-up
      els.push({ t: 'R', a: v33, b: c.n('D0'), r: 10000 });
      if (c.ui.pressed) els.push({ t: 'R', a: c.n('D0'), b: 0, r: 50 });
      return els;
    },
    visualize(c) {
      const vis = { on: true };
      for (const e of c.els) {
        if (e.tag && e.tag.startsWith('rgb')) vis[e.tag] = +WB.clamp(Math.sqrt(Math.max(0, e.i) / 0.0012), 0, 1).toFixed(2);
        else if (e.tag && e.tag.startsWith('pin:') && Math.abs(e.ipk) > 0.03)
          c.warn(`${c.name} pin ${e.tag.slice(4)} is carrying ${Math.round(Math.abs(e.ipk) * 1000)} mA — above the safe I/O current. Add a series resistor.`);
        else if ((e.tag === '5V' || e.tag === '3V3') && Math.abs(e.i) > 0.8) c.warn(`Short circuit on the ${e.tag} supply of ${c.name}!`);
      }
      const bl = c.sim.pins.D21;
      vis.bl = bl && bl.mode === 'OUTPUT' ? (bl.duty != null ? +bl.duty.toFixed(2) : bl.value) : 0;
      const sp = c.sim.pins.D26;
      if (sp && sp.tone) vis.freq = sp.tone;
      if (c.sim.cyd) { vis.ver = c.sim.cyd.ver; vis.inv = c.sim.cyd.invert; if (WB.app && c.sim === WB.app.sim) LIVE.d = c.sim.cyd; }
      return vis;
    },
    render(part, vis) {
      vis = vis || {};
      const S = spec.silk;
      const sw = W * K, sh = H * K;
      const lit = vis.bl || 0;
      const d = vis.ver !== undefined ? LIVE.d : null;
      let screen = `<rect x="${SX}" y="${SY}" width="${sw}" height="${sh}" fill="#07080a"/>`;
      if (d && lit > 0) {
        screen += `<image x="${SX}" y="${SY}" width="${sw}" height="${sh}" href="${screenURL(d)}" preserveAspectRatio="none" style="image-rendering:pixelated${vis.inv ? ';filter:invert(1)' : ''}"/>`;
        if (lit < 1) screen += `<rect x="${SX}" y="${SY}" width="${sw}" height="${sh}" fill="#000" opacity="${(1 - lit).toFixed(2)}"/>`;
      } else if (!d) screen += `<path d="M${SX + 10},${SY + sh - 10} L${SX + sw * 0.45},${SY + 10}" stroke="#ffffff10" stroke-width="40"/>${T(SX + sw / 2, SY + sh / 2 + 3, 9, '320 × 240 touch screen', '#3b4048')}`;
      const led = (x, y, r, g, b) => {
        const on = r + g + b > 0.03, col = `rgb(${Math.round(255 * Math.min(1, r * 1.2))},${Math.round(255 * Math.min(1, g * 1.2))},${Math.round(255 * Math.min(1, b * 1.2))})`;
        return `${on ? `<circle cx="${x}" cy="${y}" r="${7 + 5 * Math.max(r, g, b)}" fill="${col}" opacity=".55" filter="url(#wbGlow)"/>` : ''}
          <rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1" fill="${on ? col : '#f2f0ea'}" stroke="#0005" stroke-width=".5"/>`;
      };
      let conn = '';
      for (const cn of CONN) {
        conn += `<rect x="${cn.x - 6}" y="234" width="${(cn.pins.length - 1) * 10 + 12}" height="12" rx="1.5" fill="#f4f2ea" stroke="#9a968a"/><text x="${cn.x - 9}" y="243" font-size="5.5" text-anchor="end" fill="${S}" font-family="sans-serif" font-weight="700">${cn.name}</text>`;
        cn.pins.forEach(([id], i) => {
          const p = PINS.find((q) => q.id === id);
          conn += `<rect x="${cn.x + i * 10 - 2.5}" y="237.5" width="5" height="5" fill="#000"/><text transform="translate(${cn.x + i * 10 + 1.8},231) rotate(-90)" font-size="4.6" fill="${S}" font-family="monospace">${p.short}</text>`;
        });
      }
      const pressed = vis.pressed;
      return `<rect x="0" y="0" width="${BW}" height="${BH}" rx="5" fill="${spec.pcb}" stroke="#8a7210"/>
        <circle cx="8" cy="8" r="3.5" fill="#f6f1d8" stroke="#a8901c"/><circle cx="${BW - 8}" cy="8" r="3.5" fill="#f6f1d8" stroke="#a8901c"/>
        <circle cx="8" cy="${BH - 8}" r="3.5" fill="#f6f1d8" stroke="#a8901c"/><circle cx="${BW - 8}" cy="${BH - 8}" r="3.5" fill="#f6f1d8" stroke="#a8901c"/>
        <rect x="${SX - 6}" y="${SY - 6}" width="${sw + 12}" height="${sh + 16}" rx="2" fill="#16181c"/>
        ${screen}
        <rect x="${BW - 4}" y="96" width="12" height="24" rx="2" fill="#c9cdd2" stroke="#7d8287"/>
        <circle cx="296" cy="44" r="7" fill="#c9673a" stroke="#6b3a1d"/><path d="M291,41 h10 M291,44 h10 M291,47 h10" stroke="#f2d08a" stroke-width="1"/>
        ${T(296, 61, 5, 'LDR · IO34', S)}
        ${led(296, 88, vis.rgbR || 0, vis.rgbG || 0, vis.rgbB || 0)}
        ${T(296, 104, 5, 'RGB · 4/16/17', S)}
        <rect x="276" y="160" width="16" height="16" rx="2" fill="#d9d9d9" stroke="#777"/><circle cx="284" cy="168" r="5" fill="${pressed ? '#555' : '#2b2b2b'}"/>${T(284, 186, 5, 'BOOT', S)}
        <rect x="300" y="160" width="16" height="16" rx="2" fill="#d9d9d9" stroke="#777"/><circle cx="308" cy="168" r="5" fill="#2b2b2b"/>${T(308, 186, 5, 'RST', S)}
        <text transform="translate(${BW - 14},140) rotate(-90)" font-size="6" fill="${S}" font-family="sans-serif" font-weight="700">ESP32-2432S028R</text>
        ${T(296, 136, 5, 'P4 SPK · IO26', S)}
        ${conn}
        ${T(300, 228, 9, 'CYD', S, ' font-weight="700"')}`;
    },
  });

  WB.CYD = { extendApi, spec };
})(window.WB);

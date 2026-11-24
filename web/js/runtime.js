'use strict';
(function (WB) {
  const STOP = (WB.STOP = { wbStop: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmtNum(v, f) {
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'number') {
      if (f === undefined) return Number.isInteger(v) ? String(v) : v.toFixed(2);
      // BIN is a distinct marker so print(x, 2) means "2 decimals" (common for floats), print(x, BIN) means binary.
      if (f === 'BIN') return Math.trunc(v >>> 0).toString(2);
      if (Number.isInteger(v) && [8, 16].includes(f)) return (v < 0 ? v >>> 0 : v).toString(f).toUpperCase();
      if (Number.isInteger(v) && f === 10) return String(v);
      return v.toFixed(Math.max(0, Math.min(10, f)));
    }
    if (Array.isArray(v)) {
      let s = '';
      for (const c of v) { if (c === 0 || c === '\0') break; s += typeof c === 'number' ? String.fromCharCode(c) : c; }
      return s;
    }
    if (v === undefined || v === null) return '';
    return String(v);
  }

  function cprintf(fmt, args) {
    let i = 0;
    return String(fmt).replace(/%([-0 +#]*)(\d*)(?:\.(\d+))?([lh]*)([diufsxXcp%])/g, (m, flags, width, prec, len, conv) => {
      if (conv === '%') return '%';
      const a = args[i++];
      let s;
      switch (conv) {
        case 'd': case 'i': case 'u': s = String(Math.trunc(a)); break;
        case 'f': s = Number(a).toFixed(prec === undefined ? 6 : +prec); break;
        case 'x': s = (a >>> 0).toString(16); break;
        case 'X': s = (a >>> 0).toString(16).toUpperCase(); break;
        case 'c': s = typeof a === 'number' ? String.fromCharCode(a) : String(a); break;
        default: s = fmtNum(a);
      }
      if (width && s.length < +width) s = flags.includes('-') ? s.padEnd(+width) : s.padStart(+width, flags.includes('0') ? '0' : ' ');
      return s;
    });
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function arr(dims, init) {
    if (typeof init === 'string') return init;
    const make = (lvl, src) => {
      const n = Math.max(Number(dims[lvl]) || 0, Array.isArray(src) ? src.length : 0);
      const a = new Array(n);
      for (let i = 0; i < n; i++) {
        const s = Array.isArray(src) ? src[i] : undefined;
        a[i] = lvl < dims.length - 1 ? make(lvl + 1, s) : s === undefined ? 0 : s;
      }
      return a;
    };
    return make(0, init);
  }

  // Arduino String helpers on JS strings
  const SP = String.prototype;
  if (!SP.toInt) {
    Object.defineProperties(SP, {
      toInt: { value: function () { const n = parseInt(this, 10); return isNaN(n) ? 0 : n; } },
      toFloat: { value: function () { const n = parseFloat(this); return isNaN(n) ? 0 : n; } },
      toDouble: { value: function () { const n = parseFloat(this); return isNaN(n) ? 0 : n; } },
      equals: { value: function (o) { return String(this) === String(o); } },
      equalsIgnoreCase: { value: function (o) { return String(this).toLowerCase() === String(o).toLowerCase(); } },
      c_str: { value: function () { return String(this); } },
      compareTo: { value: function (o) { return String(this) < o ? -1 : String(this) > o ? 1 : 0; } },
    });
  }

  WB.rtFmt = { fmtNum, cprintf };

  class Runtime {
    constructor(app, boardPart, spec) {
      this.app = app;
      this.board = boardPart;
      this.spec = spec;
      this.running = true;
      this.t0 = performance.now();
      this.lastYield = performance.now();
      this.pendingIsr = [];
      this.interrupts = [];
      this.inbuf = [];
      this.adcBits = spec.adcBits || 10;
      this.pwmBits = 8;
      this.timers = new Set();
      this.rng = Math.random;
      this.warned = new Set();
      this.bridgeFns = {};
      this.lastPulse = {};
      this.inIsr = false;
    }
    get sim() { return this.app.sim; }
    millis() { return performance.now() - this.t0; }
    dirty() { this.app.markDirty(); }
    warnOnce(key, msg) { if (this.warned.has(key)) return; this.warned.add(key); this.app.log(msg, 'warn'); }

    pinName(p) {
      if (typeof p === 'string') return p;
      const n = Math.trunc(Number(p)), s = this.spec;
      // UNO-style boards: D0..D13, A0 = 14. Mega 2560: D0..D53, A0 = 54.
      if (n >= 0 && n < s.digitalCount) return 'D' + n;
      if (n >= s.analogBase && n < s.analogBase + s.analogCount) return 'A' + (n - s.analogBase);
      return null;
    }
    need(p) {
      if (!this.running) throw STOP;
      const n = this.pinName(p);
      if (!n || !WB.worldPin(this.board, n)) {
        const used = this.spec.reserved && this.spec.reserved[Math.trunc(Number(p))];
        throw new Error(used ? `GPIO${p} is used by ${used} on the ${this.spec.short} — use a free pin` : `Pin ${p} does not exist on ${this.spec.label}`);
      }
      return n;
    }
    pinState(name) { return this.sim.pins[name] || (this.sim.pins[name] = { mode: 'INPUT', value: 0, duty: null, tone: null }); }

    reading(name) { return this.app.pinReading(name); }
    levelRaw(name, forIsr) {
      const st = this.sim.pins[name];
      if (st && st.mode === 'OUTPUT') return st.duty != null ? 1 : st.value;
      const r = this.reading(name);
      if (r.floating) {
        if (forIsr) return null;
        this.warnOnce('float:' + name, `Pin ${name} is floating (not connected to anything that sets its voltage), so digitalRead() returns random values. Use INPUT_PULLUP or a pull-down resistor.`);
        return Math.random() < 0.5 ? 1 : 0;
      }
      return r.v > this.spec.vcc / 2 ? 1 : 0;
    }

    onSolved() {
      for (const it of this.interrupts) {
        const l = this.levelRaw(it.pin, true);
        if (l === null) continue;
        if (it.last !== undefined && l !== it.last) {
          if (it.mode === 1 || (it.mode === 3 && l === 1) || (it.mode === 2 && l === 0)) this.pendingIsr.push(it.fn);
        }
        it.last = l;
      }
    }

    tick() {
      if (!this.running) throw STOP;
      if (this.pendingIsr.length || performance.now() - this.lastYield > 12) return this.slowTick();
    }
    async slowTick() {
      await this.runIsrs();
      if (performance.now() - this.lastYield > 12) {
        await sleep(0);
        this.lastYield = performance.now();
      }
      if (!this.running) throw STOP;
    }
    async runIsrs() {
      if (this.inIsr) return;
      while (this.pendingIsr.length && this.running) {
        const f = this.pendingIsr.shift();
        this.inIsr = true;
        try { await f(); } finally { this.inIsr = false; }
      }
    }
    async delay(ms) {
      ms = Number(ms) || 0;
      const end = this.millis() + ms;
      for (;;) {
        if (!this.running) throw STOP;
        await this.runIsrs();
        const rem = end - this.millis();
        if (rem <= 0) break;
        await sleep(Math.min(rem, 20));
        this.lastYield = performance.now();
      }
      await this.tick();
    }

    serialInput(text) {
      if (text.startsWith('@')) {
        const [name, ...args] = text.slice(1).trim().split(/\s+/);
        const fn = this.bridgeFns[name];
        if (!fn) { this.app.serialOut(`[Bridge] no function "${name}" provided by the sketch\n`); return; }
        this.pendingIsr.push(async () => {
          const r = await fn(...args.map((a) => (isNaN(+a) ? a : +a)));
          this.app.serialOut(`[Bridge] ${name}(${args.join(', ')}) → ${fmtNum(r)}\n`);
        });
        return;
      }
      for (const ch of text) this.inbuf.push(ch);
    }

    async run(prog) {
      this.t0 = performance.now();
      try {
        if (prog.setup) await prog.setup();
        while (this.running) {
          if (prog.loop) await prog.loop();
          else await this.delay(50);
          await this.tick();
        }
      } catch (e) {
        if (e !== STOP) this.app.onRuntimeError(e);
      }
    }
    stop() {
      this.running = false;
      for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
      this.timers.clear();
    }

    makeApi() {
      const rt = this, spec = this.spec;
      const api = {};
      const C = {
        HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3, CHANGE: 1, FALLING: 2, RISING: 3,
        LED_BUILTIN: 13, DEC: 10, HEX: 16, OCT: 8, BIN: 'BIN', LSBFIRST: 0, MSBFIRST: 1,
        PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, EULER: Math.E,
      };
      for (let i = 0; i < Math.max(8, spec.analogCount); i++) C['A' + i] = spec.analogBase + i; // A0 = 14 (UNO) or 54 (Mega)
      if (spec.layout === 'mega') Object.assign(C, { SDA: 20, SCL: 21, SS: 53, MOSI: 51, MISO: 50, SCK: 52 });
      // ESP32: analog pins are GPIO numbers (A0 = 36 …), serial config for Serial2.begin(baud, SERIAL_8N1, rx, tx)
      if (spec.esp32) Object.assign(C, { A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A11: 0, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26,
        LED_BUILTIN: 2, SDA: 21, SCL: 22, SERIAL_8N1: 0x800001c, SERIAL_8E1: 0x800001e, SERIAL_8O1: 0x800001f });
      Object.assign(api, C);

      api.pinMode = (p, m) => {
        const n = rt.need(p), st = rt.pinState(n);
        const gp = /^D(\d+)$/.exec(n);
        if (spec.inputOnly && gp && spec.inputOnly.includes(+gp[1])) {
          if (m === 1) throw new Error(`GPIO${gp[1]} is input only on the ESP32 — it can't be an OUTPUT. Use another pin.`);
          if (m === 2 || m === 3) { rt.warnOnce('nopull:' + n, `GPIO${gp[1]} has no internal pull-up/pull-down resistor on the ESP32 — add an external one.`); m = 0; }
        }
        st.mode = m === 1 ? 'OUTPUT' : m === 2 ? 'INPUT_PULLUP' : m === 3 ? 'INPUT_PULLDOWN' : 'INPUT';
        st.explicit = true;
        if (st.mode !== 'OUTPUT') { st.duty = null; st.tone = null; }
        rt.dirty();
      };
      api.digitalWrite = (p, v) => {
        const n = rt.need(p), st = rt.pinState(n);
        v = v ? 1 : 0;
        st.duty = null; st.tone = null;
        if (st.mode === 'OUTPUT' && st.value === 1 && v === 0) rt.lastPulse[n] = rt.millis(); // falling edge (e.g. HC-SR04 trigger)
        if (st.mode === 'OUTPUT') { st.value = v; rt.dirty(); if (rt.app.clocked) rt.app.ensureSolved(); return; }
        else {
          rt.warnOnce('dw:' + n, `digitalWrite(${n}) was called but the pin is not an OUTPUT. Add pinMode(${p}, OUTPUT) in setup(). (Writing HIGH to an input only enables its weak pull-up.)`);
          st.mode = v ? 'INPUT_PULLUP' : 'INPUT';
        }
        rt.dirty();
      };
      api.digitalRead = (p) => { const n = rt.need(p); rt.app.ensureSolved(); return rt.levelRaw(n); };
      api.analogRead = (p) => {
        if (typeof p === 'number' && p >= 0 && p < spec.analogCount) p = spec.analogBase + p; // analogRead(0) = analogRead(A0)
        const n = rt.need(p);
        if (n[0] !== 'A' && !(spec.adcPins && spec.adcPins.includes(+n.slice(1)))) throw new Error(`analogRead(${p}): pin ${n} is not an analog input${spec.adcPins ? ` (analog pins on the ${spec.short}: ${spec.adcPins.filter((g) => WB.worldPin(rt.board, 'D' + g) && !(spec.reserved || {})[g]).join(', ')})` : ''}`);
        rt.app.ensureSolved();
        const max = Math.pow(2, rt.adcBits) - 1;
        const r = rt.reading(n);
        if (r.floating) {
          rt.warnOnce('afloat:' + n, `analogRead(${n}): the pin is floating, readings are random noise.`);
          return Math.round(max * (0.25 + Math.random() * 0.3));
        }
        return Math.round(WB.clamp(r.v / spec.vcc, 0, 1) * max);
      };
      api.analogWrite = (p, val) => {
        const n = rt.need(p), st = rt.pinState(n);
        const max = Math.pow(2, rt.pwmBits) - 1;
        val = WB.clamp(Math.round(Number(val) || 0), 0, max);
        st.mode = 'OUTPUT'; st.tone = null;
        const num = /^D(\d+)$/.exec(n);
        if (!num || !spec.pwm.includes(+num[1])) {
          rt.warnOnce('pwm:' + n, `analogWrite(${n}): this pin has no PWM. Use one of pins ${spec.pwm.join(', ')} (marked ~).`);
          st.duty = null; st.value = val >= max / 2 ? 1 : 0;
        } else if (val === 0) { st.duty = null; st.value = 0; }
        else if (val === max) { st.duty = null; st.value = 1; }
        else { st.duty = val / max; st.value = 1; }
        rt.dirty();
      };
      api.analogReadResolution = (b) => { rt.adcBits = WB.clamp(Math.trunc(b), 1, 16); };
      api.analogWriteResolution = (b) => { rt.pwmBits = WB.clamp(Math.trunc(b), 1, 16); };
      api.analogReference = () => {};

      api.delay = (ms) => rt.delay(ms);
      api.delayMicroseconds = (us) => (us >= 2000 ? rt.delay(us / 1000) : rt.tick());
      api.millis = () => Math.floor(rt.millis());
      api.micros = () => Math.floor(rt.millis() * 1000);
      api.__tick = () => rt.tick();
      api.__arr = arr;
      api.__div = (a, b) => {
        if (typeof a === 'boolean') a = +a;
        if (typeof b === 'boolean') b = +b;
        const q = a / b;
        return Number.isInteger(a) && Number.isInteger(b) ? (Number.isFinite(q) ? Math.trunc(q) : 0) : q;
      };
      api.__i = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? Math.trunc(v) : 0) : typeof v === 'boolean' ? +v : v);
      api.__bitSet = (v, b) => v | (1 << b);
      api.__bitClear = (v, b) => v & ~(1 << b);
      api.__bitWrite = (v, b, x) => (x ? v | (1 << b) : v & ~(1 << b));

      api.tone = (p, freq, dur) => {
        const n = rt.need(p), st = rt.pinState(n);
        st.mode = 'OUTPUT'; st.duty = 0.5; st.value = 1; st.tone = Number(freq) || 0;
        rt.dirty();
        if (st.toneTimer) clearTimeout(st.toneTimer);
        if (dur) {
          st.toneTimer = setTimeout(() => { if (rt.running) { st.tone = null; st.duty = null; st.value = 0; rt.dirty(); } }, dur);
          rt.timers.add(st.toneTimer);
        }
      };
      api.noTone = (p) => { const n = rt.need(p), st = rt.pinState(n); st.tone = null; st.duty = null; st.value = 0; rt.dirty(); };
      // pulseIn(pin, HIGH): returns the echo length (µs) of an HC-SR04 whose Echo is wired to this
      // pin, if its Trig was pulsed recently. Other sources of pulses are not simulated (returns 0).
      api.pulseIn = (p, state) => {
        const n = rt.need(p);
        rt.app.ensureSolved();
        if (state === 0) return 0;
        return rt.app.echoMicros(n, rt.lastPulse);
      };
      api.pulseInLong = api.pulseIn;
      // bit by bit, so a 74HC595 (or anything clocked) sees every edge
      api.shiftOut = (dp, cp, order, val) => {
        val = Math.trunc(val) & 255;
        for (let i = 0; i < 8; i++) {
          const bit = order === 0 ? (val >> i) & 1 : (val >> (7 - i)) & 1;
          api.digitalWrite(dp, bit);
          api.digitalWrite(cp, 1);
          api.digitalWrite(cp, 0);
        }
      };
      api.shiftIn = (dp, cp, order) => {
        let v = 0;
        for (let i = 0; i < 8; i++) {
          api.digitalWrite(cp, 1);
          const bit = api.digitalRead(dp);
          v |= bit << (order === 0 ? i : 7 - i);
          api.digitalWrite(cp, 0);
        }
        return v;
      };

      api.map = (x, a, b, c, d) => (b === a ? c : Math.trunc(((x - a) * (d - c)) / (b - a)) + c);
      api.constrain = (x, a, b) => (x < a ? a : x > b ? b : x);
      api.min = (a, b) => (a < b ? a : b);
      api.max = (a, b) => (a > b ? a : b);
      api.abs = Math.abs; api.fabs = Math.abs;
      api.sq = (x) => x * x;
      for (const f of ['sqrt', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'log10', 'floor', 'ceil', 'round', 'trunc']) api[f] = Math[f];
      api.fmod = (a, b) => a % b;
      api.random = (a, b) => {
        if (b === undefined) { b = a; a = 0; }
        a = Math.trunc(a); b = Math.trunc(b);
        return b <= a ? a : a + Math.floor(rt.rng() * (b - a));
      };
      api.randomSeed = (s) => { rt.rng = mulberry(Math.trunc(s) || 1); };
      api.bitRead = (v, b) => (v >> b) & 1;
      api.bit = (b) => 1 << b;
      api.lowByte = (v) => v & 255;
      api.highByte = (v) => (v >> 8) & 255;
      api.isDigit = (c) => /^[0-9]$/.test(String(c));
      api.isAlpha = (c) => /^[A-Za-z]$/.test(String(c));
      api.isAlphaNumeric = (c) => /^[A-Za-z0-9]$/.test(String(c));
      api.isSpace = (c) => /^\s$/.test(String(c));
      api.isUpperCase = (c) => /^[A-Z]$/.test(String(c));
      api.isLowerCase = (c) => /^[a-z]$/.test(String(c));

      api.int = (x) => (typeof x === 'string' && x.length === 1 ? x.charCodeAt(0) : Math.trunc(Number(x)) || 0);
      api.long = api.int;
      api.byte = (x) => api.int(x) & 255;
      api.word = (x) => api.int(x) & 65535;
      api.float = (x) => Number(x);
      api.double = api.float;
      api.char = (x) => (typeof x === 'number' ? String.fromCharCode(x) : x);
      api.bool = (x) => !!x;
      api.boolean = api.bool;
      api.String = function (v, f) {
        if (v === undefined) return '';
        if (typeof v === 'number') return fmtNum(v, f);
        return fmtNum(v);
      };
      api.sizeof = (v) => (Array.isArray(v) ? v.length * (Array.isArray(v[0]) ? api.sizeof(v[0]) : 1) : typeof v === 'string' ? v.length + 1 : 1);
      api.F = (s) => s;

      // digitalPinToInterrupt(pin) returns the pin tagged with +1000, so attachInterrupt can tell it
      // apart from a raw interrupt number (on AVR boards int 0/1 = pins 2/3; Mega int 0..5 = 2, 3, 21, 20, 19, 18).
      const intToPin = (num) => (num >= 1000 ? num - 1000 : spec.intPins && num >= 0 && num < spec.intPins.length ? spec.intPins[num] : num);
      api.digitalPinToInterrupt = (p) => 1000 + Number(p);
      api.attachInterrupt = (num, fn, mode) => {
        const p = intToPin(num);
        const pin = rt.need(p);
        rt.interrupts = rt.interrupts.filter((i) => i.pin !== pin);
        rt.interrupts.push({ pin, fn, mode, last: undefined });
        rt.dirty();
      };
      api.detachInterrupt = (num) => {
        const pin = rt.pinName(intToPin(num));
        rt.interrupts = rt.interrupts.filter((i) => i.pin !== pin);
      };
      api.interrupts = () => {};
      api.noInterrupts = () => {};

      // ---------------- Serial ports
      // Bytes in a receive buffer are 1-character strings (typed in the Serial Monitor) or numbers
      // (bytes from a device such as a Nextion display); chr() turns either into a character.
      const chr = (x) => (typeof x === 'number' ? String.fromCharCode(x) : x);
      const toBytes = (s) => Array.from(String(s), (c) => c.charCodeAt(0) & 255);
      // A device wired to a port's pins: a Nextion display whose RX is on the port's TX pin and
      // whose TX is on the port's RX pin. Returns its simulated device, or null.
      const nexClaimed = new Set();
      function nexOn(rxPin, txPin, who) {
        rt.app.ensureSolved();
        const part = rt.app.wiredParts('nextion', { RX: txPin, TX: rxPin }).find((p) => !nexClaimed.has(p.id));
        if (!part) {
          if (who && rt.app.wiredParts('nextion', { RX: rxPin, TX: txPin }).length) rt.warnOnce('nexswap:' + rxPin, `${who}: the Nextion's TX and RX are swapped. Its TX goes to the Arduino's RX pin (${rxPin}) and its RX to the Arduino's TX pin (${txPin}).`);
          return null;
        }
        nexClaimed.add(part.id);
        const d = WB.Nextion.deviceFor(rt.sim, part);
        d.powered = rt.app.partVolts(part, '5V', 'GND') > 4.2;
        d.log = (key, msg) => rt.warnOnce(key, msg);
        if (!d.powered) rt.warnOnce('nexpow:' + part.id, `${part.name}: no power — wire its +5V and GND.`);
        return d;
      }
      // Stream methods shared by every port: this.buf (receive buffer), this.emit(string) sends.
      const streamMethods = {
        print(v, f) { const s = fmtNum(v, f); this.emit(s); return s.length; },
        println(v, f) { const s = (v === undefined ? '' : fmtNum(v, f)) + '\n'; this.emit(s); return s.length; },
        write(v, n) {
          if (typeof v === 'number') { this.emit(String.fromCharCode(v & 255)); return 1; }
          let s = Array.isArray(v) ? v.map((c) => (typeof c === 'number' ? String.fromCharCode(c & 255) : c)).join('') : fmtNum(v);
          if (n !== undefined) s = s.slice(0, Math.max(0, Math.trunc(n)));
          this.emit(s);
          return s.length;
        },
        printf(f, ...a) { const s = cprintf(f, a); this.emit(s); return s.length; },
        available() { return this.buf.length; },
        availableForWrite() { return 63; },
        read() { return this.buf.length ? this.buf.shift() : -1; },
        peek() { return this.buf.length ? this.buf[0] : -1; },
        readString() { const s = this.buf.map(chr).join(''); this.buf.length = 0; return s; },
        readStringUntil(c) {
          const t = chr(c);
          const i = this.buf.findIndex((x) => chr(x) === t);
          const s = this.buf.splice(0, i < 0 ? this.buf.length : i + 1);
          if (i >= 0) s.pop();
          return s.map(chr).join('');
        },
        readBytes(dst, n) {
          let k = 0;
          while (k < n && this.buf.length) { const x = this.buf.shift(); dst[k++] = typeof x === 'number' ? x : x.charCodeAt(0); }
          return k;
        },
        parseInt() {
          const b = this.buf;
          while (b.length && !/[-0-9]/.test(chr(b[0]))) b.shift();
          let s = '';
          if (chr(b[0]) === '-') s += chr(b.shift());
          while (b.length && /[0-9]/.test(chr(b[0]))) s += chr(b.shift());
          return parseInt(s, 10) || 0;
        },
        parseFloat() {
          const b = this.buf;
          while (b.length && !/[-0-9.]/.test(chr(b[0]))) b.shift();
          let s = '';
          while (b.length && /[-0-9.]/.test(chr(b[0]))) s += chr(b.shift());
          return parseFloat(s) || 0;
        },
        setTimeout() {}, flush() {},
      };
      // Hardware serial: everything sent shows in the Serial Monitor (as on a real board, where the
      // USB chip listens on the same pins); a Nextion wired to the port's pins gets it too.
      const out = (s) => rt.app.serialOut(s);
      function hwSerial(rxPin, txPin, label) {
        return Object.assign(Object.create(streamMethods), {
          buf: rt.inbuf, baud: 9600, dev: undefined,
          begin(b, cfg, rx, tx) {
            if (b) this.baud = Math.trunc(b);
            if (spec.esp32 && rx !== undefined && tx !== undefined && Number(rx) >= 0 && Number(tx) >= 0) { rxPin = rt.need(rx); txPin = rt.need(tx); this.dev = undefined; }
            this.link();
          },
          end() {},
          link() {
            if (this.dev !== undefined) return this.dev;
            this.dev = rxPin && WB.worldPin(rt.board, rxPin) && WB.worldPin(rt.board, txPin) ? nexOn(rxPin, txPin, label) : null;
            if (this.dev) { const d = this.dev; d.sink = (bytes) => { if (this.baud === d.baud) rt.inbuf.push(...bytes); }; d.powerOn(); }
            return this.dev;
          },
          emit(s) {
            out(s);
            const d = this.link();
            if (!d) return;
            if (this.baud !== d.baud) { rt.warnOnce('nexbaud:' + label, `${label}.begin(${this.baud}) but the Nextion is set to ${d.baud} baud — it only receives garbage. Use the same rate on both sides.`); return; }
            for (const b of toBytes(s)) d.feed(b);
          },
        });
      }
      // Which pins each hardware port uses: Serial on D0/D1 for the AVR boards (UNO R3, Nano, Mega);
      // on the UNO R4 and UNO Q, Serial is the USB port and Serial1 is on D0/D1.
      const avr = !!spec.avr, mega = spec.layout === 'mega';
      const serial = spec.serialPins ? hwSerial(spec.serialPins[0], spec.serialPins[1], 'Serial') : hwSerial(avr ? 'D0' : null, 'D1', 'Serial');
      api.Serial = serial;
      api.Serial1 = mega ? hwSerial('D19', 'D18', 'Serial1') : spec.esp32 ? hwSerial(null, null, 'Serial1') : avr ? serial : hwSerial('D0', 'D1', 'Serial1');
      api.Serial2 = mega ? hwSerial('D17', 'D16', 'Serial2') : spec.esp32 ? hwSerial(null, null, 'Serial2') : serial;
      api.Serial3 = mega ? hwSerial('D15', 'D14', 'Serial3') : serial;
      api.SerialUSB = serial;

      // SoftwareSerial(rx, tx): a serial port on any two pins. The simulator connects it to a
      // Nextion display wired to those pins (display TX -> rx pin, display RX -> tx pin).
      class SoftwareSerial {
        constructor(rx, tx) { this.rx = rt.pinName(rx); this.tx = rt.pinName(tx); this.buf = []; this.baud = 9600; this.dev = undefined; this.on = false; }
        begin(b) {
          this.baud = Math.trunc(b) || 9600;
          this.on = true;
          if (!this.rx || !this.tx) throw new Error(`SoftwareSerial: a pin given to SoftwareSerial does not exist on ${spec.label}`);
          if (this.dev !== undefined) return;
          const d = (this.dev = nexOn(this.rx, this.tx, `SoftwareSerial(${this.rx}, ${this.tx})`));
          if (!d) { rt.warnOnce('ss:' + this.rx, `SoftwareSerial(${this.rx}, ${this.tx}): nothing the simulator can talk to is wired to these pins. Wire a Nextion display: its TX to ${this.rx}, its RX to ${this.tx}.`); return; }
          d.sink = (bytes) => {
            if (!this.on || this.baud !== d.baud) return;
            this.buf.push(...bytes);
            if (this.buf.length > 64) this.buf.splice(0, this.buf.length - 64);   // 64-byte receive buffer, as on the real library
          };
          d.powerOn();
        }
        end() { this.on = false; }
        listen() { this.on = true; return true; }
        isListening() { return this.on; }
        overflow() { return false; }
        emit(s) {
          if (!this.on) { rt.warnOnce('ssbeg:' + this.rx, `SoftwareSerial(${this.rx}, ${this.tx}): call begin(9600) in setup() before sending.`); return; }
          const d = this.dev;
          if (!d) return;
          if (this.baud !== d.baud) { rt.warnOnce('nexbaud:' + this.rx, `SoftwareSerial begin(${this.baud}) but the Nextion is set to ${d.baud} baud — it only receives garbage. Use the same rate on both sides.`); return; }
          for (const b of toBytes(s)) d.feed(b);
        }
      }
      for (const k of Object.keys(streamMethods)) SoftwareSerial.prototype[k] = SoftwareSerial.prototype[k] || streamMethods[k];
      api.SoftwareSerial = SoftwareSerial;
      api.Monitor = serial; // UNO Q: Monitor object of the Bridge library

      // ---------------- Bridge (UNO Q MCU <-> Linux RPC) — simulated stub
      api.Bridge = {
        begin() { out('[Bridge] started (simulated — no Linux side in this simulator)\n'); return true; },
        provide(name, fn) { rt.bridgeFns[name] = fn; out(`[Bridge] provides "${name}" — call it by typing @${name} <args> in the Serial Monitor\n`); return true; },
        provide_safe(name, fn) { return this.provide(name, fn); },
        call(name, ...args) { out(`[Bridge] call ${name}(${args.map((a) => fmtNum(a)).join(', ')}) → (not simulated)\n`); return { result: () => false }; },
        notify(name, ...args) { out(`[Bridge] notify ${name}(${args.map((a) => fmtNum(a)).join(', ')})\n`); return true; },
        update() {},
      };

      // ---------------- Servo
      api.Servo = class Servo {
        constructor() { this.pin = null; this.angle = 90; this.min = 544; this.max = 2400; }
        attach(p, min, max) {
          this.pin = rt.need(p); this.min = min || 544; this.max = max || 2400;
          const st = rt.pinState(this.pin);
          st.mode = 'SERVO';
          if (!rt.sim.servos.includes(this)) rt.sim.servos.push(this);
          rt.dirty();
          return 1;
        }
        detach() { this.pin = null; rt.dirty(); }
        attached() { return this.pin !== null; }
        write(v) { if (v >= 500) return this.writeMicroseconds(v); this.angle = WB.clamp(Number(v) || 0, 0, 180); rt.dirty(); }
        writeMicroseconds(us) { this.angle = WB.clamp(((us - this.min) * 180) / (this.max - this.min), 0, 180); rt.dirty(); }
        read() { return Math.round(this.angle); }
        readMicroseconds() { return Math.round(this.min + (this.angle / 180) * (this.max - this.min)); }
      };

      // ---------------- Built-in LED matrix (UNO Q 13x8, UNO R4 WiFi 12x8)
      const M = spec.matrix;
      const needMatrix = () => { if (!M) throw new Error(`${spec.label} has no built-in LED matrix`); return rt.sim.matrix; };
      class LEDMatrix {
        constructor() { this.seq = null; this.timer = null; this.idx = 0; }
        begin() { needMatrix(); return true; }
        get width() { return M ? M.w : 0; }
        get height() { return M ? M.h : 0; }
        clear() { needMatrix().fill(0); rt.dirty(); }
        loadFrame(words) {
          const b = needMatrix();
          for (let k = 0; k < M.w * M.h; k++) b[k] = ((Number(words[k >> 5]) >>> (31 - (k & 31))) & 1) * 255;
          rt.dirty();
        }
        renderBitmap(bm) {
          const b = needMatrix();
          for (let r = 0; r < M.h; r++) for (let c = 0; c < M.w; c++) b[r * M.w + c] = bm[r] && bm[r][c] ? 255 : 0;
          rt.dirty();
        }
        draw(a) {
          const b = needMatrix();
          let mx = 1;
          for (let k = 0; k < M.w * M.h; k++) mx = Math.max(mx, Number(a[k]) || 0);
          const scale = mx <= 1 ? 255 : mx <= 7 ? 255 / 7 : 1;
          for (let k = 0; k < M.w * M.h; k++) b[k] = WB.clamp(Math.round((Number(a[k]) || 0) * scale), 0, 255);
          rt.dirty();
        }
        set(x, y, v) { this.setPixel(x, y, v); }
        setPixel(x, y, v) {
          const b = needMatrix();
          if (x < 0 || y < 0 || x >= M.w || y >= M.h) return;
          b[y * M.w + x] = v === undefined ? 255 : v === true || v === 1 ? 255 : WB.clamp(Math.round(Number(v)), 0, 255);
          rt.dirty();
        }
        loadSequence(seq) { this.seq = seq; this.idx = 0; }
        next() {
          if (!this.seq || !this.seq.length) return;
          const f = this.seq[this.idx % this.seq.length];
          this.loadFrame(f);
          this.idx++;
          return f[f.length - 1];
        }
        play(loop) {
          if (!this.seq) return;
          if (this.timer) clearTimeout(this.timer);
          const step = () => {
            if (!rt.running) return;
            if (!loop && this.idx >= this.seq.length) return;
            const d = this.next();
            this.timer = setTimeout(step, Math.max(10, Number(d) || 100));
            rt.timers.add(this.timer);
          };
          this.idx = 0;
          step();
        }
        sequenceDone() { return !this.seq || this.idx >= this.seq.length; }
        autoscroll() {}
      }
      api.Arduino_LED_Matrix = LEDMatrix;
      api.ArduinoLEDMatrix = LEDMatrix;

      // ---------------- Modulino library (I2C modules). Each object binds, on begin(), to the next
      // Modulino part of its kind that is wired to the board's I2C bus (SDA, SCL) and powered.
      const claimed = new Set();
      const stateOf = (id) => (rt.sim.modulino[id] = rt.sim.modulino[id] || {});
      class ModulinoBase {
        constructor() { this.part = null; }
        begin() {
          const type = WB.MODULINO_LIB[this.constructor.libName];
          const found = rt.app.i2cDevices(type).find((p) => !claimed.has(p.id));
          if (!found) {
            rt.warnOnce('mod:' + type, `${WB.PARTS[type].label} not found on the I2C bus. Wire its GND, 3.3V, SDA and SCL to the board (select the module and use "Connect to board").`);
            return false;
          }
          claimed.add(found.id);
          this.part = found;
          return true;
        }
        get st() { return this.part ? stateOf(this.part.id) : {}; }
      }
      const pressedOf = (part) => (part && rt.app.transient[part.id] && rt.app.transient[part.id].pressed) || null;

      class ModulinoButtons extends ModulinoBase {
        constructor() { super(); this.state = [false, false, false]; }
        update() {
          const p = pressedOf(this.part);
          const now = [0, 1, 2].map((i) => !!(p && p[i]));
          const changed = now.some((v, i) => v !== this.state[i]);
          this.state = now;
          return changed;
        }
        isPressed(i) { if (typeof i === 'string') i = 'ABC'.indexOf(i.toUpperCase()); return !!this.state[i]; }
        setLeds(a, b, c) { this.st.leds = [a ? 1 : 0, b ? 1 : 0, c ? 1 : 0]; rt.dirty(); }
      }
      ModulinoButtons.libName = 'ModulinoButtons';

      class ModulinoBuzzer extends ModulinoBase {
        tone(freq, dur) {
          const st = this.st;
          st.tone = Number(freq) || 0;
          rt.dirty();
          clearTimeout(st.timer);
          if (dur) { st.timer = setTimeout(() => { st.tone = 0; rt.dirty(); }, dur); rt.timers.add(st.timer); }
        }
        noTone() { this.st.tone = 0; rt.dirty(); }
      }
      ModulinoBuzzer.libName = 'ModulinoBuzzer';

      class ModulinoColor { constructor(r, g, b) { this.r = r | 0; this.g = g | 0; this.b = b | 0; } }
      class ModulinoPixels extends ModulinoBase {
        constructor() { super(); this.buf = Array.from({ length: 8 }, () => [0, 0, 0, 0]); }
        set(i, color, brightness) {
          if (i < 0 || i > 7) return;
          const c = color || { r: 0, g: 0, b: 0 };
          this.buf[i] = [c.r, c.g, c.b, brightness === undefined ? 25 : WB.clamp(brightness, 0, 100)];
        }
        clear(i) { if (i === undefined) this.buf = this.buf.map(() => [0, 0, 0, 0]); else if (i >= 0 && i < 8) this.buf[i] = [0, 0, 0, 0]; }
        show() { this.st.pixels = this.buf.map((q) => q.slice()); rt.dirty(); }
      }
      ModulinoPixels.libName = 'ModulinoPixels';

      class ModulinoKnob extends ModulinoBase {
        get() { return this.part ? Math.round(Number(this.part.props.value) || 0) : 0; }
        set(v) { if (this.part) { this.part.props.value = Math.round(v); rt.app.editor.rerenderBody(this.part); } }
        isPressed() { return !!pressedOf(this.part); }
      }
      ModulinoKnob.libName = 'ModulinoKnob';

      class ModulinoDistance extends ModulinoBase {
        available() { return !!this.part; }
        get() { return this.part ? Math.round(Number(this.part.props.mm)) : 0; }
      }
      ModulinoDistance.libName = 'ModulinoDistance';

      class ModulinoMovement extends ModulinoBase {
        update() { return !!this.part; }
        acc() {
          if (!this.part) return [0, 0, 0];
          const pi = (Number(this.part.props.pitch) || 0) * Math.PI / 180, ro = (Number(this.part.props.roll) || 0) * Math.PI / 180;
          return [-Math.sin(pi), Math.sin(ro) * Math.cos(pi), Math.cos(ro) * Math.cos(pi)];
        }
        getX() { return this.acc()[0]; }
        getY() { return this.acc()[1]; }
        getZ() { return this.acc()[2]; }
        getRoll() { return 0; }
        getPitch() { return 0; }
        getYaw() { return 0; }
      }
      ModulinoMovement.libName = 'ModulinoMovement';

      class ModulinoThermo extends ModulinoBase {
        getTemperature() { return this.part ? Number(this.part.props.temp) : 0; }
        getHumidity() { return this.part ? Number(this.part.props.humidity) : 0; }
      }
      ModulinoThermo.libName = 'ModulinoThermo';

      Object.assign(api, { ModulinoButtons, ModulinoBuzzer, ModulinoPixels, ModulinoKnob, ModulinoDistance, ModulinoMovement, ModulinoThermo, ModulinoColor });
      api.Modulino = { begin() { rt.app.ensureSolved(); return true; } };
      api.RED = new ModulinoColor(255, 0, 0);
      api.GREEN = new ModulinoColor(0, 255, 0);
      api.BLUE = new ModulinoColor(0, 0, 255);
      api.VIOLET = new ModulinoColor(255, 0, 255);
      api.WHITE = new ModulinoColor(255, 255, 255);

      // ---------------- LiquidCrystal / LiquidCrystal_I2C (HD44780 16x2 LCD)
      // A display object binds on begin()/init() to the LCD part wired to its pins (parallel:
      // RS and E; I2C: on the board's SDA/SCL bus). Characters go into the 2 x 40 display RAM.
      const lcdClaimed = new Set();
      class LCD {
        constructor(kind, args) { this.kind = kind; this.args = args; this.part = null; this.st = null; }
        bind() {
          if (this.part) return true;
          rt.app.ensureSolved();
          let found;
          if (this.kind === 'i2c') {
            found = rt.app.i2cDevices('lcd', { vcc: 'VCC', vmin: 4, pred: (p) => p.props.iface === 'i2c' }).find((p) => !lcdClaimed.has(p.id));
            if (!found) { rt.warnOnce('lcd:i2c', 'LiquidCrystal_I2C: no I2C LCD found. Add an "LCD 16×2" part, set its Interface to I2C, and wire GND, VCC (5 V), SDA and SCL to the board.'); return false; }
          } else {
            const a = this.args;
            const rs = rt.pinName(a[0]), en = rt.pinName(a.length === 7 || a.length === 11 ? a[2] : a[1]);
            found = rt.app.wiredParts('lcd', { RS: rs, E: en }, (p) => p.props.iface !== 'i2c').find((p) => !lcdClaimed.has(p.id));
            if (!found) { rt.warnOnce('lcd:par:' + rs, `LiquidCrystal: no LCD found with its RS pin on ${rs} and E on ${en}. Check the wiring (or the pin numbers in the constructor).`); return false; }
          }
          lcdClaimed.add(found.id);
          this.part = found;
          this.st = rt.sim.lcd[found.id] = { buf: [new Array(40).fill(32), new Array(40).fill(32)], cx: 0, cy: 0, disp: true, cur: false, blink: false, shift: 0, custom: {}, bl: true, ltr: true, auto: false };
          rt.dirty();
          return true;
        }
        upd() { rt.dirty(); }
        begin() { this.bind(); }
        init() { this.bind(); }
        clear() { if (!this.bind()) return; for (const r of this.st.buf) r.fill(32); this.st.cx = this.st.cy = this.st.shift = 0; this.upd(); }
        home() { if (!this.bind()) return; this.st.cx = this.st.cy = this.st.shift = 0; this.upd(); }
        setCursor(c, r) { if (!this.bind()) return; this.st.cx = WB.clamp(Math.trunc(c), 0, 39); this.st.cy = WB.clamp(Math.trunc(r), 0, 1); this.upd(); }
        write(ch) {
          if (!this.bind()) return 0;
          const st = this.st;
          const code = typeof ch === 'number' ? ch & 255 : String(ch).charCodeAt(0) & 255;
          st.buf[st.cy][st.cx] = code;
          if (st.ltr) { st.cx++; if (st.cx >= 40) { st.cx = 0; st.cy ^= 1; } } else { st.cx--; if (st.cx < 0) { st.cx = 39; st.cy ^= 1; } }
          if (st.auto) st.shift += st.ltr ? 1 : -1;
          this.upd();
          return 1;
        }
        print(v, f) {
          if (!this.bind()) return 0;
          const s = fmtNum(v, f);
          for (const ch of s) this.write(ch.charCodeAt(0) > 255 ? 63 : ch);
          return s.length;
        }
        println(v, f) { return this.print(v === undefined ? '' : v, f); }
        printf(fmt, ...a) { return this.print(cprintf(fmt, a)); }
        createChar(n, rows) { if (!this.bind()) return; this.st.custom[n & 7] = Array.from({ length: 8 }, (_, i) => Number(rows[i]) & 31); this.upd(); }
        display() { if (this.bind()) { this.st.disp = true; this.upd(); } }
        noDisplay() { if (this.bind()) { this.st.disp = false; this.upd(); } }
        cursor() { if (this.bind()) { this.st.cur = true; this.upd(); } }
        noCursor() { if (this.bind()) { this.st.cur = false; this.upd(); } }
        blink() { if (this.bind()) { this.st.blink = true; this.upd(); } }
        noBlink() { if (this.bind()) { this.st.blink = false; this.upd(); } }
        scrollDisplayLeft() { if (this.bind()) { this.st.shift++; this.upd(); } }
        scrollDisplayRight() { if (this.bind()) { this.st.shift--; this.upd(); } }
        leftToRight() { if (this.bind()) this.st.ltr = true; }
        rightToLeft() { if (this.bind()) this.st.ltr = false; }
        autoscroll() { if (this.bind()) this.st.auto = true; }
        noAutoscroll() { if (this.bind()) this.st.auto = false; }
        backlight() { if (this.bind()) { this.st.bl = true; this.upd(); } }
        noBacklight() { if (this.bind()) { this.st.bl = false; this.upd(); } }
        setBacklight(v) { if (this.bind()) { this.st.bl = !!v; this.upd(); } }
      }
      api.LiquidCrystal = function (...a) { return new LCD('par', a); };
      api.LiquidCrystal_I2C = function (...a) { return new LCD('i2c', a); };
      api.Wire = { begin() {}, beginTransmission() {}, endTransmission() { return 0; }, write() { return 1; }, requestFrom() { return 0; }, available() { return 0; }, read() { return -1; }, setClock() {} };

      // ---------------- Adafruit_NeoPixel (WS2812B). Binds to the NeoPixel part whose DIN is on the pin.
      Object.assign(api, { NEO_GRB: 0x52, NEO_RGB: 0x06, NEO_RGBW: 0x1b, NEO_GRBW: 0xd2, NEO_KHZ800: 0, NEO_KHZ400: 0x100 });
      const packRGB = (r, g, b) => (((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
      class NeoPixels {
        constructor(n, pin) { this.n = Math.max(0, Math.trunc(n) || 0); this.pin = pin; this.buf = Array.from({ length: this.n }, () => [0, 0, 0]); this.bright = 0; this.part = null; }
        bind() {
          if (this.part) return true;
          if (this.pin === undefined) return false;
          rt.app.ensureSolved();
          const pin = rt.need(this.pin);
          this.part = rt.app.wiredParts('neopixel', { DIN: pin })[0] || null;
          if (!this.part) { rt.warnOnce('neo:' + pin, `Adafruit_NeoPixel: no NeoPixel found with DIN wired to ${pin}.`); return false; }
          const have = WB.neoCount(this.part.props);
          if (have < this.n) rt.warnOnce('neon:' + this.part.id, `Adafruit_NeoPixel: the sketch uses ${this.n} pixels but ${this.part.name} has ${have}.`);
          return true;
        }
        begin() { this.bind(); }
        show() {
          if (!this.bind()) return;
          const k = this.bright ? this.bright / 256 : 1;
          rt.sim.neo[this.part.id] = { px: this.buf.map((q) => [Math.round(q[0] * k), Math.round(q[1] * k), Math.round(q[2] * k)]) };
          rt.dirty();
        }
        setPixelColor(i, r, g, b) {
          i = Math.trunc(i);
          if (i < 0 || i >= this.n) return;
          if (g === undefined) { const c = Number(r) >>> 0; r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255; }
          this.buf[i] = [WB.clamp(r | 0, 0, 255), WB.clamp(g | 0, 0, 255), WB.clamp(b | 0, 0, 255)];
        }
        getPixelColor(i) { const q = this.buf[Math.trunc(i)]; return q ? packRGB(q[0], q[1], q[2]) : 0; }
        fill(c, first, count) { first = Math.trunc(first) || 0; const end = count ? Math.min(this.n, first + Math.trunc(count)) : this.n; for (let i = first; i < end; i++) this.setPixelColor(i, c || 0); }
        clear() { for (const q of this.buf) q.fill(0); }
        setBrightness(b) { this.bright = (WB.clamp(Math.trunc(b), 0, 255) + 1) & 255; }
        getBrightness() { return (this.bright - 1) & 255; }
        numPixels() { return this.n; }
        updateLength(n) { this.n = Math.trunc(n); this.buf = Array.from({ length: this.n }, () => [0, 0, 0]); }
        setPin(p) { this.pin = p; this.part = null; }
        canShow() { return true; }
        Color(r, g, b) { return packRGB(r, g, b); }
        ColorHSV(h, s, v) {
          h = ((Math.trunc(h) % 65536) + 65536) % 65536; s = s === undefined ? 255 : s; v = v === undefined ? 255 : v;
          const hh = (h * 6) / 65536, i = Math.floor(hh), f = hh - i;
          const p = v * (1 - s / 255), q = v * (1 - (s / 255) * f), t = v * (1 - (s / 255) * (1 - f));
          const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
          return packRGB(Math.round(r), Math.round(g), Math.round(b));
        }
        gamma32(c) { return c; }
      }
      api.Adafruit_NeoPixel = function (n, pin) { return new NeoPixels(n, pin); };

      // ---------------- Keypad library (4x4 membrane keypad)
      api.makeKeymap = (k) => k;
      api.NO_KEY = '';
      Object.assign(api, { IDLE: 0, PRESSED: 1, HOLD: 2, RELEASED: 3 });
      class KeypadObj {
        constructor(map, rows, cols, nr, nc) { this.map = map; this.rows = rows || []; this.cols = cols || []; this.nr = nr || this.rows.length; this.nc = nc || this.cols.length; this.last = ''; this.state = 0; }
        held() {
          const pins = {};
          for (let i = 0; i < Math.min(4, this.nr); i++) pins['R' + (i + 1)] = rt.pinName(this.rows[i]);
          for (let j = 0; j < Math.min(4, this.nc); j++) pins['C' + (j + 1)] = rt.pinName(this.cols[j]);
          const kp = rt.app.wiredParts('keypad', pins)[0];
          if (!kp) { rt.warnOnce('kp', `Keypad: no keypad found with R1–R4 on pins ${this.rows.join(', ')} and C1–C4 on pins ${this.cols.join(', ')}.`); return ''; }
          const pr = rt.app.transient[kp.id] && rt.app.transient[kp.id].pressed;
          const k = pr ? pr.indexOf(true) : -1;
          if (k < 0) return '';
          const row = this.map[k >> 2];
          const ch = row ? row[k & 3] : '';
          return typeof ch === 'number' ? String.fromCharCode(ch) : ch || '';
        }
        getKey() {
          const k = this.held();
          const fresh = k && k !== this.last;
          this.state = k ? (fresh ? 1 : 2) : this.last ? 3 : 0;
          this.last = k;
          return fresh ? k : api.NO_KEY;
        }
        async waitForKey() { for (;;) { const k = this.getKey(); if (k) return k; await rt.delay(10); } }
        getState() { return this.state; }
        isPressed(c) { return this.held() === c; }
        setDebounceTime() {}
        setHoldTime() {}
        addEventListener() {}
      }
      api.Keypad = function (map, rows, cols, nr, nc) { return new KeypadObj(map, rows, cols, nr, nc); };

      // ---------------- IRremote (IR receiver + the IR remote part; NEC codes)
      const rev8 = (b) => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; };
      const ir = {
        pin: null,
        decodedIRData: { command: 0, address: 0, protocol: 0, decodedRawData: 0, flags: 0 },
        begin(p) { this.pin = rt.need(p); return true; },
        enableIRIn() {},
        start() {},
        stop() {},
        resume() {},
        blink13() {},
        available() { return rt.sim.irq.length > 0; },
        decode(res) {
          if (!rt.sim.irq.length) return false;
          if (this.pin) {
            rt.app.ensureSolved();
            const rx = rt.app.wiredParts('irrecv', { OUT: this.pin })[0];
            if (!rx) { rt.warnOnce('ir:wire', `IRremote: no IR receiver has its OUT wired to ${this.pin}.`); rt.sim.irq.length = 0; return false; }
            if (rt.app.partVolts(rx, 'VCC', 'GND') < 4) { rt.warnOnce('ir:pwr', `IRremote: ${rx.name} needs 5 V on VCC and GND connected.`); rt.sim.irq.length = 0; return false; }
          }
          const cmd = rt.sim.irq.shift();
          const raw = (((~cmd & 255) << 24) | (cmd << 16) | 0xff00) >>> 0;
          this.decodedIRData = { command: cmd, address: 0, protocol: 8, decodedRawData: raw, flags: 0 };
          if (res && typeof res === 'object') { res.value = (0xff0000 | (rev8(cmd) << 8) | rev8(~cmd & 255)) >>> 0; res.decode_type = 3; res.bits = 32; }
          return true;
        },
        printIRResultShort() { const d = this.decodedIRData; out(`Protocol=NEC Address=0x0 Command=0x${d.command.toString(16).toUpperCase()} Raw-Data=0x${d.decodedRawData.toString(16).toUpperCase()} 32 bits LSB first\n`); },
      };
      api.IrReceiver = ir;
      api.IRrecv = function (p) { if (p !== undefined) ir.pin = rt.need(p); return ir; };
      api.decode_results = function () { return { value: 0, decode_type: 0, bits: 0 }; };
      Object.assign(api, { ENABLE_LED_FEEDBACK: true, DISABLE_LED_FEEDBACK: false, NEC: 3 });
      if (spec.esp32 && WB.CYD) WB.CYD.extendApi(api, rt);
      return api;
    }
  }
  WB.Runtime = Runtime;
  WB.fmtNum = fmtNum;
})(window.WB);

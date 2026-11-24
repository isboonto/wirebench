'use strict';
// Nextion 7" HMI touch display (800 x 480), driven over a serial port like the real one.
//
// The screen design (what the Nextion Editor makes on a PC) is the part's "Screen layout"
// setting: one object per line, using the Nextion Editor's names (t0, n0, b0, j0 ...).
// The sketch talks to it with the real Nextion instruction set — text commands ended by three
// 0xFF bytes, e.g. t0.txt="25.3" ÿÿÿ — and gets the real return data back: touch events
// (0x65 page id event), get replies (0x70 string / 0x71 number), sendme (0x66) and error codes.
(function (WB) {
  const SCREEN_W = 800, SCREEN_H = 480, K = 0.75;          // pixels -> part units
  const SX = -285, SY = -395;                                // screen top-left in part units
  const PIN_IDS = ['5V', 'TX', 'RX', 'GND'];

  const COLORS = { BLACK: 0, WHITE: 65535, RED: 63488, GREEN: 2016, BLUE: 31, GRAY: 33840, BROWN: 48192, YELLOW: 65504 };
  const rgb565 = (c) => {
    c = Math.trunc(Number(c)) & 0xffff;
    const r = ((c >> 11) & 31) * 255 / 31, g = ((c >> 5) & 63) * 255 / 63, b = (c & 31) * 255 / 31;
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  };
  const colorVal = (s) => (s in COLORS ? COLORS[s] : /^-?\d+$/.test(s) ? Number(s) & 0xffff : null);

  // ---------------------------------------------------------------- object types
  // attrs: settable attributes (besides bco / pco). Defaults are what the Nextion Editor uses.
  const TYPES = {
    text: { attrs: ['txt'], bco: 65535, pco: 0, touch: false },
    number: { attrs: ['val'], bco: 65535, pco: 0, touch: false },
    float: { attrs: ['val', 'vvs1'], bco: 65535, pco: 0, touch: false },
    button: { attrs: ['txt', 'bco2', 'pco2'], bco: 50712, pco: 0, bco2: 1024, pco2: 65535, touch: true },
    toggle: { attrs: ['txt', 'val', 'bco2', 'pco2'], bco: 50712, pco: 0, bco2: 2016, pco2: 0, touch: true },
    checkbox: { attrs: ['val'], bco: 65535, pco: 0, touch: true },
    slider: { attrs: ['val', 'minval', 'maxval'], bco: 50712, pco: 1055, touch: true },
    progress: { attrs: ['val'], bco: 50712, pco: 1055, touch: false },
    gauge: { attrs: ['val'], bco: 65535, pco: 63488, touch: false },
    waveform: { attrs: [], bco: 0, pco: 2016, touch: false },
  };
  const TYPE_NAMES = Object.keys(TYPES);
  const WAVE_COLORS = [2016, 63488, 31, 65504];

  const DEFAULT_LAYOUT = `# Nextion screen layout - one object per line:
#   name type x y width height  "text"  option=value ...
# The screen is 800 x 480 pixels. Types: text number float button
# toggle checkbox slider progress gauge waveform
# Options: val= bco= pco= (colours: RED, GREEN, BLUE, ... or a
# number), min= max= (slider), dec= (float), size= (font),
# send=release|press|both|none (touch events), global
page main bco=0
t0 text 20 20 760 70 "Wirebench + Nextion" bco=1055 pco=WHITE size=40
t1 text 20 120 330 70 "Potentiometer" bco=0 pco=WHITE align=left
n0 number 360 120 180 70 0 bco=0 pco=YELLOW size=48
j0 progress 20 210 760 50 0 pco=2016
b0 button 20 300 240 100 "LED ON"
b1 button 280 300 240 100 "LED OFF"
z0 gauge 560 290 180 180 0 bco=0 pco=RED`;

  // ---------------------------------------------------------------- layout parser
  function tokenize(line) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1] !== undefined ? { str: m[1].replace(/\\(.)/g, '$1') } : { w: m[2] });
    return out;
  }
  function parseLayout(text) {
    const pages = [], errors = [];
    let page = null;
    const newPage = (name, line) => {
      if (!/^[A-Za-z_]\w{0,15}$/.test(name)) { errors.push(`line ${line}: page name "${name}" — use letters, digits and _`); name = 'page' + pages.length; }
      if (pages.some((p) => p.name === name)) errors.push(`line ${line}: two pages are called "${name}"`);
      page = { name, bco: 65535, objs: [] };
      pages.push(page);
      return page;
    };
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      const ln = i + 1;
      const line = raw.replace(/(^|\s)#.*$/, '').trim();
      if (!line) return;
      const tk = tokenize(line);
      const head = tk[0].w;
      if (head === 'page') {
        const pg = newPage(tk[1] && tk[1].w ? tk[1].w : 'page' + pages.length, ln);
        for (const t of tk.slice(2)) {
          const m = t.w && t.w.match(/^bco=(.+)$/);
          if (m && colorVal(m[1]) !== null) pg.bco = colorVal(m[1]);
          else errors.push(`line ${ln}: a page line takes only a name and bco=`);
        }
        return;
      }
      if (!page) newPage('page0', ln);
      const [nm, ty, ...rest] = tk;
      if (!nm || !nm.w || !/^[A-Za-z_]\w{0,13}$/.test(nm.w)) { errors.push(`line ${ln}: an object name like t0 or b1 comes first`); return; }
      if (!ty || !TYPES[ty.w]) { errors.push(`line ${ln}: "${ty ? ty.w || ty.str : ''}" is not a type — use ${TYPE_NAMES.join(', ')}`); return; }
      if (page.objs.some((o) => o.name === nm.w)) { errors.push(`line ${ln}: two objects are called ${nm.w} on page ${page.name}`); return; }
      if (page.objs.length >= 250) { errors.push(`line ${ln}: too many objects on one page`); return; }
      const geo = rest.slice(0, 4).map((t) => (t.w !== undefined ? Number(t.w) : NaN));
      if (geo.length < 4 || geo.some((v) => !Number.isFinite(v))) { errors.push(`line ${ln}: ${nm.w} needs x y width height (numbers)`); return; }
      const T = TYPES[ty.w];
      const o = {
        name: nm.w, type: ty.w, id: page.objs.length + 1,
        x: WB.clamp(Math.round(geo[0]), -SCREEN_W, SCREEN_W * 2), y: WB.clamp(Math.round(geo[1]), -SCREEN_H, SCREEN_H * 2),
        w: WB.clamp(Math.round(geo[2]), 1, SCREEN_W * 2), h: WB.clamp(Math.round(geo[3]), 1, SCREEN_H * 2),
        bco: T.bco, pco: T.pco, bco2: T.bco2, pco2: T.pco2, txt: '', val: 0, minval: 0, maxval: 100, vvs1: 1,
        size: 0, align: 'center', send: T.touch ? 'release' : 'none', global: false,
      };
      if (ty.w === 'text' || ty.w === 'button' || ty.w === 'toggle') o.txt = ty.w === 'text' ? 'newtxt' : 'newbutton';
      for (const t of rest.slice(4)) {
        if (t.str !== undefined) { o.txt = t.str.slice(0, 200); continue; }
        if (t.w === 'global') { o.global = true; continue; }
        if (/^-?\d+$/.test(t.w)) { o.val = Number(t.w); continue; }
        const m = t.w.match(/^(\w+)=(.*)$/);
        if (!m) { errors.push(`line ${ln}: "${t.w}" — write options as name=value`); continue; }
        const [, k, v] = m;
        if (['bco', 'pco', 'bco2', 'pco2'].includes(k)) { const c = colorVal(v); if (c === null) errors.push(`line ${ln}: ${k}=${v} is not a colour`); else o[k] = c; }
        else if (k === 'val' || k === 'min' || k === 'max' || k === 'dec' || k === 'size') {
          if (!/^-?\d+$/.test(v)) { errors.push(`line ${ln}: ${k}= needs a whole number`); continue; }
          const n = Number(v);
          if (k === 'val') o.val = n; else if (k === 'min') o.minval = n; else if (k === 'max') o.maxval = n;
          else if (k === 'dec') o.vvs1 = WB.clamp(n, 0, 6); else o.size = WB.clamp(n, 6, 200);
        } else if (k === 'send') { if (['press', 'release', 'both', 'none'].includes(v)) o.send = v; else errors.push(`line ${ln}: send= is press, release, both or none`); }
        else if (k === 'align') { if (['left', 'center', 'right'].includes(v)) o.align = v; else errors.push(`line ${ln}: align= is left, center or right`); }
        else if (k === 'txt') o.txt = v.slice(0, 200);
        else errors.push(`line ${ln}: unknown option ${k}=`);
      }
      page.objs.push(o);
    });
    if (!pages.length) newPage('page0', 0);
    return { pages, errors };
  }
  const layoutCache = new Map();
  function layoutOf(part) {
    const text = part.props.layout == null ? DEFAULT_LAYOUT : String(part.props.layout);
    let c = layoutCache.get(part.id);
    if (!c || c.text !== text) { c = { text, L: parseLayout(text) }; layoutCache.set(part.id, c); }
    return c.L;
  }

  // ---------------------------------------------------------------- the device
  const clone = (o) => Object.assign({}, o);
  class Device {
    constructor(part) {
      this.part = part;
      this.L = layoutOf(part);
      this.baud = Number(part.props.baud) || 9600;
      this.vals = this.L.pages.map((p) => p.objs.map(clone));   // live attributes of every object
      this.page = 0;
      this.hidden = new Set();
      this.ops = [];          // drawing commands (cls, fill, line, cir, xstr ...)
      this.clsColor = null;
      this.waves = {};        // "page:id" -> [ch0[], ch1[] ...]
      this.sys = { dim: 100, dims: 100, bkcmd: 2, sys0: 0, sys1: 0, sys2: 0, thsp: 0, thup: 0, sleep: 0, sendxy: 0, baud: this.baud, bauds: this.baud, ussp: 0, thdra: 0 };
      this.rx = [];
      this.ffs = 0;
      this.pressed = null;
      this.powered = false;
      this.sink = null;       // where reply bytes go (the port the sketch reads)
      this.log = null;        // warning output (set by the runtime)
      this.ver = 1;
    }
    changed() { this.ver++; if (WB.app && WB.app.sim) WB.app.markDirty(); }
    warn(key, msg) { if (this.log) this.log(key, msg); }
    send(bytes) { if (this.sink && this.powered) this.sink(bytes); }
    sendEnd(bytes) { this.send(bytes.concat([0xff, 0xff, 0xff])); }
    error(code, cmd, why) {
      if (this.sys.bkcmd === 2 || this.sys.bkcmd === 3) this.sendEnd([code]);
      this.warn('nexerr:' + cmd, `${this.part.name || 'Nextion'}: "${cmd}" — ${why} (the display replies with error 0x${code.toString(16).padStart(2, '0').toUpperCase()}).`);
    }
    ok() { if (this.sys.bkcmd === 1 || this.sys.bkcmd === 3) this.sendEnd([0x01]); }
    powerOn() {
      // what a real Nextion sends when it starts: 00 00 00 FF FF FF, then 88 FF FF FF ("ready")
      this.sendEnd([0, 0, 0]);
      this.sendEnd([0x88]);
    }

    // bytes from the Arduino
    feed(b) {
      if (!this.powered) return;
      if (b === 0xff) {
        if (++this.ffs === 3) {
          const cmd = String.fromCharCode(...this.rx);
          this.rx = []; this.ffs = 0;
          if (cmd.trim()) this.exec(cmd);
        }
        return;
      }
      if (this.ffs) { for (let i = 0; i < this.ffs; i++) this.rx.push(0xff); this.ffs = 0; }
      if (this.rx.length < 2048) this.rx.push(b);
    }

    // find an object by name, "page.name" or numeric id (for add / cle)
    find(ref, cmd) {
      let pg = this.page, name = ref;
      const dot = ref.indexOf('.');
      if (dot >= 0) {
        const pn = ref.slice(0, dot);
        const pi = this.L.pages.findIndex((p) => p.name === pn);
        if (pi < 0) return { err: [0x1a, `there is no page "${pn}"`] };
        pg = pi; name = ref.slice(dot + 1);
      }
      const list = this.vals[pg];
      const o = /^\d+$/.test(name) ? list[Number(name) - 1] : list.find((q) => q.name === name);
      if (!o) {
        const near = this.L.pages[this.page].objs.map((q) => q.name).find((n) => n.toLowerCase() === name.toLowerCase());
        return { err: [0x1a, `there is no object "${name}" on page ${this.L.pages[pg].name}${near ? ` (did you mean ${near}?)` : ''}`] };
      }
      if (pg !== this.page && !o.global) return { err: [0x1a, `${name} is on page ${this.L.pages[pg].name}, which is not showing — only objects marked "global" can be changed from another page`] };
      return { o, pg };
    }
    attrOk(o, a) { return a === 'bco' || a === 'pco' || a === 'id' || TYPES[o.type].attrs.includes(a); }

    // value of one operand: number, "string", colour name, obj.attr or system variable
    operand(t, cmd) {
      if (/^"/.test(t)) return { v: t.slice(1, -1).replace(/\\r/g, '\r') };
      if (/^-?\d+$/.test(t)) return { v: Number(t) };
      if (t in COLORS) return { v: COLORS[t] };
      if (t in this.sys) return { v: this.sys[t] };
      if (t === 'rand') return { v: Math.floor(Math.random() * 65536) };
      if (t === 'dp') return { v: this.page };
      const m = t.match(/^(.+)\.(\w+)$/);
      if (m) {
        const f = this.find(m[1], cmd);
        if (f.err) return f;
        if (!this.attrOk(f.o, m[2])) return { err: [0x1a, `${f.o.name} (${f.o.type}) has no attribute "${m[2]}"`] };
        return { v: f.o[m[2]] };
      }
      return { err: [0x1a, `"${t}" is not a value, object attribute or system variable`] };
    }
    // Nextion evaluates left to right, without operator precedence
    evaluate(expr, cmd) {
      const toks = expr.match(/"(?:[^"])*"|[+\-*/%]|[^+\-*/%"]+/g) || [];
      let acc = null, op = null;
      for (let t of toks) {
        t = t.trim();
        if (!t) continue;
        if (/^[+\-*/%]$/.test(t) && acc !== null && op === null) { op = t; continue; }
        if (t === '-' && acc === null) { op = 'neg'; continue; }
        const r = this.operand(t, cmd);
        if (r.err) return r;
        let v = r.v;
        if (op === 'neg') { v = -v; op = null; }
        if (acc === null) acc = v;
        else if (typeof acc === 'string' || typeof v === 'string') {
          if (op !== '+') return { err: [0x1b, 'text can only be joined with +'] };
          acc = String(acc) + String(v);
        } else {
          acc = op === '+' ? acc + v : op === '-' ? acc - v : op === '*' ? acc * v : op === '/' ? (v ? Math.trunc(acc / v) : 0) : v ? acc % v : 0;
          acc |= 0;
        }
        op = null;
      }
      if (acc === null || op !== null) return { err: [0x1b, 'the value is incomplete'] };
      return { v: acc };
    }
    setAttr(target, value, cmd) {
      if (target in this.sys && !/^(baud|bauds)$/.test(target)) {
        if (typeof value !== 'number') return this.error(0x1c, cmd, `${target} needs a number`);
        this.sys[target] = target === 'dim' || target === 'dims' ? WB.clamp(value, 0, 100) : value;
        if (target === 'dims') this.sys.dim = this.sys.dims;
        this.changed(); return this.ok();
      }
      if (target === 'baud' || target === 'bauds') {
        this.warn('nexbaud', `${this.part.name || 'Nextion'}: changing the baud rate is not simulated — set it in the display's settings, and use the same rate in begin().`);
        return this.ok();
      }
      const m = target.match(/^(.+)\.(\w+)$/);
      if (!m) return this.error(0x1a, cmd, `"${target}" is not an object attribute — write e.g. t0.txt= or n0.val=`);
      const f = this.find(m[1], cmd);
      if (f.err) return this.error(f.err[0], cmd, f.err[1]);
      const o = f.o, a = m[2];
      if (!this.attrOk(o, a) || a === 'id') return this.error(0x1a, cmd, `${o.name} (${o.type}) has no attribute "${a}" that can be set${a === 'value' || a === 'text' ? ` — use ${TYPES[o.type].attrs.join(' or ')}` : ''}`);
      const isTxt = a === 'txt';
      if (isTxt !== (typeof value === 'string')) return this.error(0x1c, cmd, isTxt ? `${o.name}.txt needs text in quotes, e.g. ${o.name}.txt="25"` : `${o.name}.${a} needs a number, not text`);
      if (isTxt) value = value.slice(0, 255);
      else if (a === 'val' && o.type === 'progress') value = WB.clamp(value, 0, 100);
      else if (a === 'val' && o.type === 'gauge') value = ((value % 360) + 360) % 360;
      else if (a === 'val' && (o.type === 'toggle' || o.type === 'checkbox')) value = value ? 1 : 0;
      else if (a === 'val' && o.type === 'slider') value = WB.clamp(value, o.minval, o.maxval);
      else if (a === 'vvs1') value = WB.clamp(value, 0, 6);
      else if (/co/.test(a)) value &= 0xffff;
      o[a] = value;
      this.changed();
      this.ok();
    }
    gotoPage(ref, cmd) {
      const i = /^\d+$/.test(ref) ? Number(ref) : this.L.pages.findIndex((p) => p.name === ref);
      if (!(i >= 0 && i < this.L.pages.length)) return this.error(0x03, cmd, `there is no page "${ref}" (pages: ${this.L.pages.map((p, k) => `${k} ${p.name}`).join(', ')})`);
      // local objects start again from their design values when a page is opened
      this.vals[i] = this.vals[i].map((o, k) => (o.global ? o : clone(this.L.pages[i].objs[k])));
      this.page = i; this.ops = []; this.clsColor = null; this.hidden.clear(); this.pressed = null;
      this.changed(); this.ok();
    }
    draw(op) { this.ops.push(op); if (this.ops.length > 3000) this.ops.splice(0, this.ops.length - 3000); this.changed(); this.ok(); }

    exec(raw) {
      const cmd = raw.trim();
      let m;
      // assignments: n0.val=5   t0.txt="hi"   n0.val+=2   n0.val++   dim=50
      if ((m = cmd.match(/^([\w.]+)\s*(\+\+|--)$/))) {
        const r = this.evaluate(m[1], cmd);
        if (r.err) return this.error(r.err[0], cmd, r.err[1]);
        return this.setAttr(m[1], r.v + (m[2] === '++' ? 1 : -1), cmd);
      }
      if ((m = cmd.match(/^([\w.]+)\s*([+\-*/%]?)=([\s\S]*)$/))) {
        if (!m[3].trim()) return this.error(0x1b, cmd, 'nothing after =');
        const expr = m[2] ? `${m[1]}${m[2]}${m[3]}` : m[3];
        const r = this.evaluate(expr, cmd);
        if (r.err) return this.error(r.err[0], cmd, r.err[1]);
        return this.setAttr(m[1], r.v, cmd);
      }
      const sp = cmd.indexOf(' ');
      const word = sp < 0 ? cmd : cmd.slice(0, sp);
      const argStr = sp < 0 ? '' : cmd.slice(sp + 1).trim();
      const args = argStr ? (argStr.match(/"[^"]*"|[^,]+/g) || []).map((s) => s.trim()) : [];
      const nums = (n) => {
        if (args.length !== n) return null;
        const out = [];
        for (const a of args) { const r = this.evaluate(a, cmd); if (r.err || typeof r.v !== 'number') return null; out.push(r.v); }
        return out;
      };
      const bad = (form) => this.error(0x1e, cmd, `wrong parameters — write ${form}`);
      switch (word) {
        case 'page': return args.length === 1 ? this.gotoPage(args[0], cmd) : bad('page 1 or page main');
        case 'ref': case 'ref_star': case 'ref_stop': case 'rest': case 'code_c': case 'doevents':
          if (word === 'rest') { this.vals = this.L.pages.map((p) => p.objs.map(clone)); this.page = 0; this.ops = []; this.clsColor = null; this.hidden.clear(); this.changed(); this.powerOn(); return; }
          return this.ok();
        case 'vis': {
          if (args.length !== 2) return bad('vis b0,0 (hide) or vis b0,1 (show)');
          const on = this.evaluate(args[1], cmd);
          if (on.err) return bad('vis b0,0');
          if (args[0] === '255') { for (const o of this.vals[this.page]) on.v ? this.hidden.delete(o.name) : this.hidden.add(o.name); }
          else { const f = this.find(args[0], cmd); if (f.err) return this.error(0x02, cmd, f.err[1]); on.v ? this.hidden.delete(f.o.name) : this.hidden.add(f.o.name); }
          this.changed(); return this.ok();
        }
        case 'tsw': return this.ok();
        case 'get': {
          if (args.length !== 1) return bad('get t0.txt or get n0.val');
          const r = this.evaluate(args[0], cmd);
          if (r.err) return this.error(r.err[0], cmd, r.err[1]);
          if (typeof r.v === 'string') this.sendEnd([0x70, ...Array.from(r.v, (ch) => ch.charCodeAt(0) & 255)]);
          else { const v = r.v | 0; this.sendEnd([0x71, v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]); }
          return;
        }
        case 'sendme': this.sendEnd([0x66, this.page]); return;
        case 'click': {
          if (args.length !== 2) return bad('click b0,1 (press) or click b0,0 (release)');
          const f = this.find(args[0], cmd);
          if (f.err) return this.error(0x02, cmd, f.err[1]);
          const ev = Number(args[1]) ? 1 : 0;
          this.event(f.o, ev);
          return this.ok();
        }
        case 'cls': { const c = nums(1); if (!c) return bad('cls BLACK or cls 2016'); this.ops = []; this.clsColor = c[0] & 0xffff; this.changed(); return this.ok(); }
        case 'fill': { const a = nums(5); return a ? this.draw({ t: 'fill', a }) : bad('fill x,y,w,h,colour'); }
        case 'line': { const a = nums(5); return a ? this.draw({ t: 'line', a }) : bad('line x1,y1,x2,y2,colour'); }
        case 'draw': { const a = nums(5); return a ? this.draw({ t: 'draw', a }) : bad('draw x1,y1,x2,y2,colour'); }
        case 'cir': { const a = nums(4); return a ? this.draw({ t: 'cir', a }) : bad('cir x,y,r,colour'); }
        case 'cirs': { const a = nums(4); return a ? this.draw({ t: 'cirs', a }) : bad('cirs x,y,r,colour'); }
        case 'xstr': {
          if (args.length !== 11) return bad('xstr x,y,w,h,font,pco,bco,xcen,ycen,sta,"text"');
          const t = this.evaluate(args[10], cmd);
          const a = [];
          for (const s of args.slice(0, 10)) { const r = this.evaluate(s, cmd); if (r.err || typeof r.v !== 'number') return bad('xstr x,y,w,h,font,pco,bco,xcen,ycen,sta,"text"'); a.push(r.v); }
          if (t.err) return this.error(t.err[0], cmd, t.err[1]);
          return this.draw({ t: 'xstr', a, s: String(t.v) });
        }
        case 'add': case 'cle': {
          const a = nums(word === 'add' ? 3 : 2);
          if (!a) return bad(word === 'add' ? 'add s0.id,channel,value (0–255)' : 'cle s0.id,channel');
          const o = this.vals[this.page][a[0] - 1];
          if (!o || o.type !== 'waveform') return this.error(0x02, cmd, `component id ${a[0]} on page ${this.L.pages[this.page].name} is not a waveform — use the waveform's id (s0.id)`);
          if (a[1] < 0 || a[1] > 3) return this.error(0x12, cmd, 'channel must be 0–3');
          const key = this.page + ':' + o.id;
          const w = (this.waves[key] = this.waves[key] || [[], [], [], []]);
          if (word === 'cle') { if (a[1] === 255) w.forEach((c) => (c.length = 0)); else w[a[1]].length = 0; }
          else { w[a[1]].push(WB.clamp(a[2], 0, 255)); if (w[a[1]].length > o.w) w[a[1]].splice(0, w[a[1]].length - o.w); }
          this.changed(); return word === 'add' ? undefined : this.ok();
        }
        case 'print': case 'prints': case 'printh':
          return this.warn('nexprint', `${this.part.name || 'Nextion'}: "${word}" runs on the display itself (in its touch events) and is not simulated.`);
        default:
          return this.error(0x00, cmd, `"${word}" is not a Nextion instruction (assignments look like t0.txt="hi" or n0.val=5)`);
      }
    }

    // touch event 0x65 page component event, sent if the object's "send component ID" is on
    event(o, ev) {
      if (o.send === 'both' || (o.send === 'press' && ev === 1) || (o.send === 'release' && ev === 0)) this.sendEnd([0x65, this.page, o.id, ev]);
    }
    touch(name, px) {
      if (!this.powered) return;
      const o = this.vals[this.page].find((q) => q.name === name);
      if (!o || this.hidden.has(name)) return;
      if (o.type === 'toggle' || o.type === 'checkbox') o.val = o.val ? 0 : 1;
      if (o.type === 'slider') o.val = Math.round(o.minval + WB.clamp((px - o.x) / Math.max(1, o.w), 0, 1) * (o.maxval - o.minval));
      this.pressed = name;
      this.event(o, 1);
      this.changed();
      const page = this.page;
      setTimeout(() => {
        if (this.pressed === name) this.pressed = null;
        if (this.page === page) this.event(o, 0);
        this.changed();
      }, 140);
    }
  }

  // ---------------------------------------------------------------- drawing
  const esc = (s) => WB.esc(String(s));
  function textAt(o, s, fill, size) {
    const fs = size || o.size || Math.round(WB.clamp(o.h * 0.5, 10, 64));
    const x = o.align === 'left' ? o.x + 8 : o.align === 'right' ? o.x + o.w - 8 : o.x + o.w / 2;
    const anchor = o.align === 'left' ? 'start' : o.align === 'right' ? 'end' : 'middle';
    return `<text x="${x}" y="${o.y + o.h / 2 + fs * 0.35}" font-size="${fs}" text-anchor="${anchor}" fill="${fill}" font-family="Arial, sans-serif">${esc(s)}</text>`;
  }
  function drawObj(o, pressed, wave) {
    const B = rgb565(o.bco), P = rgb565(o.pco);
    const box = (fill, rx) => `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${rx || 0}" fill="${fill}"/>`;
    switch (o.type) {
      case 'text': return box(B) + textAt(o, o.txt, P);
      case 'number': return box(B) + textAt(o, String(o.val | 0), P);
      case 'float': { const d = o.vvs1; return box(B) + textAt(o, ((o.val | 0) / Math.pow(10, d)).toFixed(d), P); }
      case 'button': {
        const on = pressed;
        return `${box(on ? rgb565(o.bco2) : B, 10)}<rect x="${o.x + 1}" y="${o.y + 1}" width="${o.w - 2}" height="${o.h - 2}" rx="9" fill="none" stroke="#0004" stroke-width="2"/>${textAt(o, o.txt, on ? rgb565(o.pco2) : P)}`;
      }
      case 'toggle': return `${box(o.val ? rgb565(o.bco2) : B, 10)}${textAt(o, o.txt, o.val ? rgb565(o.pco2) : P)}`;
      case 'checkbox': {
        const s = Math.min(o.w, o.h);
        return `${box(B)}<rect x="${o.x + 2}" y="${o.y + 2}" width="${s - 4}" height="${s - 4}" fill="#fff" stroke="${P}" stroke-width="3"/>${o.val ? `<path d="M${o.x + s * 0.2},${o.y + s * 0.5} L${o.x + s * 0.42},${o.y + s * 0.75} L${o.x + s * 0.82},${o.y + s * 0.25}" stroke="${P}" stroke-width="${Math.max(3, s / 8)}" fill="none"/>` : ''}`;
      }
      case 'slider': {
        const f = (o.val - o.minval) / Math.max(1, o.maxval - o.minval), th = Math.max(6, o.h / 4);
        const tx = o.x + WB.clamp(f, 0, 1) * o.w;
        return `<rect x="${o.x}" y="${o.y + o.h / 2 - th / 2}" width="${o.w}" height="${th}" rx="${th / 2}" fill="${B}"/>
          <rect x="${o.x}" y="${o.y + o.h / 2 - th / 2}" width="${Math.max(0, tx - o.x)}" height="${th}" rx="${th / 2}" fill="${P}"/>
          <circle cx="${tx}" cy="${o.y + o.h / 2}" r="${o.h * 0.42}" fill="#f2f2f2" stroke="#555" stroke-width="2"/>`;
      }
      case 'progress': return `${box(B)}<rect x="${o.x}" y="${o.y}" width="${(o.w * WB.clamp(o.val, 0, 100)) / 100}" height="${o.h}" fill="${P}"/>`;
      case 'gauge': {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = Math.min(o.w, o.h) / 2;
        const a = (o.val * Math.PI) / 180;            // 0 = pointing left, clockwise
        const nx = cx - Math.cos(a) * r * 0.85, ny = cy - Math.sin(a) * r * 0.85;
        return `${box(B)}<circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="#f4f4f4" stroke="#888" stroke-width="3"/>
          <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${P}" stroke-width="${Math.max(3, r / 18)}" stroke-linecap="round"/>
          <circle cx="${cx}" cy="${cy}" r="${Math.max(4, r / 12)}" fill="#333"/>`;
      }
      case 'waveform': {
        let s = box(B);
        for (let gx = o.x + 40; gx < o.x + o.w; gx += 40) s += `<line x1="${gx}" y1="${o.y}" x2="${gx}" y2="${o.y + o.h}" stroke="#1f3f1f" stroke-width="1"/>`;
        for (let gy = o.y + 40; gy < o.y + o.h; gy += 40) s += `<line x1="${o.x}" y1="${gy}" x2="${o.x + o.w}" y2="${gy}" stroke="#1f3f1f" stroke-width="1"/>`;
        (wave || []).forEach((ch, c) => {
          if (ch.length < 2) return;
          const pts = ch.map((v, i) => `${o.x + i},${(o.y + o.h - (v * o.h) / 255).toFixed(1)}`).join(' ');
          s += `<polyline points="${pts}" fill="none" stroke="${rgb565(c === 0 ? o.pco : WAVE_COLORS[c])}" stroke-width="2"/>`;
        });
        return s;
      }
    }
    return '';
  }
  function drawOp(op) {
    const a = op.a;
    switch (op.t) {
      case 'fill': return `<rect x="${a[0]}" y="${a[1]}" width="${Math.max(0, a[2])}" height="${Math.max(0, a[3])}" fill="${rgb565(a[4])}"/>`;
      case 'line': return `<line x1="${a[0]}" y1="${a[1]}" x2="${a[2]}" y2="${a[3]}" stroke="${rgb565(a[4])}" stroke-width="1.5"/>`;
      case 'draw': return `<rect x="${Math.min(a[0], a[2])}" y="${Math.min(a[1], a[3])}" width="${Math.abs(a[2] - a[0])}" height="${Math.abs(a[3] - a[1])}" fill="none" stroke="${rgb565(a[4])}" stroke-width="1.5"/>`;
      case 'cir': return `<circle cx="${a[0]}" cy="${a[1]}" r="${Math.max(0, a[2])}" fill="none" stroke="${rgb565(a[3])}" stroke-width="1.5"/>`;
      case 'cirs': return `<circle cx="${a[0]}" cy="${a[1]}" r="${Math.max(0, a[2])}" fill="${rgb565(a[3])}"/>`;
      case 'xstr': {
        const [x, y, w, h, font, pco, bco, xc, yc, sta] = a;
        const o = { x, y, w, h, size: [16, 24, 32, 40, 48, 64][WB.clamp(font, 0, 5)] || 24, align: xc === 0 ? 'left' : xc === 2 ? 'right' : 'center' };
        const bg = sta === 1 ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${rgb565(bco)}"/>` : '';
        return `${bg}<svg x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" overflow="hidden">${textAt(Object.assign(o, { x: 0, y: 0 }), op.s, rgb565(pco))}</svg>`;
      }
    }
    return '';
  }
  function screenSVG(part, dev, preview) {
    const L = dev ? dev.L : layoutOf(part);
    const pg = dev ? dev.page : 0;
    const objs = dev ? dev.vals[pg] : L.pages[0].objs;
    const bg = dev && dev.clsColor !== null ? dev.clsColor : L.pages[pg].bco;
    let s = `<rect x="0" y="0" width="${SCREEN_W}" height="${SCREEN_H}" fill="${rgb565(bg)}"/>`;
    if (dev) for (const op of dev.ops) s += drawOp(op);
    for (const o of objs) if (!dev || !dev.hidden.has(o.name)) s += drawObj(o, dev && dev.pressed === o.name, dev && dev.waves[pg + ':' + o.id]);
    if (preview && L.errors.length) {
      s += `<rect x="0" y="${SCREEN_H - 34 * Math.min(3, L.errors.length) - 10}" width="${SCREEN_W}" height="${34 * Math.min(3, L.errors.length) + 10}" fill="#600" opacity=".9"/>`;
      L.errors.slice(0, 3).forEach((e, i) => { s += `<text x="10" y="${SCREEN_H - 34 * (Math.min(3, L.errors.length) - i) + 18}" font-size="22" fill="#fff" font-family="Arial, sans-serif">${esc(e)}</text>`; });
    }
    if (dev && dev.sys.dim < 100) s += `<rect x="0" y="0" width="${SCREEN_W}" height="${SCREEN_H}" fill="#000" opacity="${((100 - dev.sys.dim) / 100 * 0.9).toFixed(2)}"/>`;
    return s;
  }

  // live devices of the running simulation, for drawing (render() only gets the small vis object)
  const LIVE = new Map();
  function deviceFor(sim, part) {
    sim.nex = sim.nex || {};
    let d = sim.nex[part.id];
    if (!d) {
      d = sim.nex[part.id] = new Device(part);
      if (WB.app && sim === WB.app.sim) LIVE.set(part.id, d);   // not the Bode plotter's private copy
    }
    return d;
  }
  WB.Nextion = { Device, deviceFor, parseLayout, DEFAULT_LAYOUT, PIN_IDS };

  const T = (x, y, s, txt, fill) => `<text x="${x}" y="${y}" font-size="${s}" text-anchor="middle" fill="${fill}" font-family="sans-serif">${txt}</text>`;
  WB.defPart('nextion', {
    label: 'Nextion 7" touch display', category: 'Displays', prefix: 'HMI', dynamic: true, interact: 'panel',
    defaults: { layout: DEFAULT_LAYOUT, baud: 9600 },
    pins: () => [
      { id: '5V', label: '+5V (red wire)', x: 0, y: 0, kind: 'pwr' },
      { id: 'TX', label: 'TX — display sends (to the Arduino\'s RX pin)', x: 10, y: 0 },
      { id: 'RX', label: 'RX — display receives (from the Arduino\'s TX pin)', x: 20, y: 0 },
      { id: 'GND', label: 'GND (black wire)', x: 30, y: 0, kind: 'gnd' },
    ],
    bbox: () => [-302, -412, 634, 415],
    summary: (p) => `800 × 480, serial ${p.props.baud || 9600} baud (SoftwareSerial or Serial). A real one draws about 0.5 A: power it from a separate 5 V supply`,
    inspector: [
      { key: 'layout', label: 'Screen layout', type: 'text', live: true },
      { key: 'baud', label: 'Baud rate', type: 'select', options: [[9600, '9600 (factory setting)'], [19200, '19200'], [38400, '38400'], [57600, '57600'], [115200, '115200']] },
    ],
    hit(lx, ly, part) {
      const app = WB.app;
      if (!app || !app.sim) return null;
      const px = (lx - SX) / K, py = (ly - SY) / K;
      if (px < 0 || py < 0 || px > SCREEN_W || py > SCREEN_H) return null;
      const d = app.sim.nex && app.sim.nex[part.id];
      if (!d || !d.powered) return null;
      const objs = d.vals[d.page];
      for (let i = objs.length - 1; i >= 0; i--) {
        const o = objs[i];
        if (d.hidden.has(o.name)) continue;
        if (px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h) return TYPES[o.type].touch || o.send !== 'none' ? `t:${o.name}:${Math.round(px)}` : null;
      }
      return null;
    },
    panelAction(part, act, app) {
      const [, name, px] = act.split(':');
      const d = app.sim && app.sim.nex && app.sim.nex[part.id];
      if (d) d.touch(name, Number(px));
    },
    elements: (c) => [{ t: 'R', a: c.n('5V'), b: c.n('GND'), r: 12 }],
    visualize(c) {
      const d = deviceFor(c.sim, c.part);
      const on = c.V('5V') - c.V('GND') > 4.2;
      if (on !== d.powered) {
        d.powered = on;
        if (!on) { d.vals = d.L.pages.map((p) => p.objs.map(clone)); d.page = 0; d.ops = []; d.clsColor = null; d.hidden.clear(); }
        d.ver++;
      }
      if (!on && c.V('5V') - c.V('GND') > 1) c.warn(`${c.name}: only ${(c.V('5V') - c.V('GND')).toFixed(1)} V on 5V — the display needs 4.75–7 V.`);
      return { on, ver: d.ver };
    },
    render(p, v) {
      v = v || {};
      const live = v.ver !== undefined;
      const d = live ? LIVE.get(p.id) : null;
      const W = SCREEN_W * K, H = SCREEN_H * K;
      let screen;
      if (live && !(v.on && d)) screen = `<rect x="${SX}" y="${SY}" width="${W}" height="${H}" fill="#0b0c0e"/>${T(SX + W / 2, SY + H / 2, 12, 'no power — wire +5V and GND', '#555')}`;
      else screen = `<g transform="translate(${SX},${SY}) scale(${K})"><svg width="${SCREEN_W}" height="${SCREEN_H}" overflow="hidden">${screenSVG(p, d, !live)}</svg></g>`;
      return `<path d="M0,0 V-8 M10,0 V-8 M20,0 V-8 M30,0 V-8" ${WB.LEG}/>
        <rect x="-300" y="-410" width="630" height="402" rx="8" fill="#16171a" stroke="#000"/>
        <rect x="${SX - 3}" y="${SY - 3}" width="${W + 6}" height="${H + 6}" rx="2" fill="#000"/>
        ${screen}
        <rect x="-6" y="-14" width="42" height="9" rx="1.5" fill="#f4f4f4" stroke="#999"/>
        ${T(0, -17, 5, '+5V', '#e25555')}${T(10, -17, 5, 'TX', '#6aa8ff')}${T(20, -17, 5, 'RX', '#f2c200')}${T(30, -17, 5, 'GND', '#aaa')}
        ${T(250, -18, 8, 'NEXTION  7"  NX8048T070', '#777')}
        ${live ? '' : T(-200, -18, 7, 'layout preview', '#666')}`;
    },
  });
})(window.WB);

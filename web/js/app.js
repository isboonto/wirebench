'use strict';
(function (WB) {
  const PARTS = WB.PARTS;
  const $ = (s) => document.querySelector(s);
  const LS_KEY = 'wirebench.autosave.v1';
  // version of the .wbproj file format written by Save (1 = the older plain .json project files)
  const PROJECT_FORMAT = 2;
  // circuit warnings on the canvas: shown at least this long after they last occurred, then faded out
  const WARN_HOLD = 4000, WARN_FADE = 600, WARN_MAX = 4;

  // ------------------------------------------------------------ audio
  const Audio = {
    ctx: null, osc: {}, muted: false,
    ensure() {
      try { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { /* no audio */ }
    },
    set(id, freq) {
      if (!this.ctx || this.muted) freq = 0;
      let o = this.osc[id];
      if (freq > 0) {
        if (!o) {
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          osc.type = 'square'; g.gain.value = 0.035;
          osc.connect(g).connect(this.ctx.destination);
          osc.start();
          o = this.osc[id] = { osc, g, f: 0 };
        }
        if (o.f !== freq) { o.osc.frequency.setValueAtTime(freq, this.ctx.currentTime); o.f = freq; }
      } else if (o) {
        try { o.osc.stop(); o.osc.disconnect(); } catch (e) { /* ignore */ }
        delete this.osc[id];
      }
    },
    stopAll() { for (const id in this.osc) this.set(id, 0); },
  };

  // ------------------------------------------------------------ code editor
  const KW = new Set('if else for while do switch case default break continue return goto sizeof const static volatile unsigned signed struct class new delete true false void bool boolean char short int long float double byte word String size_t uint8_t int8_t uint16_t int16_t uint32_t int32_t uint64_t int64_t auto'.split(' '));
  const FN = new Set('setup loop pinMode digitalWrite digitalRead analogRead analogWrite analogReadResolution analogWriteResolution delay delayMicroseconds millis micros tone noTone map constrain min max abs random randomSeed attachInterrupt detachInterrupt digitalPinToInterrupt pulseIn shiftOut bitRead bitWrite bitSet bitClear sqrt pow sin cos Serial Monitor Bridge Servo Arduino_LED_Matrix ArduinoLEDMatrix'.split(' '));
  const CONST = new Set('HIGH LOW INPUT OUTPUT INPUT_PULLUP INPUT_PULLDOWN LED_BUILTIN A0 A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15 RISING FALLING CHANGE DEC HEX BIN OCT PI'.split(' '));
  function highlight(src) {
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[^\n]*)|(\b\d[\w.]*\b)|([A-Za-z_]\w*)/gm;
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      out += WB.esc(src.slice(last, m.index));
      const t = WB.esc(m[0]);
      if (m[1]) out += `<span class="t-com">${t}</span>`;
      else if (m[2]) out += `<span class="t-str">${t}</span>`;
      else if (m[3]) out += `<span class="t-pre">${t}</span>`;
      else if (m[4]) out += `<span class="t-num">${t}</span>`;
      else if (KW.has(m[0])) out += `<span class="t-kw">${t}</span>`;
      else if (FN.has(m[0])) out += `<span class="t-fn">${t}</span>`;
      else if (CONST.has(m[0])) out += `<span class="t-const">${t}</span>`;
      else out += t;
      last = re.lastIndex;
    }
    return out + WB.esc(src.slice(last));
  }

  // ------------------------------------------------------------ project files
  // A project file can come from anyone (a shared lab file, a download), so everything in it is
  // checked before it reaches the screen: only known part types, well-formed ids, pins, numbers
  // and colours, and setting values from each part's own list. Anything else falls back to the
  // part's default, so no text in a file can inject markup or script into the page.
  const UNSAFE = /[<>"'`\\]/;
  const SAFE_ID = /^[\w.-]{1,64}$/;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const ownKeys = (o) => (o && typeof o === 'object' ? Object.keys(o).filter((k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype') : []);
  // plain data with no unsafe text anywhere inside (for settings that have no inspector field)
  function safeData(v, depth) {
    if (v === null || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'string') return v.length <= 4000 && !UNSAFE.test(v);
    if (depth > 4 || typeof v !== 'object') return false;
    if (Array.isArray(v)) return v.length <= 100000 && v.every((x) => safeData(x, depth + 1));
    return ownKeys(v).every((k) => SAFE_ID.test(k) && safeData(v[k], depth + 1));
  }
  function cleanProps(def, raw) {
    const props = WB.clone(def.defaults || {});
    const fields = {};
    for (const f of def.inspector || []) fields[f.key] = f;
    for (const k of ownKeys(raw)) {
      if (!SAFE_ID.test(k)) continue;
      const v = raw[k], f = fields[k];
      if (f && f.type === 'select') {
        if ((f.options || []).some((o) => (Array.isArray(o) ? o[0] : o) === v)) props[k] = v;
      } else if (f && (f.type === 'number' || f.type === 'range')) {
        if (typeof v === 'number' && Number.isFinite(v)) props[k] = v;
      } else if (f && f.type === 'text') {
        if (typeof v === 'string') props[k] = v.slice(0, 20000); // note text: always shown escaped
      } else if (safeData(v, 0)) props[k] = WB.clone(v);
    }
    return props;
  }
  function cleanProject(o) {
    o = o && typeof o === 'object' ? o : {};
    const ids = new Map(); // id in the file -> id used here
    const parts = [];
    for (const p of Array.isArray(o.parts) ? o.parts : []) {
      if (!p || typeof p !== 'object' || typeof p.type !== 'string' || !Object.prototype.hasOwnProperty.call(PARTS, p.type)) continue;
      const def = PARTS[p.type];
      const id = typeof p.id === 'string' && SAFE_ID.test(p.id) && !ids.has(p.id) ? p.id : WB.uid((def.prefix || 'p').toLowerCase());
      if (typeof p.id === 'string' || typeof p.id === 'number') ids.set(String(p.id), id);
      parts.push({
        id, type: p.type,
        x: num(p.x, 0), y: num(p.y, 0), rot: [0, 90, 180, 270].includes(p.rot) ? p.rot : 0,
        name: typeof p.name === 'string' ? p.name.replace(/[<>"'`\\]/g, '').slice(0, 40) : '',
        props: cleanProps(def, p.props),
      });
    }
    const end = (e) => (e && typeof e === 'object' && ids.has(String(e.part)) && typeof e.pin === 'string' && e.pin.length <= 32 && !UNSAFE.test(e.pin)
      ? { part: ids.get(String(e.part)), pin: e.pin } : null);
    const wires = [];
    for (const w of Array.isArray(o.wires) ? o.wires : []) {
      const a = end(w && w.a), b = end(w && w.b);
      if (!a || !b) continue;
      const wire = {
        id: typeof w.id === 'string' && SAFE_ID.test(w.id) ? w.id : WB.uid('w'), a, b,
        pts: (Array.isArray(w.pts) ? w.pts : []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])).map((q) => [q[0], q[1]]),
        color: typeof w.color === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(w.color) ? w.color : '#2f7de1',
      };
      if (w.route === true) wire.route = true;
      if (typeof w.auto === 'boolean') wire.auto = w.auto;
      wires.push(wire);
    }
    return { parts, wires, code: typeof o.code === 'string' ? o.code : WB.DEFAULT_CODE };
  }
  WB.cleanProject = cleanProject;

  class CodeEditor {
    constructor(onChange) {
      this.ta = $('#code'); this.hl = $('#hl'); this.gutter = $('#gutter'); this.errEl = $('#err-line');
      this.onChange = onChange;
      this.errLine = null;
      this.ta.addEventListener('input', () => { this.clearError(); this.update(); this.onChange(); });
      this.ta.addEventListener('scroll', () => this.sync());
      this.ta.addEventListener('keydown', (e) => this.key(e));
    }
    get value() { return this.ta.value; }
    set value(v) { this.ta.value = v; this.clearError(); this.update(); this.ta.scrollTop = 0; }
    update() {
      this.hl.innerHTML = highlight(this.ta.value) + '\n';
      const n = this.ta.value.split('\n').length;
      let g = '';
      for (let i = 1; i <= n; i++) g += `<div${i === this.errLine ? ' class="err"' : ''}>${i}</div>`;
      this.gutter.innerHTML = g;
      this.sync();
    }
    sync() {
      this.hl.style.transform = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`;
      this.gutter.style.transform = `translateY(${-this.ta.scrollTop}px)`;
      if (this.errLine) {
        const lh = parseFloat(getComputedStyle(this.ta).lineHeight);
        this.errEl.style.top = 8 + (this.errLine - 1) * lh - this.ta.scrollTop + 'px';
      }
    }
    showError(line, noScroll) {
      this.errLine = line;
      this.errEl.style.display = 'block';
      this.update();
      const lh = parseFloat(getComputedStyle(this.ta).lineHeight);
      const y = (line - 1) * lh;
      if (!noScroll && (y < this.ta.scrollTop || y > this.ta.scrollTop + this.ta.clientHeight - 40)) this.ta.scrollTop = Math.max(0, y - 60);
      this.sync();
    }
    clearError() { if (this.errLine) { this.errLine = null; this.errEl.style.display = 'none'; this.update(); } }
    key(e) {
      const ta = this.ta;
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        const before = ta.value.slice(0, ta.selectionStart);
        const line = before.slice(before.lastIndexOf('\n') + 1);
        let ind = (line.match(/^\s*/) || [''])[0];
        if (/\{\s*$/.test(line)) ind += '  ';
        e.preventDefault();
        document.execCommand('insertText', false, '\n' + ind);
      } else if (e.key === '}') {
        const before = ta.value.slice(0, ta.selectionStart);
        const line = before.slice(before.lastIndexOf('\n') + 1);
        if (/^\s+$/.test(line) && line.length >= 2) {
          e.preventDefault();
          ta.selectionStart = ta.selectionStart - 2;
          document.execCommand('insertText', false, '}');
        }
      }
    }
  }

  // ------------------------------------------------------------ app
  class App {
    constructor() {
      this.project = { parts: [], wires: [], code: '' };
      this.selection = new Set();
      this.undoStack = [];
      this.redoStack = [];
      this.transient = {};
      this.sim = null;
      this.results = null;
      this.topo = null;
      this.dirty = false;
      this.serialBuf = '';
      this.warnShown = '';
      this.applyTheme(); // Default / Light / Dark, plus the canvas override (◐)
      this.autoRoute = true;
      try { this.autoRoute = localStorage.getItem('wirebench.autoroute') !== 'off'; } catch (e) { /* storage unavailable */ }
      this.editor = new WB.Editor(this);
      this.code = new CodeEditor(() => {
        this.project.code = this.code.value;
        this.saveLocalSoon();
        this.updateModified();
        const st = $('#code-status'); st.className = 'busy'; st.textContent = 'Checking…';
        this.scheduleLiveCheck();
      });
      this.hiddenCats = new Set();
      try { this.hiddenCats = new Set(JSON.parse(localStorage.getItem('wirebench.hiddenCats') || '[]')); } catch (e) { /* storage unavailable */ }
      WB.applyIcons();
      this.buildPalette();
      this.bindUI();
      let panelPref = null;
      try { panelPref = localStorage.getItem('wirebench.codePanel'); } catch (e) { /* storage unavailable */ }
      if (panelPref === 'hidden') this.setCodePanel(false, true); else $('#btn-panel').classList.add('active');
      this.loadLayout();
      const saved = this.loadLocal();
      if (saved) this.loadProject(saved, true);
      else this.loadProject(WB.EXAMPLES[1].build(), true);
      let docName = null;
      try { docName = localStorage.getItem('wirebench.docName'); } catch (e) { /* storage unavailable */ }
      this.setDocName(saved && docName ? docName : 'Untitled');
      // unsaved-changes tracking: fingerprint of the project as last saved / opened
      try { this.savedSig = saved ? localStorage.getItem('wirebench.savedSig') : null; } catch (e) { this.savedSig = null; }
      if (!this.savedSig) this.markSaved(); else this.updateModified();
      if (WB.isDesktop) this.bindDesktopWindow();
      // desktop app started by double-clicking a .wbproj file: open that file
      // (after asking, if the work restored from the last session was never saved)
      if (WB.isDesktop) WB.invoke('startup_file').then((f) => {
        if (f) this.askSaveChanges(`opening ${f.name.split(/[\\/]/).pop()}`).then((go) => { if (go) this.openProjectText(f.contents, f.name); });
      }).catch(() => {});
      requestAnimationFrame(() => this.editor.fit());
      WB.nativeReady.then(() => { this.refreshInspector(); this.markDirty(); });
      this.frame = this.frame.bind(this);
      requestAnimationFrame(this.frame);
    }

    // ---------------- model helpers
    part(id) { return this.project.parts.find((p) => p.id === id); }
    wire(id) { return this.project.wires.find((w) => w.id === id); }
    boardPart() { return this.project.parts.find((p) => PARTS[p.type] && PARTS[p.type].board); }
    getTopo() { return this.topo || (this.topo = WB.Circuit.build(this.project)); }
    snapshot() { return JSON.stringify({ parts: this.project.parts, wires: this.project.wires }); }
    pushUndo(snap) {
      this.undoStack.push(snap || this.snapshot());
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    // While simulating, the circuit is locked: it can be operated (buttons, knobs) but not edited.
    locked() { return !!this.sim; }
    lockedToast() {
      const now = performance.now();
      if (now - (this._lockT || 0) > 1500) { this._lockT = now; this.toast('🔒 Stop the simulation to edit the circuit.'); }
      return false;
    }
    mutate(fn) {
      if (this.locked()) return this.lockedToast();
      const s = this.snapshot(); fn(); this.pushUndo(s); this.changed();
      return true;
    }
    changed() {
      this.topo = null;
      for (const id of [...this.selection]) if (!this.part(id) && !this.wire(id)) this.selection.delete(id);
      this.editor.render();
      this.markDirty();
      this.saveLocal();
      this.updateModified();
      this.refreshInspector();
      this.refreshPropDialog();
      this.updateBoardLabel();
    }
    restore(s) {
      const o = JSON.parse(s);
      this.project.parts = o.parts;
      this.project.wires = o.wires;
      this.changed();
    }
    undo() { if (this.locked()) return this.lockedToast(); if (!this.undoStack.length) return this.toast('Nothing to undo'); this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); }
    redo() { if (this.locked()) return this.lockedToast(); if (!this.redoStack.length) return this.toast('Nothing to redo'); this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); }

    nextName(prefix) {
      let n = 1;
      const names = new Set(this.project.parts.map((p) => p.name));
      while (names.has(prefix + n)) n++;
      return prefix + n;
    }
    addPart(type, at) {
      if (this.locked()) return this.lockedToast();
      const def = PARTS[type];
      if (def.board && this.boardPart()) {
        const b = this.boardPart();
        if (!confirm(`This project already has a ${PARTS[b.type].label}. Replace it with a ${def.label}? (Wires to matching pins are kept.)`)) return;
        this.changeBoardType(b, type);
        return;
      }
      const [bx, by, bw, bh] = def.bbox(WB.clone(def.defaults));
      if (!at) {
        const r = this.editor.svg.getBoundingClientRect();
        at = { x: (r.width / 2 - this.editor.view.x) / this.editor.view.s, y: (r.height / 2 - this.editor.view.y) / this.editor.view.s };
      }
      const part = { id: WB.uid(def.prefix.toLowerCase()), type, x: WB.snap(at.x - bx - bw / 2), y: WB.snap(at.y - by - bh / 2), rot: 0, props: WB.clone(def.defaults), name: this.nextName(def.prefix) };
      this.mutate(() => { this.project.parts.push(part); this.selection = new Set([part.id]); });
    }
    // Toolbar "📝 Note" / key N: drop a note in the middle of the view and open its editor
    // with the placeholder text selected, so typing replaces it.
    addNote() {
      const before = this.project.parts.length;
      this.addPart('note');
      if (this.project.parts.length === before) return; // locked (simulation running)
      const p = this.project.parts[this.project.parts.length - 1];
      const r = this.editor.svg.getBoundingClientRect();
      this.openPropDialog(p.id, r.left + r.width / 2 + 120, r.top + r.height / 2 - 60);
      const ta = $('#prop-dialog textarea');
      if (ta) { ta.focus(); ta.select(); }
    }
    changeBoardType(b, type) {
      this.mutate(() => {
        b.type = type;
        b.props = WB.clone(PARTS[type].defaults);
        const ok = new Set(PARTS[type].pins({}).map((p) => p.id));
        this.project.wires = this.project.wires.filter((w) => !((w.a.part === b.id && !ok.has(w.a.pin)) || (w.b.part === b.id && !ok.has(w.b.pin))));
      });
      if (this.sim) this.stopSim();
      this.scheduleLiveCheck(); // libraries may not suit the new board
    }
    deleteSelection() {
      if (!this.selection.size) return;
      this.mutate(() => {
        const ids = this.selection;
        this.project.parts = this.project.parts.filter((p) => !ids.has(p.id));
        this.project.wires = this.project.wires.filter((w) => !ids.has(w.id) && !ids.has(w.a.part) && !ids.has(w.b.part));
        this.selection = new Set();
      });
    }
    rotateSelection(dir) {
      const parts = [...this.selection].map((id) => this.part(id)).filter(Boolean);
      if (!parts.length) return;
      this.mutate(() => {
        for (const p of parts) p.rot = (((p.rot || 0) + (dir || 90)) % 360 + 360) % 360;
        const ids = new Set(parts.map((p) => p.id));
        const affected = this.project.wires.filter((w) => w.auto && (ids.has(w.a.part) || ids.has(w.b.part)));
        if (affected.length) WB.Router.routeMany(this, affected);
      });
    }

    // ---------------- wire auto-routing
    setAutoRoute(on) {
      this.autoRoute = on;
      try { localStorage.setItem('wirebench.autoroute', on ? 'on' : 'off'); } catch (e) { /* storage unavailable */ }
      this.toast(on ? 'New wires will be auto-routed' : 'Auto-routing of new wires is off');
    }
    // Tidy the selected wires, or every wire when none is selected.
    tidyAllWires() {
      const sel = this.project.wires.filter((w) => this.selection.has(w.id));
      const wires = sel.length ? sel : this.project.wires;
      if (!wires.length) { this.toast('There are no wires to tidy.'); return; }
      let n = 0;
      if (this.mutate(() => { n = WB.Router.routeMany(this, wires); })) this.toast(`Tidied ${n} wire${n === 1 ? '' : 's'}`);
    }
    // ---------------- clipboard (Ctrl+C / Ctrl+X / Ctrl+V)
    copySelection(cut) {
      if (cut && this.locked()) return this.lockedToast();
      const parts = [...this.selection].map((id) => this.part(id)).filter(Boolean);
      if (!parts.length) { this.toast('Select one or more parts to copy.'); return false; }
      const ids = new Set(parts.map((p) => p.id));
      const wires = this.project.wires.filter((w) => ids.has(w.a.part) && ids.has(w.b.part));
      this.clipboard = { parts: WB.clone(parts), wires: WB.clone(wires), pastes: 0 };
      if (cut) { this.deleteSelection(); this.toast(`Cut ${parts.length} part${parts.length > 1 ? 's' : ''}`); }
      else this.toast(`Copied ${parts.length} part${parts.length > 1 ? 's' : ''} — Ctrl+V to paste`);
      return true;
    }
    paste() {
      const cb = this.clipboard;
      if (!cb || !cb.parts.length) { this.toast('Nothing to paste — copy a part first (Ctrl+C).'); return; }
      let parts = WB.clone(cb.parts);
      if (parts.some((p) => PARTS[p.type].board) && this.boardPart()) {
        parts = parts.filter((p) => !PARTS[p.type].board);
        this.toast('The board was skipped — a project can only have one microcontroller board.');
        if (!parts.length) return;
      }
      // Place at the mouse pointer when it is over the canvas, otherwise step away from the original.
      const boxes = parts.map((p) => WB.worldBBox(p));
      const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
      let dx, dy;
      const m = this.editor.mouseWorld;
      if (m && this.editor.mouseInside) { dx = WB.snap(m.x - x0); dy = WB.snap(m.y - y0); }
      else { cb.pastes++; dx = dy = 30 * cb.pastes; }
      const map = {};
      for (const p of parts) { map[p.id] = WB.uid(PARTS[p.type].prefix.toLowerCase()); }
      this.mutate(() => {
        for (const p of parts) {
          p.id = map[p.id]; p.x += dx; p.y += dy;
          p.name = this.nextName(PARTS[p.type].prefix);
          this.project.parts.push(p);
        }
        for (const w of cb.wires) {
          if (!map[w.a.part] || !map[w.b.part]) continue;
          this.project.wires.push({ id: WB.uid('w'), a: { part: map[w.a.part], pin: w.a.pin }, b: { part: map[w.b.part], pin: w.b.pin }, pts: (w.pts || []).map(([x, y]) => [x + dx, y + dy]), color: w.color });
        }
        this.selection = new Set(parts.map((p) => p.id));
      });
    }

    // Copies the selected parts (and wires running between them). Returns true if anything was copied.
    duplicateSelection(offset) {
      if (this.locked()) return this.lockedToast();
      const off = offset === undefined ? 30 : offset;
      const parts = [...this.selection].map((id) => this.part(id)).filter(Boolean);
      if (!parts.length) { this.toast('Select a part to duplicate.'); return false; }
      if (parts.some((p) => PARTS[p.type].board)) { this.toast('Only one microcontroller board per project — boards can\'t be duplicated.'); return false; }
      const map = {};
      const copies = parts.map((p) => { const c = WB.clone(p); c.id = WB.uid(PARTS[p.type].prefix.toLowerCase()); map[p.id] = c.id; c.x += off; c.y += off; return c; });
      this.mutate(() => {
        for (const c of copies) { c.name = this.nextName(PARTS[c.type].prefix); this.project.parts.push(c); }
        for (const w of this.project.wires.slice()) {
          if (map[w.a.part] && map[w.b.part]) this.project.wires.push({ id: WB.uid('w'), a: { part: map[w.a.part], pin: w.a.pin }, b: { part: map[w.b.part], pin: w.b.pin }, pts: (w.pts || []).map(([x, y]) => [x + off, y + off]), color: w.color });
        }
        this.selection = new Set(copies.map((c) => c.id));
      });
      return true;
    }

    // ---------------- selection & inspector
    select(id, add) {
      if (add) { if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); }
      else this.selection = new Set([id]);
      this.selectionChanged();
    }
    clearSelection() { if (!this.selection.size) return; this.selection = new Set(); this.selectionChanged(); }
    selectionChanged() { this.editor.refreshSelection(); this.editor.renderWires(); this.refreshInspector(); }

    refreshInspector() {
      const el = $('#inspector');
      const ids = [...this.selection];
      if (!ids.length) {
        const b = this.boardPart();
        el.innerHTML = `<div class="insp-empty">
          <p>Select a part or wire to edit it.</p>
          ${b ? `<p class="muted">Board: <b>${WB.esc(PARTS[b.type].label)}</b></p><p class="muted small">${WB.esc(PARTS[b.type].board.info)}</p>` : '<p class="muted">Add a board from <b>Boards</b> to run code.</p>'}
          <p class="muted small">Tip: during simulation, press buttons, flip switches and drag knobs (potentiometer, light, temperature) right on the breadboard.</p>
          <p class="muted small">Circuit solver: <b>${WB.esc(WB.Native.kind)}</b>${WB.isDesktop ? ' · desktop app' : ''}</p></div>`;
        return;
      }
      if (ids.length > 1) {
        el.innerHTML = `<div class="insp-title">${ids.length} items selected</div><div class="insp-actions"><button data-act="rotate">⟳ Rotate</button><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button></div>`;
        this.bindInspectorActions(el);
        if (this.locked()) this.lockForm(el);
        return;
      }
      const w = this.wire(ids[0]);
      if (w) {
        const pa = this.part(w.a.part), pb = this.part(w.b.part);
        el.innerHTML = `<div class="insp-title">Wire</div>
          <div class="muted small">${WB.esc(pa ? pa.name : '?')}.${WB.esc(w.a.pin)} → ${WB.esc(pb ? pb.name : '?')}.${WB.esc(w.b.pin)}</div>
          <label class="field-label">Color</label>
          <div class="swatches">${WB.WIRE_COLORS.map((c) => `<button class="sw${c === w.color ? ' on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
          <div class="insp-actions"><button data-act="autoroute">${WB.icon('route')} Auto-route</button><button data-act="straight">Remove joints</button><button data-act="del" class="danger">Delete</button></div>`;
        el.querySelectorAll('.sw').forEach((b) => b.addEventListener('click', () => this.mutate(() => { w.color = b.dataset.color; })));
        this.bindInspectorActions(el, w);
        if (this.locked()) this.lockForm(el);
        return;
      }
      const p = this.part(ids[0]);
      if (!p) return;
      this.renderPartForm(el, p, 'insp', true);
    }

    // Settings form for one part — used by the inspector and the double-click dialog.
    renderPartForm(el, p, prefix, withTitle) {
      const def = PARTS[p.type];
      let html = withTitle
        ? `<div class="insp-title"><input class="name" value="${WB.esc(p.name || '')}" title="Part label"></div><div class="muted small">${WB.esc(def.label)}${def.summary ? ' · ' + WB.esc(def.summary(p)) : ''}</div>`
        : `<label class="field-label">Name</label><input class="name wide" value="${WB.esc(p.name || '')}"><div class="muted small" style="margin-top:4px">${WB.esc(def.label)}${def.summary ? ' · ' + WB.esc(def.summary(p)) : ''}</div>`;
      if (def.board) {
        html += `<label class="field-label">Board type</label><select data-board>${Object.keys(WB.BOARDS).map((t) => `<option value="${t}"${t === p.type ? ' selected' : ''}>${WB.esc(WB.BOARDS[t].label)}</option>`).join('')}</select>
          <p class="muted small">${WB.esc(def.board.info)}</p>`;
      }
      (def.inspector || []).forEach((f, i) => {
        const v = p.props[f.key];
        html += `<label class="field-label">${WB.esc(f.label)}${f.type === 'range' ? ` <span class="val" data-val="${i}">${WB.esc(f.fmt(v))}</span>` : ''}</label>`;
        if (f.type === 'select') {
          html += `<select data-f="${i}"${f.live ? ' data-live' : ''}>${f.options.map((o, j) => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${j}"${ov === v ? ' selected' : ''}>${WB.esc(ol)}</option>`; }).join('')}</select>`;
        } else if (f.type === 'number') {
          html += `<input type="number" data-f="${i}"${f.live ? ' data-live' : ''} value="${v}"${f.min !== undefined ? ` min="${f.min}"` : ''} step="${f.step || 'any'}" list="dl-${prefix}-${i}">`;
          if (f.suggestions) html += `<datalist id="dl-${prefix}-${i}">${f.suggestions.map((s) => `<option value="${s}">${(f.sugFmt || WB.fmtOhms)(s)}</option>`).join('')}</datalist>`;
        } else if (f.type === 'range') {
          html += `<input type="range" data-f="${i}" value="${v}" min="${f.min}" max="${f.max}" step="${f.step}">`;
        } else if (f.type === 'text') {
          html += `<textarea data-f="${i}" data-live rows="5" spellcheck="true">${WB.esc(v == null ? '' : v)}</textarea>`;
        }
      });
      html += this.pinoutHTML(def, p);
      if (def.modulino) html += `<p class="muted small" style="margin-top:10px">Connects over I2C (Qwiic). Use the Modulino library in your sketch.</p><button data-act="qwiic" class="wide-btn">🔌 Connect to board (Qwiic)</button>`;
      else if (!(def.inspector || []).length && !def.board) html += `<p class="muted small" style="margin-top:10px">This part has no settings.</p>`;
      html += `<div class="insp-actions"><button data-act="rotate">⟳ Rotate</button><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button></div>`;
      el.innerHTML = html;
      el.querySelector('.name').addEventListener('change', (e) => this.mutate(() => { p.name = e.target.value.trim() || p.name; }));
      const bs = el.querySelector('[data-board]');
      if (bs) bs.addEventListener('change', () => this.changeBoardType(p, bs.value));
      (def.inspector || []).forEach((f, i) => {
        const inp = el.querySelector(`[data-f="${i}"]`);
        if (!inp) return;
        if (f.type === 'range') {
          inp.addEventListener('input', () => {
            p.props[f.key] = Number(inp.value);
            el.querySelector(`[data-val="${i}"]`).textContent = f.fmt(p.props[f.key]);
            this.editor.rerenderBody(p);
            this.markDirty();
            this.saveLocalSoon();
          });
          // keep the other form (inspector <-> dialog) in sync once the slider is released
          inp.addEventListener('change', () => { if (prefix === 'dlg') this.refreshInspector(); else this.refreshPropDialog(); });
        } else if (f.type === 'text') {
          // free text (notes): the canvas updates while typing; one undo step per edit, and it
          // stays editable during the simulation (annotations don't affect the circuit)
          let before = null;
          inp.addEventListener('focus', () => { before = this.snapshot(); });
          inp.addEventListener('input', () => {
            p.props[f.key] = inp.value;
            this.editor.rerenderBody(p);
            this.saveLocalSoon();
          });
          inp.addEventListener('change', () => {
            if (before && !this.locked()) this.pushUndo(before);
            before = this.snapshot();
            this.saveLocalSoon();
            if (prefix === 'dlg') this.refreshInspector(); else this.refreshPropDialog();
          });
        } else {
          inp.addEventListener('change', () => {
            let val;
            if (f.type === 'select') { const o = f.options[+inp.value]; val = Array.isArray(o) ? o[0] : o; }
            else { val = Number(inp.value); if (!(val > 0) && !(f.allowZero && Number.isFinite(val))) { inp.value = p.props[f.key]; return; } }
            if (f.live && this.locked()) {
              // instrument controls (meter mode, scope time base) stay usable while simulating
              p.props[f.key] = val;
              this.editor.rerenderBody(p);
              this.markDirty();
              this.saveLocalSoon();
              if (prefix === 'dlg') this.refreshInspector(); else this.refreshPropDialog();
              return;
            }
            this.mutate(() => { p.props[f.key] = val; });
          });
        }
      });
      this.bindInspectorActions(el);
      const qb = el.querySelector('[data-act="qwiic"]');
      if (qb) qb.addEventListener('click', () => this.connectQwiic(p));
      if (this.locked()) this.lockForm(el);
    }

    // Pin diagram for chips and transistors (Semiconductors / ICs), shown in the settings forms.
    //  - DIP chips: the datasheet top view (pin 1 top-left at the notch, numbers inside,
    //    names outside); on the breadboard the same chip lies turned, pin 1 bottom-left.
    //  - 3-leg parts (TO-92, TO-220): the part as drawn on the canvas with each leg labelled.
    pinoutHTML(def, p) {
      if (!/^(ICs|Semiconductors)$/.test(def.category)) return '';
      const pins = def.pins(p.props || {});
      if (!pins.length) return '';
      const nameOf = (q) => { const m = /^\d+ · (.*)$/.exec(q.label || ''); return m ? m[1] : q.label || q.id; };
      const shortOf = (q) => nameOf(q).replace(/\s*\(.*\)\s*$/, '');
      const ys = new Set(pins.map((q) => q.y));
      const dip = pins.length >= 4 && pins.length % 2 === 0 && pins.every((q) => /^\d+$/.test(q.id)) && ys.size === 2;
      let svg;
      if (dip) {
        // width follows the longest pin name, so the drawing fills the panel without empty margins
        const longest = Math.max(...pins.map((q) => shortOf(q).length));
        const n = pins.length, h = n / 2, pitch = 20, top = 14, bodyW = 54, side = 30 + longest * 7, W = bodyW + 2 * side, bx = side;
        const H = top * 2 + h * pitch;
        const byNum = (k) => pins.find((q) => q.id === String(k));
        let s = `<rect x="${bx}" y="${top - 6}" width="${bodyW}" height="${h * pitch + 12}" rx="4" class="po-body"/>
          <path d="M${W / 2 - 8},${top - 6} a8,8 0 0 0 16,0" class="po-notch"/>
          <circle cx="${bx + 23}" cy="${top + 4}" r="2.6" class="po-dot"/>`;
        for (let k = 1; k <= n; k++) {
          const left = k <= h, row = left ? k - 1 : n - k;
          const y = top + row * pitch + pitch / 2, q = byNum(k) || { id: String(k), label: '' };
          const x0 = left ? bx - 12 : bx + bodyW, nx = left ? bx + 9 : bx + bodyW - 9;
          s += `<rect x="${x0}" y="${y - 3.5}" width="12" height="7" rx="1" class="po-pin"/>
            <text x="${nx}" y="${y + 3.5}" text-anchor="middle" class="po-num">${k}</text>
            <text x="${left ? bx - 16 : bx + bodyW + 16}" y="${y + 3.8}" text-anchor="${left ? 'end' : 'start'}" class="po-name"><title>${WB.esc(k + ' · ' + nameOf(q))}</title>${WB.esc(shortOf(q))}</text>`;
        }
        svg = `<svg viewBox="0 0 ${W} ${H}" class="po-svg" role="img" aria-label="Pinout">${s}</svg>
          <p class="muted small po-note">Top view, pin 1 at the notch. On the breadboard the chip lies turned: pin 1 is bottom-left, next to the notch.</p>`;
      } else {
        const [bx, by, bw, bh] = def.bbox(p.props || {}), pad = 6, lab = 12;
        let s = `<g>${def.render(p, {})}</g>`;
        for (const q of pins) s += `<circle cx="${q.x}" cy="${q.y}" r="1.6" class="po-leg"/><text x="${q.x}" y="${q.y + 8}" text-anchor="middle" class="po-legname">${WB.esc(q.id)}</text>`;
        svg = `<svg viewBox="${bx - pad} ${by - pad} ${bw + 2 * pad} ${bh + 2 * pad + lab}" class="po-svg po-small" role="img" aria-label="Pinout">${s}</svg>
          <div class="po-legend">${pins.map((q) => `<div><b>${WB.esc(q.id)}</b> ${WB.esc(nameOf(q))}</div>`).join('')}</div>`;
      }
      return `<label class="field-label">Pinout</label><div class="pinout">${svg}</div>`;
    }

    // During simulation: everything read-only except live controls (sliders such as knob, light, temperature).
    lockForm(el) {
      el.querySelectorAll('input:not([type=range]):not([data-live]), select:not([data-live]), button[data-act], .sw').forEach((x) => { x.disabled = true; });
      if (!el.querySelector('.lock-note')) el.insertAdjacentHTML('afterbegin', '<div class="lock-note">🔒 Simulation running — stop it to edit. Sliders and instrument controls still work.</div>');
    }

    // ---------------- double-click properties dialog (Tinkercad-style)
    openPropDialog(partId, clientX, clientY) {
      const p = this.part(partId);
      if (!p) return;
      this.selection = new Set([p.id]);
      this.selectionChanged();
      const dlg = $('#prop-dialog');
      dlg.dataset.part = p.id;
      dlg.classList.add('open');
      this.refreshPropDialog();
      // place next to the pointer, kept inside the canvas
      const st = $('#stage').getBoundingClientRect();
      let x = clientX - st.left + 18, y = clientY - st.top - 20;
      if (x + dlg.offsetWidth > st.width - 8) x = clientX - st.left - dlg.offsetWidth - 18;
      x = WB.clamp(x, 8, Math.max(8, st.width - dlg.offsetWidth - 8));
      y = WB.clamp(y, 8, Math.max(8, st.height - dlg.offsetHeight - 8));
      dlg.style.left = x + 'px';
      dlg.style.top = y + 'px';
      const first = dlg.querySelector('select, input[type=number], input.name');
      if (first) first.focus();
    }
    refreshPropDialog() {
      const dlg = $('#prop-dialog');
      if (!dlg.classList.contains('open')) return;
      const p = this.part(dlg.dataset.part);
      if (!p) { this.closePropDialog(); return; }
      dlg.querySelector('.pdlg-title').textContent = (p.name || '') + ' — ' + PARTS[p.type].label;
      this.renderPartForm(dlg.querySelector('.pdlg-body'), p, 'dlg', false);
    }
    closePropDialog() { $('#prop-dialog').classList.remove('open'); }
    bindInspectorActions(el, wire) {
      el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.act;
        if (a === 'del') this.deleteSelection();
        else if (a === 'rotate') this.rotateSelection(90);
        else if (a === 'dup') this.duplicateSelection();
        else if (a === 'straight' && wire) this.mutate(() => { wire.pts = []; wire.auto = false; });
        else if (a === 'autoroute' && wire) this.mutate(() => { WB.Router.routeWire(this, wire); });
      }));
    }

    // ---------------- palette
    // Order of the part categories: the user's saved order, then any category it doesn't list yet
    // (e.g. new in this version) in the default order.
    categoryOrder() {
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem('wirebench.catOrder') || '[]'); } catch (e) { /* storage unavailable */ }
      const known = new Set(WB.CATEGORIES);
      const order = (Array.isArray(saved) ? saved : []).filter((c) => known.has(c));
      for (const c of WB.CATEGORIES) if (!order.includes(c)) order.push(c);
      return order;
    }
    // Put the categories in this order (moves the existing elements, so nothing is rebuilt).
    setCategoryOrder(order, quiet) {
      const pal = $('#palette');
      for (const c of order) { const el = [...pal.querySelectorAll(':scope > .cat')].find((x) => x.dataset.cat === c); if (el) pal.appendChild(el); }
      const isDefault = order.every((c, i) => c === WB.CATEGORIES[i]);
      try { if (isDefault) localStorage.removeItem('wirebench.catOrder'); else localStorage.setItem('wirebench.catOrder', JSON.stringify(order)); } catch (e) { /* storage unavailable */ }
      if (!quiet) this.toast(isDefault ? 'Categories back in the default order' : 'Category order saved');
    }
    moveCategory(cat, where) {
      const order = this.categoryOrder(), i = order.indexOf(cat);
      if (i < 0) return;
      order.splice(i, 1);
      const j = where === 'top' ? 0 : where === 'bottom' ? order.length : where === 'up' ? Math.max(0, i - 1) : Math.min(order.length, i + 1);
      order.splice(j, 0, cat);
      this.setCategoryOrder(order);
    }
    // Right-click a category heading: move it, or reset the order.
    showCategoryMenu(cat, x, y) {
      let m = $('#cat-menu');
      if (!m) {
        m = document.createElement('div');
        m.id = 'cat-menu';
        document.body.appendChild(m);
        m.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-move]');
          if (!b) return;
          m.classList.remove('open');
          if (b.dataset.move === 'reset') this.setCategoryOrder(WB.CATEGORIES.slice());
          else this.moveCategory(m.dataset.cat, b.dataset.move);
        });
        document.addEventListener('pointerdown', (e) => { if (!m.contains(e.target)) m.classList.remove('open'); }, true);
      }
      const order = this.categoryOrder(), i = order.indexOf(cat), last = order.length - 1;
      const isDefault = order.every((c, k) => c === WB.CATEGORIES[k]);
      m.dataset.cat = cat;
      m.innerHTML = `<div class="cm-title">${WB.esc(cat)}</div>
        <button data-move="top"${i === 0 ? ' disabled' : ''}>${WB.icon('toTop')}<span>Move to top</span></button>
        <button data-move="up"${i === 0 ? ' disabled' : ''}>${WB.icon('up')}<span>Move up</span></button>
        <button data-move="down"${i === last ? ' disabled' : ''}>${WB.icon('down')}<span>Move down</span></button>
        <button data-move="bottom"${i === last ? ' disabled' : ''}>${WB.icon('toBottom')}<span>Move to bottom</span></button>
        <hr><button data-move="reset"${isDefault ? ' disabled' : ''}>${WB.icon('reset')}<span>Reset category order</span></button>
        <div class="cm-hint">Tip: you can also drag a heading up or down.</div>`;
      m.classList.add('open');
      m.style.left = Math.min(x, window.innerWidth - 230) + 'px';
      m.style.top = Math.min(y, window.innerHeight - 220) + 'px';
    }
    // Drag a category heading to a new place in the list (a line shows where it will go).
    bindCategoryDrag() {
      const pal = $('#palette');
      let dragging = null;
      const clear = () => pal.querySelectorAll('.cat.drop-before, .cat.drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
      const target = (e) => {
        const cats = [...pal.querySelectorAll(':scope > .cat')].filter((c) => c.style.display !== 'none');
        for (const c of cats) { const r = c.querySelector('.cat-title').getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) return { el: c, before: true }; }
        return cats.length ? { el: cats[cats.length - 1], before: false } : null;
      };
      pal.addEventListener('dragstart', (e) => {
        const t = e.target.closest && e.target.closest('.cat-title');
        if (!t) return;
        dragging = t.parentElement.dataset.cat;
        e.dataTransfer.setData('text/x-wb-cat', dragging);
        e.dataTransfer.effectAllowed = 'move';
        t.parentElement.classList.add('dragging');
      });
      pal.addEventListener('dragover', (e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clear();
        const tg = target(e);
        if (tg) tg.el.classList.add(tg.before ? 'drop-before' : 'drop-after');
      });
      pal.addEventListener('drop', (e) => {
        if (!dragging) return;
        e.preventDefault();
        const tg = target(e);
        clear();
        if (!tg || tg.el.dataset.cat === dragging) return;
        const order = this.categoryOrder().filter((c) => c !== dragging);
        const k = order.indexOf(tg.el.dataset.cat);
        order.splice(tg.before ? k : k + 1, 0, dragging);
        this.setCategoryOrder(order);
      });
      pal.addEventListener('dragend', () => { clear(); pal.querySelectorAll('.cat.dragging').forEach((c) => c.classList.remove('dragging')); dragging = null; });
    }
    buildPalette() {
      const pal = $('#palette');
      let html = '';
      for (const cat of this.categoryOrder()) {
        const types = Object.keys(PARTS).filter((t) => PARTS[t].category === cat);
        if (!types.length) continue;
        const shut = this.hiddenCats.has(cat);
        html += `<div class="cat${shut ? ' collapsed' : ''}" data-cat="${WB.esc(cat)}"><button class="cat-title" draggable="true" title="Click to hide / show ${WB.esc(cat)} · drag to move it · right-click for more"><span class="chev">${shut ? '▸' : '▾'}</span><span>${WB.esc(cat)}</span><span class="count">${types.length}</span></button><div class="tiles">`;
        for (const t of types) {
          const def = PARTS[t];
          const props = WB.clone(def.defaults);
          const [x, y, w, h] = def.bbox(props);
          const pad = 4;
          html += `<div class="tile" draggable="true" data-type="${t}" title="${WB.esc(def.label)} — drag onto the canvas, or double-click to add">
            <svg viewBox="${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}" preserveAspectRatio="xMidYMid meet">${def.render({ id: 'icon', type: t, props }, {})}</svg>
            <span>${WB.esc(def.label)}</span></div>`;
        }
        html += '</div></div>';
      }
      pal.innerHTML = html;
      pal.querySelectorAll('.cat-title').forEach((b) => {
        b.addEventListener('click', () => {
          const cat = b.parentElement.dataset.cat;
          this.setCategory(cat, this.hiddenCats.has(cat));
        });
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showCategoryMenu(b.parentElement.dataset.cat, e.clientX, e.clientY); });
      });
      this.bindCategoryDrag();
      pal.querySelectorAll('.tile').forEach((tile) => {
        tile.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-wb-part', tile.dataset.type); e.dataTransfer.setData('text/plain', tile.dataset.type); e.dataTransfer.effectAllowed = 'copy'; });
        // Single click only explains; double-click (or drag and drop) adds the part.
        tile.addEventListener('click', (e) => {
          if (e.detail !== 1) return;
          clearTimeout(this._tileHintT);
          this._tileHintT = setTimeout(() => this.toast('Drag it onto the canvas, or double-click to add it.'), 350);
        });
        tile.addEventListener('dblclick', () => { clearTimeout(this._tileHintT); this.addPart(tile.dataset.type); });
      });
      $('#part-search').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        pal.querySelectorAll('.tile').forEach((t) => { t.style.display = !q || t.title.toLowerCase().includes(q) ? '' : 'none'; });
        pal.querySelectorAll('.cat').forEach((c) => { c.style.display = [...c.querySelectorAll('.tile')].some((t) => t.style.display !== 'none') ? '' : 'none'; });
        pal.classList.toggle('searching', !!q);
      });
    }
    // Hide / show one category of the parts list (remembered between sessions).
    setCategory(cat, show) {
      if (show) this.hiddenCats.delete(cat); else this.hiddenCats.add(cat);
      const el = [...document.querySelectorAll('#palette .cat')].find((c) => c.dataset.cat === cat);
      if (el) { el.classList.toggle('collapsed', !show); el.querySelector('.chev').textContent = show ? '▾' : '▸'; }
      try { localStorage.setItem('wirebench.hiddenCats', JSON.stringify([...this.hiddenCats])); } catch (e) { /* storage unavailable */ }
    }
    toggleAllCats() {
      const cats = [...document.querySelectorAll('#palette .cat')].map((c) => c.dataset.cat);
      const show = cats.every((c) => this.hiddenCats.has(c)); // all collapsed -> expand all, else collapse all
      cats.forEach((c) => this.setCategory(c, show));
    }

    // ---------------- UI wiring
    bindUI() {
      document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.cmd(b.dataset.cmd); }));
      document.addEventListener('click', () => document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')));
      $('#modal .modal-x').addEventListener('click', (e) => e.currentTarget.closest('dialog').close()); // no inline handlers: the CSP blocks them
      // navigation buttons inside the help dialog
      $('#modal-body').addEventListener('click', (e) => {
        const b = e.target.closest('[data-help]');
        if (b) { this.showHelp(b.dataset.help); return; }
        // web links (About page): in the desktop app open them in the system browser, not inside the app
        const a = e.target.closest('a[data-ext]');
        if (a && WB.isDesktop) { e.preventDefault(); WB.invoke('open_url', { url: a.href }).catch((err) => this.toast('Could not open the link: ' + err)); }
      });
      const ex = $('#examples');
      for (const cat of WB.EXAMPLE_CATEGORIES) {
        const g = document.createElement('optgroup');
        g.label = cat;
        WB.EXAMPLES.forEach((x, i) => { if (x.category !== cat) return; const o = document.createElement('option'); o.value = i; o.textContent = x.label; o.title = x.name; g.appendChild(o); });
        ex.appendChild(g);
      }
      ex.addEventListener('change', () => {
        const v = ex.value;
        ex.value = '';
        if (v === '') return;
        if (v === 'folder') { this.openExamplesFolder(); return; }
        let name, get;
        if (v.startsWith('u:')) {
          const u = this.userExamples[+v.slice(2)];
          if (!u) return;
          name = u.name;
          get = () => JSON.parse(u.contents);
        } else {
          name = WB.EXAMPLES[v].name;
          get = () => WB.EXAMPLES[v].build();
        }
        this.askSaveChanges(`opening the example "${name}"`).then((go) => {
          if (!go) return;
          try { this.loadProject(get()); this.setDocName((v.startsWith('u:') ? name : WB.EXAMPLES[v].label || name).replace(/[\\/:*?"<>|]+/g, '-')); this.markSaved(); this.editor.fit(); }
          catch (err) { alert(`Could not open example "${name}": ${err.message}`); }
        });
      });
      this.userExamples = [];
      if (WB.isDesktop) {
        this.refreshUserExamples();
        // pick up files added while the app was in the background (e.g. from File Explorer)
        window.addEventListener('focus', () => this.refreshUserExamples());
      }
      $('#file-input').addEventListener('change', (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        f.text().then((t) => this.openProjectText(t, f.name));
      });
      $('#serial-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = $('#serial-input');
        if (this.runtime && this.runtime.running) { this.runtime.serialInput(inp.value + (inp.value.startsWith('@') ? '' : '\n')); this.serialOut(''); }
        else this.toast('Start the simulation to send data to the board.');
        inp.value = '';
      });
      // properties dialog: close button, drag by title bar, close when clicking elsewhere on the canvas
      const dlg = $('#prop-dialog');
      dlg.querySelector('.pdlg-close').addEventListener('click', () => this.closePropDialog());
      dlg.querySelector('.pdlg-head').addEventListener('pointerdown', (e) => {
        if (e.target.closest('.pdlg-close')) return;
        e.preventDefault();
        const sx = e.clientX - dlg.offsetLeft, sy = e.clientY - dlg.offsetTop;
        const move = (ev) => { dlg.style.left = ev.clientX - sx + 'px'; dlg.style.top = Math.max(0, ev.clientY - sy) + 'px'; };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      $('#canvas').addEventListener('pointerdown', (e) => {
        if (!dlg.classList.contains('open')) return;
        const pe = e.target.closest('.part');
        if (!pe || pe.getAttribute('data-id') !== dlg.dataset.part) this.closePropDialog();
      }, true);
      window.addEventListener('keydown', (e) => this.onKey(e));
      window.addEventListener('beforeunload', () => this.saveLocal());
      // keep the toolbar fitting the window (and refit once web fonts have loaded)
      this.fitToolbar();
      const refit = () => this.fitToolbar();
      window.addEventListener('resize', refit);
      if (window.ResizeObserver) new ResizeObserver(refit).observe(document.body);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.fitToolbar());
      // where the mouse is on the workspace (type-to-add puts the new part there)
      this.mouse = { x: 0, y: 0, over: false };
      $('#canvas').addEventListener('pointermove', (e) => { this.mouse = { x: e.clientX, y: e.clientY, over: true }; });
      $('#canvas').addEventListener('pointerleave', () => { this.mouse.over = false; });
      this.bindQuickAdd();
    }

    // ---------------- type-to-add: with the mouse over the workspace, typing a part name opens
    // a small search box at the mouse; Enter (or a click) puts the chosen part there.
    bindQuickAdd() {
      const box = document.createElement('div');
      box.id = 'quick-add';
      box.innerHTML = '<input type="text" spellcheck="false" autocomplete="off" placeholder="Type a part name…"><div class="qa-list"></div><div class="qa-hint">↑ ↓ choose · Enter add · Esc close</div>';
      document.body.appendChild(box);
      const inp = box.querySelector('input'), list = box.querySelector('.qa-list');
      this.qa = { box, inp, list, items: [], sel: 0 };
      inp.addEventListener('input', () => this.quickAddFilter());
      inp.addEventListener('keydown', (e) => {
        const q = this.qa;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (q.items.length) { q.sel = (q.sel + (e.key === 'ArrowDown' ? 1 : -1) + q.items.length) % q.items.length; this.quickAddHighlight(); }
        } else if (e.key === 'Enter') { e.preventDefault(); if (q.items[q.sel]) this.quickAddPick(q.items[q.sel]); }
        else if (e.key === 'Escape') { e.preventDefault(); this.closeQuickAdd(); }
        e.stopPropagation(); // keep Delete / Ctrl+Z etc. inside the search box
      });
      list.addEventListener('pointerdown', (e) => { const it = e.target.closest('.qa-item'); if (it) { e.preventDefault(); this.quickAddPick(it.dataset.type); } });
      list.addEventListener('pointermove', (e) => { const it = e.target.closest('.qa-item'); if (it) { this.qa.sel = +it.dataset.i; this.quickAddHighlight(); } });
      document.addEventListener('pointerdown', (e) => { if (box.classList.contains('open') && !box.contains(e.target)) this.closeQuickAdd(); }, true);
    }
    openQuickAdd(first) {
      if (this.locked()) { this.lockedToast(); return; }
      const q = this.qa;
      q.at = { x: this.mouse.x, y: this.mouse.y };
      q.box.classList.add('open');
      // keep the box on screen
      const W = 300, H = 330;
      q.box.style.left = Math.max(8, Math.min(window.innerWidth - W - 8, q.at.x + 12)) + 'px';
      q.box.style.top = Math.max(8, Math.min(window.innerHeight - H - 8, q.at.y + 12)) + 'px';
      q.inp.value = first || '';
      q.inp.focus();
      this.quickAddFilter();
    }
    closeQuickAdd() {
      this.qa.box.classList.remove('open');
      if (document.activeElement === this.qa.inp) this.qa.inp.blur();
    }
    quickAddFilter() {
      const q = this.qa, s = q.inp.value.trim().toLowerCase();
      // rank: name starts with it, a word in the name starts with it, name contains it, then type / category
      const scored = [];
      for (const cat of WB.CATEGORIES) {
        for (const t of Object.keys(PARTS)) {
          const d = PARTS[t];
          if (d.category !== cat) continue;
          const name = d.label.toLowerCase();
          let score = -1;
          if (!s) score = 9;
          else if (name.startsWith(s)) score = 0;
          else if (name.split(/[\s(),·/–-]+/).some((w) => w.startsWith(s))) score = 1;
          else if (s.length >= 4 && name.includes(s)) score = 2; // mid-word only for longer text ("led" ≠ "control·led")
          else if (t.toLowerCase().startsWith(s) || cat.toLowerCase().split(/\s+/).some((w) => w.startsWith(s))) score = 3; // e.g. "sensors", "vcvs"
          if (score >= 0) scored.push({ t, d, score, cat });
        }
      }
      scored.sort((a, b) => a.score - b.score || a.d.label.localeCompare(b.d.label));
      q.items = scored.slice(0, 8).map((x) => x.t);
      q.sel = 0;
      q.list.innerHTML = scored.length ? scored.slice(0, 8).map((x, i) => {
        const props = WB.clone(x.d.defaults), [bx, by, bw, bh] = x.d.bbox(props), pad = 3;
        return `<div class="qa-item" data-type="${x.t}" data-i="${i}"><svg viewBox="${bx - pad} ${by - pad} ${bw + 2 * pad} ${bh + 2 * pad}" preserveAspectRatio="xMidYMid meet">${x.d.render({ id: 'qa', type: x.t, props }, {})}</svg><span class="qa-name">${WB.esc(x.d.label)}</span><span class="qa-cat">${WB.esc(x.cat)}</span></div>`;
      }).join('') : '<div class="qa-empty">No part matches.</div>';
      this.quickAddHighlight();
    }
    quickAddHighlight() {
      this.qa.list.querySelectorAll('.qa-item').forEach((el, i) => el.classList.toggle('active', i === this.qa.sel));
    }
    quickAddPick(type) {
      const q = this.qa, r = this.editor.svg.getBoundingClientRect(), v = this.editor.view;
      const at = { x: (q.at.x - r.left - v.x) / v.s, y: (q.at.y - r.top - v.y) / v.s };
      this.closeQuickAdd();
      if (type === 'note') {
        // same as the toolbar button: open the note's editor right away
        const before = this.project.parts.length;
        this.addPart('note', at);
        if (this.project.parts.length > before) {
          const p = this.project.parts[this.project.parts.length - 1];
          this.openPropDialog(p.id, q.at.x + 40, q.at.y);
          const ta = $('#prop-dialog textarea');
          if (ta) { ta.focus(); ta.select(); }
        }
        return;
      }
      this.addPart(type, at);
    }
    onKey(e) {
      const el = document.activeElement;
      const inField = /INPUT|TEXTAREA|SELECT/.test(el.tagName);
      const mod = e.ctrlKey || e.metaKey;
      // Letter of a Ctrl shortcut: the typed letter when it is Latin (so AZERTY etc. keep their
      // own Z / Y), otherwise the physical key — with a Thai (or other non-Latin) layout active,
      // the Z key types "ผ" but Ctrl+Z must still undo.
      const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : (e.key || '').toLowerCase();
      if (e.key === 'F1') { e.preventDefault(); this.showHelp('guide'); return; }
      if (mod && k === 's') { e.preventDefault(); this.cmd('save'); return; }
      if (mod && k === 'p') { e.preventDefault(); this.cmd('print'); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); this.cmd('run'); return; }
      if (mod && k === 'b') { e.preventDefault(); this.cmd(e.shiftKey ? 'toggleLeft' : 'togglePanel'); return; }
      // Undo / redo also from a settings box (number, slider, drop-down): the change is committed,
      // then undone. Free-text fields (sketch code, note text, names, search) keep their own text undo.
      if (mod && (k === 'z' || k === 'y')) {
        const freeText = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|)$/.test(el.getAttribute('type') || ''));
        if (!freeText) {
          e.preventDefault();
          if (inField) el.blur();
          if (k === 'y' || e.shiftKey) this.redo(); else this.undo();
          return;
        }
      }
      if (e.key === 'Escape' && $('#prop-dialog').classList.contains('open')) { this.closePropDialog(); document.activeElement.blur(); return; }
      if (e.key === 'Enter' && document.activeElement.closest && document.activeElement.closest('#prop-dialog')) { document.activeElement.blur(); return; }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.editor.zoom(1.25); return; }
      if (mod && e.key === '-') { e.preventDefault(); this.editor.zoom(0.8); return; }
      if (mod && e.key === '0') { e.preventDefault(); this.editor.fit(); return; }
      if (inField) return;
      // type-to-add: a letter or digit with the mouse over the workspace opens the part search
      // (R still rotates when something is selected; Space fits the view)
      if (!mod && !e.altKey && this.mouse && this.mouse.over && e.key.length === 1 && /[a-z0-9]/i.test(e.key)
        && !(/^r$/i.test(e.key) && this.selection.size)) {
        e.preventDefault();
        this.openQuickAdd(e.key);
        return;
      }
      if (mod && k === 'o') { e.preventDefault(); this.cmd('open'); }
      else if (mod && k === 'c') { e.preventDefault(); this.copySelection(false); }
      else if (mod && k === 'x') { e.preventDefault(); this.copySelection(true); }
      else if (mod && k === 'v') { e.preventDefault(); this.paste(); }
      else if (mod && k === 'd') { e.preventDefault(); this.duplicateSelection(); }
      else if (mod && k === 'a') { e.preventDefault(); this.selection = new Set(this.project.parts.map((p) => p.id).concat(this.project.wires.map((w) => w.id))); this.selectionChanged(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelection(); }
      else if (e.key === 'r' || e.key === 'R') this.rotateSelection(e.shiftKey ? -90 : 90);
      else if (e.key === 'f' || e.key === 'F') this.editor.fit();
      else if (!mod && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); this.cmd('note'); }
      else if (e.key === 'Escape') { this.editor.hideMenu(); if (this.editor.drawing) this.editor.cancelDraw(); else this.clearSelection(); }
      else if (e.key === '+' || e.key === '=') this.editor.zoom(1.2);
      else if (e.key === '-') this.editor.zoom(1 / 1.2);
    }
    // Help dialog (topic: guide, shortcuts, parts, reference, trouble, about)
    showHelp(topic) {
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      const dlg = $('#modal');
      dlg.classList.add('help');
      dlg.classList.remove('wide'); // each dialog sets its own layout
      $('#modal-body').innerHTML = WB.Help.render(topic);
      $('#modal-body').scrollTop = 0;
      if (!dlg.open) dlg.showModal();
    }
    // Themes: 'default' (slate panels, light canvas), 'light', 'dark'. The canvas follows the
    // theme unless it was switched with the ◐ button (stored as wirebench.canvas).
    applyTheme() {
      let theme = 'default', canvas = null;
      try { theme = localStorage.getItem('wirebench.theme') || 'default'; canvas = localStorage.getItem('wirebench.canvas'); } catch (e) { /* storage unavailable */ }
      if (!['default', 'light', 'dark'].includes(theme)) theme = 'default';
      if (theme === 'default') delete document.body.dataset.theme; else document.body.dataset.theme = theme;
      document.body.classList.toggle('canvas-dark', canvas ? canvas === 'dark' : theme === 'dark');
      document.querySelectorAll('#theme-menu button').forEach((b) => b.classList.toggle('on', b.dataset.cmd === 'theme:' + theme));
      return theme;
    }
    setTheme(theme) {
      try { localStorage.setItem('wirebench.theme', theme); localStorage.removeItem('wirebench.canvas'); } catch (e) { /* storage unavailable */ }
      this.applyTheme();
      this.toast(`${theme[0].toUpperCase() + theme.slice(1)} theme`);
    }
    cmd(c) {
      if (c.startsWith('help:')) { this.showHelp(c.slice(5)); return; }
      if (c.startsWith('theme:')) { document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); this.setTheme(c.slice(6)); return; }
      if (!c.endsWith('Menu')) document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      switch (c) {
        case 'new':
          this.askSaveChanges('starting a new project').then((go) => {
            if (!go) return;
            this.loadProject({ parts: [], wires: [], code: WB.DEFAULT_CODE });
            this.setDocName('Untitled');
            this.markSaved();
          });
          break;
        case 'open':
          this.askSaveChanges('opening another project').then((go) => {
            if (!go) return;
            if (WB.isDesktop) this.openDesktop(); else $('#file-input').click();
          });
          break;
        case 'note': this.addNote(); break;
        case 'save': this.saveProject(); break;
        case 'fileMenu': this.toggleMenu('#file-menu'); break;
        case 'helpMenu': this.toggleMenu('#help-menu'); break;
        case 'exportSVG': this.saveAs('wirebench-breadboard.svg', new Blob([this.editor.exportSVGString()], { type: 'image/svg+xml' }), 'SVG image', ['svg']); break;
        case 'exportPNG': this.exportPNG(); break;
        case 'exportSketch': this.saveAs('sketch.ino', new Blob([this.code.value], { type: 'text/plain' }), 'Arduino sketch', ['ino']); break;
        case 'netlist': this.showNetlist(); break;
        case 'print': this.showPrint(); break;
        case 'schematic': this.showSchematic(); break;
        case 'spice': this.showSpice(); break;
        case 'undo': this.undo(); break;
        case 'redo': this.redo(); break;
        case 'rotate': this.rotateSelection(90); break;
        case 'duplicate': this.duplicateSelection(); break;
        case 'tidy': this.tidyAllWires(); break;
        case 'copy': this.copySelection(false); break;
        case 'paste': this.paste(); break;
        case 'zoom100': this.editor.setZoom(1); break;
        case 'canvasTheme': {
          const dark = !document.body.classList.contains('canvas-dark');
          document.body.classList.toggle('canvas-dark', dark);
          try { localStorage.setItem('wirebench.canvas', dark ? 'dark' : 'light'); } catch (e) { /* storage unavailable */ }
          this.toast(dark ? 'Dark canvas' : 'Light canvas');
          break;
        }
        case 'delete': this.deleteSelection(); break;
        case 'zoomIn': this.editor.zoom(1.25); break;
        case 'zoomOut': this.editor.zoom(0.8); break;
        case 'fit': this.editor.fit(); break;
        case 'run': if (this.sim) this.stopSim(); else this.startSim(); break;
        case 'verify': this.verify(); break;
        case 'togglePanel': this.setCodePanel(document.body.classList.contains('code-hidden')); break;
        case 'toggleAllCats': this.toggleAllCats(); break;
        case 'toggleLeft': this.setLeftPanel(document.body.classList.contains('left-hidden')); break;
        case 'clearSerial': $('#serial-out').textContent = ''; break;
        case 'mute': Audio.muted = !Audio.muted; $('#btn-mute').textContent = Audio.muted ? '🔇' : '🔊'; if (Audio.muted) Audio.stopAll(); break;
      }
    }

    // ---------------- persistence
    loadProject(o, quiet) {
      if (this.sim) this.stopSim();
      this.closePropDialog();
      this.project = cleanProject(o);
      for (const p of this.project.parts) if (!p.name) p.name = this.nextName(PARTS[p.type].prefix);
      // wires marked "route" (e.g. in examples) are laid out by the auto-router
      const toRoute = this.project.wires.filter((w) => w.route);
      if (toRoute.length) { WB.Router.routeMany(this, toRoute); toRoute.forEach((w) => delete w.route); }
      this.selection = new Set();
      this.undoStack = [];
      this.redoStack = [];
      this.transient = {};
      this.code.value = this.project.code;
      this.clearConsole();
      this.scheduleLiveCheck();
      this.changed();
      if (!quiet) this.toast('Project loaded');
    }
    saveLocal() {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ parts: this.project.parts, wires: this.project.wires, code: this.code.value })); } catch (e) { /* storage unavailable */ }
    }
    saveLocalSoon() { clearTimeout(this._saveT); this._saveT = setTimeout(() => this.saveLocal(), 600); }
    loadLocal() {
      try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
    }

    // ---------------- files (browser download, or native dialogs in the desktop app)
    // Bode plotter: run a frequency sweep (or stop the one that is running). It works on its own
    // copy of the circuit state, so it runs whether or not the simulation is running.
    async runBodeSweep(p) {
      const cur = WB.bodeResults.get(p.id);
      if (cur && cur.status === 'running') { cur.cancel = true; return; }
      const lo = Math.min(+p.props.fstart || 10, +p.props.fstop || 1e5), hi = Math.max(+p.props.fstart || 10, +p.props.fstop || 1e5);
      const freqs = WB.bodeFreqs(p);
      const r = { f: [], db: [], ph: [], ok: [], status: 'running', done: 0, total: freqs.length, key: `${lo}|${hi}` };
      WB.bodeResults.set(p.id, r);
      const redraw = () => { if (this.part(p.id)) this.editor.rerenderBody(p); };
      redraw();
      const sim = { pins: this.sim ? this.sim.pins : {}, servos: [], modulino: {}, scope: {}, analog: { t: 0 }, matrix: null, partState: {}, warned: new Set(), t0: performance.now(), lcd: {}, neo: {}, irq: [] };
      let res;
      try {
        res = await WB.Circuit.bodeSweep(this.getTopo(), this.project, {
          partId: p.id, freqs, amp: +p.props.amp || 0.1, sim, cancelled: () => r.cancel,
          onProgress: (done, total, out) => { Object.assign(r, { f: out.f, db: out.db, ph: out.ph, ok: out.ok, done }); redraw(); },
        });
      } catch (e) { res = { error: 'Sweep failed: ' + e.message }; }
      if (WB.bodeResults.get(p.id) !== r) return;
      if (res.error === 'cancelled') r.status = 'done';
      else if (res.error) { r.status = 'error'; r.error = res.error; }
      else { Object.assign(r, res); r.status = 'done'; }
      redraw();
    }
    // Toolbar: compact it step by step (classes c1…c9, see app.css) until everything fits.
    fitToolbar() {
      const tb = $('#toolbar');
      const N = 9;
      const fits = () => {
        const right = tb.getBoundingClientRect().right - (parseFloat(getComputedStyle(tb).paddingRight) || 0);
        return $('#btn-run').getBoundingClientRect().right <= right + 0.5;
      };
      for (let i = 1; i <= N; i++) tb.classList.remove('c' + i);
      for (let i = 1; i <= N && !fits(); i++) tb.classList.add('c' + i);
    }
    toggleMenu(sel) {
      document.querySelectorAll('.menu.open').forEach((m) => { if (m !== $(sel)) m.classList.remove('open'); });
      $(sel).classList.toggle('open');
    }
    async saveAs(name, blob, filterName, exts) {
      if (!WB.isDesktop) { WB.download(name, blob); this.toast('Saved ' + name); return name; }
      try {
        const args = { defaultName: name, filterName, extensions: exts, text: null, base64: null };
        if (/^(text|application\/json|image\/svg)/.test(blob.type)) args.text = await blob.text();
        else {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          args.base64 = btoa(bin);
        }
        const path = await WB.invoke('save_file', args);
        if (path) this.toast('Saved ' + path);
        return path || null;
      } catch (e) { alert('Could not save: ' + e); return null; }
    }
    // Example projects saved as files in %APPDATA%\Wirebench\examples (or an "examples"
    // folder next to wirebench.exe) are listed under "My examples" — no rebuild needed.
    async refreshUserExamples() {
      let res;
      try { res = await WB.invoke('list_examples'); } catch (e) { console.warn('Wirebench: could not list examples', e); return; }
      const sig = JSON.stringify(res.items.map((u) => [u.file, u.contents.length]));
      if (sig === this._userExSig) return;
      this._userExSig = sig;
      this.userExamples = res.items.map((u) => {
        let name = u.name;
        try { const j = JSON.parse(u.contents); if (j && typeof j.name === 'string' && j.name.trim()) name = j.name.trim(); } catch (e) { /* reported when chosen */ }
        return { name, file: u.file, contents: u.contents };
      });
      const ex = $('#examples');
      ex.querySelectorAll('.user-ex').forEach((n) => n.remove());
      const g = document.createElement('optgroup');
      g.className = 'user-ex';
      g.label = 'My examples';
      this.userExamples.forEach((u, i) => { const o = document.createElement('option'); o.value = 'u:' + i; o.textContent = u.name; o.title = u.file; g.appendChild(o); });
      const o = document.createElement('option');
      o.value = 'folder';
      o.textContent = 'Open examples folder…';
      o.title = res.dir;
      g.appendChild(o);
      ex.appendChild(g);
    }
    async openExamplesFolder() {
      try { await WB.invoke('open_examples_folder'); this.toast('Save a project into this folder and it appears under "My examples".'); }
      catch (e) { alert('Could not open the examples folder: ' + e); }
    }
    async openDesktop() {
      try {
        const f = await WB.invoke('open_project');
        if (f) this.openProjectText(f.contents, f.name);
      } catch (e) { alert('Could not open this file: ' + e); }
    }

    // ---------------- project files (.wbproj)
    // A Wirebench project file is JSON with a header saying what it is, so other programs and
    // future versions can recognise it:
    //   format        "wirebench-project"   formatVersion  2 (1 = the older plain .json files)
    //   generator     "Wirebench 0.6.8"     saved          ISO date/time
    //   title, board  then parts, wires and the sketch code
    // Each part and wire is written on its own line: readable, and small, clean diffs in Git.
    projectFileText() {
      const board = this.boardPart();
      const head = {
        format: 'wirebench-project',
        formatVersion: PROJECT_FORMAT,
        generator: 'Wirebench ' + (WB.VERSION || ''),
        saved: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        title: this.docName || 'Untitled',
        board: board ? board.type : null,
      };
      // fixed, readable field order inside each part / wire; anything else keeps its place after them
      const ordered = (o, keys) => Object.fromEntries([...keys.filter((k) => k in o).map((k) => [k, o[k]]), ...Object.entries(o).filter(([k]) => !keys.includes(k))]);
      const list = (arr, keys) => (arr.length ? '[\n' + arr.map((x) => '    ' + JSON.stringify(ordered(x, keys))).join(',\n') + '\n  ]' : '[]');
      return '{\n'
        + Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n') + '\n'
        + `  "parts": ${list(this.project.parts, ['id', 'type', 'name', 'x', 'y', 'rot', 'props'])},\n`
        + `  "wires": ${list(this.project.wires, ['id', 'a', 'b', 'color', 'pts', 'auto'])},\n`
        + `  "code": ${JSON.stringify(this.code.value)}\n}\n`;
    }
    // Open project text (from the file dialog, the web file picker, or a double-clicked file).
    openProjectText(text, fileName) {
      let o;
      try { o = JSON.parse(text); } catch (e) { alert(`Could not open ${fileName || 'this file'}: it is not a Wirebench project (${e.message}).`); return false; }
      if (!o || typeof o !== 'object' || (o.format && o.format !== 'wirebench-project') || !Array.isArray(o.parts || [])) {
        alert(`Could not open ${fileName || 'this file'}: it is not a Wirebench project.`); return false;
      }
      if ((o.formatVersion || 1) > PROJECT_FORMAT) this.toast(`This project was saved by a newer Wirebench (${o.generator || 'unknown version'}); some parts may be missing.`);
      this.loadProject(o);
      this.setDocName(fileName || o.title || 'Untitled');
      this.markSaved();
      this.editor.fit();
      this.toast('Opened ' + this.docName);
      return true;
    }
    // Name of the open document (without folder and extension); used for Save and the page title.
    setDocName(nameOrPath) {
      const base = String(nameOrPath || 'Untitled').split(/[\\/]/).pop().replace(/\.(wbproj|json)$/i, '').trim();
      this.docName = base || 'Untitled';
      try { localStorage.setItem('wirebench.docName', this.docName); } catch (e) { /* storage unavailable */ }
      this.updateTitle();
    }
    updateTitle() {
      const t = `${this.modified ? '● ' : ''}${this.docName || 'Untitled'} — Wirebench`;
      if (t === this._title) return;
      this._title = t;
      document.title = t;
      if (this.appWindow) this.appWindow.setTitle(t).catch(() => {});
    }

    // ---------------- unsaved changes
    // The project counts as modified when it differs from the last saved / opened state, so
    // undoing back to that state makes it unmodified again. Shown as a dot in the title and on Save.
    projectSig() {
      const str = JSON.stringify([this.project.parts, this.project.wires, this.code.value]);
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return (h >>> 0).toString(36) + ':' + str.length;
    }
    markSaved() {
      this.savedSig = this.projectSig();
      try { localStorage.setItem('wirebench.savedSig', this.savedSig); } catch (e) { /* storage unavailable */ }
      this.updateModified();
    }
    updateModified() {
      if (!this.savedSig || !this.code) return;
      const m = this.projectSig() !== this.savedSig;
      if (m === this.modified) return;
      this.modified = m;
      $('#btn-file').classList.toggle('modified', m);
      $('#mi-save').classList.toggle('modified', m);
      $('#btn-file').title = m ? 'New, open, save, export and theme — the project has unsaved changes' : 'New, open, save, export and theme';
      this.updateTitle();
    }
    // Save the project to a .wbproj file; resolves true when it was saved.
    async saveProject() {
      const name = (this.docName || 'Untitled') + '.wbproj';
      const path = await this.saveAs(name, new Blob([this.projectFileText()], { type: 'application/json' }), 'Wirebench project', ['wbproj']);
      if (!path) return false;
      this.setDocName(path);
      this.markSaved();
      return true;
    }
    // Before replacing or closing the project: if it has unsaved changes, ask Save / Don't save /
    // Cancel. Resolves true when it is fine to go on.
    askSaveChanges(what) {
      if (!this.modified) return Promise.resolve(true);
      if (this._asking) return this._asking;
      let dlg = $('#save-ask');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'save-ask';
        dlg.innerHTML = `<div class="sa-body"><div class="sa-icon">●</div><div><h3></h3><p></p></div></div>
          <div class="sa-actions"><button data-sa="save" class="primary">Save</button><button data-sa="discard">Don't save</button><button data-sa="cancel">Cancel</button></div>`;
        document.body.appendChild(dlg);
      }
      dlg.querySelector('h3').textContent = `Save changes to "${this.docName || 'Untitled'}"?`;
      dlg.querySelector('p').textContent = `This project has changes that are not saved to a file. Save them before ${what}?`;
      this._asking = new Promise((resolve) => {
        const done = (v) => { dlg.removeEventListener('click', onClick); dlg.removeEventListener('cancel', onCancel); if (dlg.open) dlg.close(); this._asking = null; resolve(v); };
        const onCancel = (e) => { e.preventDefault(); done(false); };
        const onClick = (e) => {
          const b = e.target.closest('[data-sa]');
          if (!b) return;
          if (b.dataset.sa === 'cancel') done(false);
          else if (b.dataset.sa === 'discard') done(true);
          else { dlg.close(); this.saveProject().then((ok) => done(ok)); }
        };
        dlg.addEventListener('click', onClick);
        dlg.addEventListener('cancel', onCancel);
        dlg.showModal();
        dlg.querySelector('[data-sa="save"]').focus();
      });
      return this._asking;
    }
    // Desktop: the window title follows the document, and closing the window asks about unsaved changes.
    bindDesktopWindow() {
      const w = window.__TAURI__ && window.__TAURI__.window;
      if (!w || !w.getCurrentWindow) return;
      this.appWindow = w.getCurrentWindow();
      this._title = null;
      this.updateTitle();
      this.appWindow.onCloseRequested(async (e) => {
        this.saveLocal();
        if (!(await this.askSaveChanges('closing Wirebench'))) e.preventDefault();
      }).catch((err) => console.warn('Wirebench: no close handler', err));
    }

    // ---------------- export / netlist
    // Export → Schematic diagram: preview the generated sheet, save it as SVG or PNG.
    showSchematic() {
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      if (!this.project.parts.some((p) => PARTS[p.type] && !PARTS[p.type].holes && !PARTS[p.type].annotation)) { this.toast('Add some parts first — the schematic is drawn from the circuit on the workspace.'); return; }
      // Always opens with wires; Net labels is a choice for this preview only (a remembered
      // "Net labels" looked like the wires had gone missing). Clears the old remembered choice.
      let mode = 'wires';
      try { localStorage.removeItem('wirebench.schMode'); } catch (e) { /* storage unavailable */ }
      let sch;
      const render = () => {
        sch = WB.Schematic.build(this, { mode });
        const how = mode === 'wires'
          ? 'Connections are drawn as wires; a dot marks wires that are joined, wires that cross without a dot are not connected.'
          : 'Connections are shown with net labels: pins that carry the same label are connected.';
        $('#modal-body').innerHTML = `<h2>Schematic</h2>
          <p class="muted small">Drawn from the circuit on the workspace: ${sch.parts} parts, ${sch.nets} nets. ${how} The breadboard itself isn't drawn — only what it connects.</p>
          <div class="sch-actions">
            <span class="muted small">Connections:</span><span class="seg"><button data-mode="wires" class="${mode === 'wires' ? 'on' : ''}">Wires</button><button data-mode="labels" class="${mode === 'labels' ? 'on' : ''}">Net labels</button></span>
            <button data-sch="svg">Save as SVG (vector)</button><button data-sch="png">Save as PNG (image)</button></div>
          <div class="sch-preview">${sch.svg}</div>`;
        $('#modal-body').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
          mode = b.dataset.mode;
          render();
        }));
        $('#modal-body').querySelectorAll('[data-sch]').forEach((b) => b.addEventListener('click', () => {
          if (b.dataset.sch === 'svg') this.saveAs('wirebench-schematic.svg', new Blob([sch.svg], { type: 'image/svg+xml' }), 'SVG image', ['svg']);
          else this.schematicPNG(sch);
        }));
      };
      render();
      $('#modal').classList.remove('help');
      $('#modal').classList.add('wide');
      $('#modal').addEventListener('close', () => { if (!$('#modal').open) $('#modal').classList.remove('wide'); }, { once: true }); // not if another viewer opened meanwhile
      $('#modal').showModal();
    }
    // Export → SPICE netlist for LTspice: preview the .cir text and save it.
    showSpice() {
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      if (!this.project.parts.some((p) => PARTS[p.type] && !PARTS[p.type].holes && !PARTS[p.type].annotation)) { this.toast('Add some parts first — the netlist is written from the circuit on the workspace.'); return; }
      const net = WB.Spice.build(this);
      $('#modal-body').innerHTML = `<h2>SPICE netlist for LTspice</h2>
        <p class="muted small">Written from the circuit on the workspace with the same models Wirebench simulates, plus BJT / MOSFET / op-amp models. Save it as a <b>.cir</b> file and open it in LTspice (File → Open), then press Run. Analysis: <code>${WB.esc(net.analysis)}</code>.${net.skipped ? ` ${net.skipped} digital / behavioural part${net.skipped > 1 ? 's are' : ' is'} listed as comments with their pin nets.` : ''}</p>
        <div class="sch-actions"><button data-spice="save">Save as .cir</button><button data-spice="copy">Copy to clipboard</button></div>
        <pre class="spice-text">${WB.esc(net.text)}</pre>`;
      $('#modal-body').querySelector('[data-spice="save"]').addEventListener('click', () => this.saveAs('wirebench.cir', new Blob([net.text], { type: 'text/plain' }), 'SPICE netlist', ['cir', 'net', 'sp']));
      $('#modal-body').querySelector('[data-spice="copy"]').addEventListener('click', () => {
        (navigator.clipboard ? navigator.clipboard.writeText(net.text) : Promise.reject()).then(() => this.toast('Netlist copied'), () => this.toast('Copy failed — select the text and press Ctrl+C'));
      });
      $('#modal').classList.remove('help');
      $('#modal').classList.add('wide');
      $('#modal').addEventListener('close', () => { if (!$('#modal').open) $('#modal').classList.remove('wide'); }, { once: true }); // not if another viewer opened meanwhile
      $('#modal').showModal();
    }
    schematicPNG(sch) {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([sch.svg], { type: 'image/svg+xml' }));
      img.onload = () => {
        const k = 2, c = document.createElement('canvas');
        c.width = sch.width * k; c.height = sch.height * k;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.scale(k, k); ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        c.toBlob((b) => this.saveAs('wirebench-schematic.png', b, 'PNG image', ['png']), 'image/png');
      };
      img.src = url;
    }
    exportPNG() {
      const svg = this.editor.exportSVGString();
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width * 2; c.height = img.height * 2;
        const ctx = c.getContext('2d');
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        c.toBlob((b) => this.saveAs('wirebench-breadboard.png', b, 'PNG image', ['png']), 'image/png');
      };
      img.src = url;
    }
    // Parts list and netlist as HTML tables (Export → Netlist & parts list, and printing).
    netlistHTML() {
      const topo = this.getTopo();
      const byPart = {};
      for (const p of this.project.parts) byPart[p.id] = p;
      const groups = {};
      for (const p of this.project.parts) {
        const def = PARTS[p.type];
        if (def.annotation) continue; // notes are not components
        const key = def.label + (def.summary ? ' — ' + def.summary(p) : '');
        (groups[key] = groups[key] || []).push(p.name);
      }
      let html = '<h3>Parts list</h3><table><tr><th>Qty</th><th>Part</th><th>Labels</th></tr>';
      for (const k of Object.keys(groups).sort()) html += `<tr><td>${groups[k].length}</td><td>${WB.esc(k)}</td><td>${WB.esc(groups[k].join(', '))}</td></tr>`;
      html += '</table><h3>Netlist</h3><table><tr><th>Net</th><th>Connections</th></tr>';
      let n = 0;
      topo.nets.forEach((keys, idx) => {
        const conns = keys.filter((k) => { const p = byPart[k.split(':')[0]]; return p && !PARTS[p.type].holes; })
          .map((k) => { const [pid, pin] = k.split(':'); return byPart[pid].name + '.' + pin; });
        if (conns.length < 2 && idx !== 0) return;
        if (!conns.length) return;
        html += `<tr><td>${idx === 0 ? 'GND' : 'N' + ++n}</td><td>${WB.esc(conns.join(', '))}</td></tr>`;
      });
      return html + '</table>';
    }
    showNetlist() {
      $('#modal-body').innerHTML = this.netlistHTML();
      $('#modal').classList.remove('help', 'wide'); // each dialog sets its own layout
      $('#modal').showModal();
    }

    // ---------------- print
    // File → Print: pick what goes on paper, then print it through the system print dialog
    // (which can also save a PDF). Each section starts a new page; drawings are scaled to fit.
    printContent() {
      const parts = this.project.parts.filter((p) => PARTS[p.type] && !PARTS[p.type].annotation);
      const circuit = parts.filter((p) => !PARTS[p.type].holes);
      return {
        breadboard: parts.length > 0,
        schematic: circuit.length > 0,
        instruments: circuit.filter((p) => PARTS[p.type].category === 'Instruments').length,
        sketch: circuit.some((p) => PARTS[p.type].board),
        parts: circuit.length > 0,
      };
    }
    showPrint() {
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      const have = this.printContent();
      if (!have.breadboard) { this.toast('Nothing to print yet — add some parts first.'); return; }
      let st = {};
      try { st = JSON.parse(localStorage.getItem('wirebench.print') || '{}') || {}; } catch (e) { /* storage unavailable */ }
      const on = (k) => (st[k] !== undefined ? st[k] : k !== 'parts'); // parts list off unless chosen before
      let dlg = $('#print-dlg');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'print-dlg';
        document.body.appendChild(dlg);
      }
      const opt = (k, label, note) => `<label class="pr-opt${have[k] ? '' : ' off'}"><input type="checkbox" data-pk="${k}" ${have[k] && on(k) ? 'checked' : ''} ${have[k] ? '' : 'disabled'}><span>${label}<small>${note}</small></span></label>`;
      const n = have.instruments;
      dlg.innerHTML = `<h3>${WB.icon('print')} Print</h3>
        <div class="pr-fields">
          <label>Title <input data-pf="title" value="${WB.esc(st.title && st.forDoc === this.docName ? st.title : (this.docName || 'Untitled'))}"></label>
          <label>Name <input data-pf="name" placeholder="Your name (optional)" value="${WB.esc(st.name || '')}"></label>
        </div>
        <div class="pr-opts">
          ${opt('breadboard', 'Breadboard view', 'the circuit as drawn on the workspace')}
          ${opt('schematic', 'Schematic diagram', 'drawn from the circuit')}
          ${opt('instruments', 'Instrument screens', n ? `${n} instrument${n > 1 ? 's' : ''}, enlarged — shows what they display now` : 'no instruments in this circuit')}
          ${opt('sketch', 'Sketch', have.sketch ? 'the Arduino code, with line numbers' : 'no board in this circuit')}
          ${opt('parts', 'Parts list &amp; netlist', 'tables of parts and connections')}
        </div>
        <div class="pr-fields">
          <label>Paper <select data-pf="paper"><option value="A4">A4</option><option value="letter">Letter</option></select></label>
          <label>Drawings <select data-pf="orient"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
          <label>Schematic <select data-pf="schMode"><option value="wires">Wires</option><option value="labels">Net labels</option></select></label>
        </div>
        ${n && !this.sim ? '<p class="muted small">Tip: start the simulation first so the instrument screens show readings.</p>' : ''}
        <p class="muted small">To make a PDF, choose “Save as PDF” (or “Microsoft Print to PDF”) as the printer.</p>
        <div class="sa-actions"><button data-pa="print" class="primary">Print…</button><button data-pa="cancel">Cancel</button></div>`;
      dlg.querySelector('[data-pf="paper"]').value = st.paper || 'A4';
      dlg.querySelector('[data-pf="orient"]').value = st.orient || 'landscape';
      dlg.querySelector('[data-pf="schMode"]').value = 'wires'; // always starts with wires, like the schematic export
      dlg.onclick = (e) => {
        const b = e.target.closest('[data-pa]');
        if (!b) return;
        if (b.dataset.pa === 'cancel') { dlg.close(); return; }
        const o = { forDoc: this.docName };
        dlg.querySelectorAll('[data-pf]').forEach((i) => { o[i.dataset.pf] = i.value.trim(); });
        dlg.querySelectorAll('[data-pk]').forEach((i) => { if (!i.disabled) o[i.dataset.pk] = i.checked; });
        try { localStorage.setItem('wirebench.print', JSON.stringify(Object.assign({}, st, o))); } catch (err) { /* storage unavailable */ }
        if (!['breadboard', 'schematic', 'instruments', 'sketch', 'parts'].some((k) => have[k] && o[k])) { this.toast('Tick at least one thing to print.'); return; }
        dlg.close();
        this.printNow(o);
      };
      dlg.showModal();
      dlg.querySelector('[data-pa="print"]').focus();
    }
    // An SVG drawing as an <img>: isolated from the page's styles, and it stays vector on paper.
    printImg(svg, cls) {
      return `<img class="${cls || 'pr-fig'}" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
    }
    // One instrument's front panel as it looks right now, cropped to the part.
    instrumentSVG(p) {
      const g = this.editor.partEls.get(p.id);
      if (!g) return '';
      const [bx, by, bw, bh] = PARTS[p.type].bbox(p.props || {});
      const pad = 4;
      const defs = document.getElementById('wbDefs').outerHTML;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx - pad} ${by - pad} ${bw + pad * 2} ${bh + pad * 2}" width="${bw + pad * 2}" height="${bh + pad * 2}">${defs}${g.querySelector('.body').innerHTML}</svg>`;
    }
    async printNow(o) {
      const have = this.printContent();
      const want = (k) => have[k] && o[k];
      const date = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
      const meta = [o.name ? `<b>${WB.esc(o.name)}</b>` : '', WB.esc(date), `Wirebench ${WB.esc(WB.VERSION)}`].filter(Boolean).join(' · ');
      const secs = [];
      if (want('breadboard')) secs.push(['Breadboard view', this.printImg(this.editor.exportSVGString())]);
      if (want('schematic')) secs.push(['Schematic', this.printImg(WB.Schematic.build(this, { mode: o.schMode === 'labels' ? 'labels' : 'wires' }).svg)]);
      if (want('instruments')) {
        const tm = this.sim && ($('#sim-time').textContent.match(/\d+:\d+\.\d/) || [])[0];
        const t = this.sim ? ` <span class="pr-note">— captured ${tm ? tm + ' after the simulation started' : 'while the simulation was running'}</span>` : '';
        const figs = this.project.parts.filter((p) => PARTS[p.type] && PARTS[p.type].category === 'Instruments').map((p) => {
          const def = PARTS[p.type];
          return `<figure>${this.printImg(this.instrumentSVG(p), 'pr-inst')}<figcaption><b>${WB.esc(p.name)}</b> — ${WB.esc(def.label)}${def.summary ? ': ' + WB.esc(def.summary(p)) : ''}</figcaption></figure>`;
        }).join('');
        secs.push(['Instrument screens' + t, `<div class="pr-insts n${Math.min(3, have.instruments)}">${figs}</div>`]);
      }
      if (want('sketch')) {
        const lines = highlight(this.code.value).split('\n');
        const w = String(lines.length).length;
        secs.push(['Sketch', `<pre class="pr-code">${lines.map((l, i) => `<span class="ln">${String(i + 1).padStart(w)}</span>${l}`).join('\n')}</pre>`]);
      }
      if (want('parts')) secs.push(['Parts list &amp; netlist', `<div class="pr-tables">${this.netlistHTML()}</div>`]);

      let area = $('#print-area');
      if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
      area.className = o.orient === 'portrait' ? 'portrait' : 'landscape';
      area.innerHTML = secs.map(([h, body], i) => `<section class="pr-sec">
        ${i === 0 ? `<header class="pr-head"><h1>${WB.esc(o.title || this.docName || 'Untitled')}</h1><div>${meta}</div></header>` : ''}
        <h2>${h}</h2>${body}</section>`).join('');
      let page = $('#print-page');
      if (!page) { page = document.createElement('style'); page.id = 'print-page'; document.head.appendChild(page); }
      page.textContent = `@page { size: ${o.paper === 'letter' ? 'letter' : 'A4'} ${o.orient === 'portrait' ? 'portrait' : 'landscape'}; margin: 12mm; }`;
      // wait until the drawings are decoded so none print blank
      await Promise.all([...area.querySelectorAll('img')].map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
      const prevTitle = document.title;
      document.title = o.title || this.docName || 'Wirebench'; // the suggested PDF file name
      const cleanup = () => { document.title = prevTitle; area.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
    }

    // ---------------- console / serial / toast
    log(msg, kind) {
      const c = $('#console');
      const d = document.createElement('div');
      d.className = 'msg ' + (kind || 'info');
      d.textContent = msg;
      c.appendChild(d);
      while (c.children.length > 60) c.firstChild.remove();
      c.scrollTop = c.scrollHeight;
      c.classList.add('has');
      if (kind === 'error') { this.setCodePanel(true); this.setSection('sketch', true); } // sketch errors must be visible
    }
    // Collapsible panel sections: parts, inspector, sketch, serial (▾ / ▸ buttons in their headers).
    setSection(sec, show) {
      const cls = 'hide-' + sec;
      if (show === !document.body.classList.contains(cls)) return;
      document.body.classList.toggle(cls, !show);
      document.querySelectorAll(`.sec-toggle[data-sec="${sec}"]`).forEach((b) => { b.textContent = show ? '▾' : '▸'; });
      this.saveLayout();
    }
    // Show / hide the whole left panel (parts list and inspector).
    setLeftPanel(show, quiet) {
      if (show === !document.body.classList.contains('left-hidden')) return;
      document.body.classList.toggle('left-hidden', !show);
      $('#btn-left').classList.toggle('active', show);
      this.saveLayout();
      if (!quiet) this.toast(show ? 'Parts panel shown' : 'Parts panel hidden (Ctrl+Shift+B to show it)');
      this.fitAfterResize();
    }
    // A side panel opened or closed: once the new layout is in place, fit the circuit to the
    // workspace's new size (it would otherwise be cut off, or sit small in a corner).
    fitAfterResize() {
      cancelAnimationFrame(this._fitRaf);
      this._fitRaf = requestAnimationFrame(() => requestAnimationFrame(() => { if (this.editor) this.editor.fit(); }));
    }
    saveLayout() {
      const b = document.body.classList;
      const o = { left: !b.contains('left-hidden') };
      for (const sec of ['parts', 'inspector', 'sketch', 'serial']) o[sec] = !b.contains('hide-' + sec);
      try { localStorage.setItem('wirebench.layout', JSON.stringify(o)); } catch (e) { /* storage unavailable */ }
    }
    loadLayout() {
      let o = null;
      try { o = JSON.parse(localStorage.getItem('wirebench.layout') || 'null'); } catch (e) { /* storage unavailable */ }
      document.querySelectorAll('.sec-toggle').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const sec = b.dataset.sec;
        this.setSection(sec, document.body.classList.contains('hide-' + sec));
      }));
      if (!o) return;
      if (o.left === false) this.setLeftPanel(false, true);
      for (const sec of ['parts', 'inspector', 'sketch', 'serial']) if (o[sec] === false) this.setSection(sec, false);
    }
    // Show / hide the right-hand code panel (sketch, console, serial monitor).
    setCodePanel(show, quiet) {
      const hidden = document.body.classList.contains('code-hidden');
      if (show === !hidden) return;
      document.body.classList.toggle('code-hidden', !show);
      const b = $('#btn-panel');
      if (b) { b.classList.toggle('active', show); b.classList.remove('news'); }
      try { localStorage.setItem('wirebench.codePanel', show ? 'shown' : 'hidden'); } catch (e) { /* storage unavailable */ }
      if (!quiet) this.toast(show ? 'Code panel shown' : 'Code panel hidden — more room for the circuit (Ctrl+B to show it)');
      this.fitAfterResize();
    }
    clearConsole() { const c = $('#console'); c.textContent = ''; c.classList.remove('has'); }
    serialOut(s) { this.serialBuf += s; }
    flushSerial() {
      if (!this.serialBuf) return;
      const el = $('#serial-out');
      let t = el.textContent + this.serialBuf;
      this.serialBuf = '';
      if (t.length > 60000) t = t.slice(-50000);
      el.textContent = t;
      if ($('#autoscroll').checked) el.scrollTop = el.scrollHeight;
      if (document.body.classList.contains('code-hidden')) $('#btn-panel').classList.add('news'); // new serial output while hidden
    }
    toast(msg) {
      const t = $('#toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove('show'), 2600);
    }
    updateBoardLabel() {
      const b = this.boardPart();
      $('#board-label').textContent = b ? PARTS[b.type].board.short : 'no board';
    }

    // ---------------- simulation
    markDirty() { this.dirty = true; }
    ensureSolved() { if (this.sim && this.dirty) this.solveNow(); }
    solveNow() {
      this.dirty = false;
      const b = this.boardPart();
      const analog = this.analogRequest();
      this.results = WB.Circuit.solve(this.getTopo(), this.project, this.sim, { boardId: b && b.id, transient: this.transient, analog });
      if (this.results.analog) this.captureAnalog(analog, this.results.analog);
      else this.captureLogic();
      // a part changed its own state (e.g. power supply switched to current limiting): solve again
      if (Object.values(this.results.vis).some((v) => v.again)) this.dirty = true;
      if (this.runtime) this.runtime.onSolved();
      for (const w of this.results.warnings) {
        if (!this.sim.warned.has(w)) { this.sim.warned.add(w); this.log('⚠ ' + w, 'warn'); }
      }
      this.noteWarnings(this.results.warnings);
    }

    // Warnings on the canvas. A problem that only exists part of the time (an LED without a
    // resistor on a blinking pin, a current peak during a PWM pulse) would otherwise flash on and
    // off with every solve. Each warning therefore stays at least WARN_HOLD ms after it last
    // occurred, then fades out; warnings that differ only in their numbers ("42 mA" / "43 mA")
    // count as one and are updated in place. At most WARN_MAX are shown, oldest first.
    noteWarnings(list) {
      const now = performance.now();
      if (!this.warnHold) this.warnHold = new Map();
      for (const w of list) {
        const k = w.replace(/-?\d+(?:\.\d+)?/g, '#');
        const old = this.warnHold.get(k);
        this.warnHold.set(k, { text: w, first: old ? old.first : now, until: now + WARN_HOLD });
      }
      this.renderWarnings(now);
    }
    renderWarnings(now) {
      if (!this.warnHold) return;
      now = now || performance.now();
      for (const [k, v] of this.warnHold) if (v.until + WARN_FADE < now) this.warnHold.delete(k);
      const shown = [...this.warnHold.values()].sort((a, b) => a.first - b.first).slice(0, WARN_MAX);
      // the text plus whether it is fading decides if the banner needs redrawing
      const key = shown.map((v) => (v.until < now ? '~' : '') + v.text).join('\n');
      if (key === this.warnShown) return;
      this.warnShown = key;
      $('#warnings').innerHTML = shown.map((v) => `<div class="${v.until < now ? 'fading' : ''}">⚠ ${WB.esc(v.text)}</div>`).join('');
    }
    clearWarnings() { this.warnHold = new Map(); this.warnShown = ''; $('#warnings').innerHTML = ''; }
    // Modulino parts of a type that sit on the board's I2C bus (SDA + SCL connected) and have 3.3 V power.
    i2cDevices(type, o) {
      o = o || {};
      const vcc = o.vcc || '3V3', vmin = o.vmin || 2.8;
      const b = this.boardPart();
      if (!b) return [];
      this.ensureSolved();
      const topo = this.getTopo();
      const bus = PARTS[b.type].board.i2c;
      const sda = topo.nodeOf.get(b.id + ':' + bus.sda), scl = topo.nodeOf.get(b.id + ':' + bus.scl);
      const V = (k) => (k && this.results ? this.results.V[k] || 0 : 0);
      return this.project.parts.filter((p) => {
        if (p.type !== type || (o.pred && !o.pred(p))) return false;
        const n = (id) => topo.nodeOf.get(p.id + ':' + id);
        return sda !== undefined && n('SDA') === sda && n('SCL') === scl && V(n(vcc)) - V(n('GND')) > vmin;
      });
    }
    // Parts of a type whose pins are wired to the given board pins, e.g. { RS: 'D12', E: 'D11' }.
    wiredParts(type, map, pred) {
      const b = this.boardPart();
      if (!b) return [];
      const topo = this.getTopo();
      return this.project.parts.filter((p) => p.type === type && (!pred || pred(p)) && Object.entries(map).every(([pin, bpin]) => {
        const a = topo.nodeOf.get(p.id + ':' + pin), bb = topo.nodeOf.get(b.id + ':' + bpin);
        return a !== undefined && a === bb;
      }));
    }
    // Voltage between two pins of a part (0 when not solved yet).
    partVolts(p, pa, pb) {
      const topo = this.getTopo();
      const V = (id) => { const k = topo.nodeOf.get(p.id + ':' + id); return k && this.results ? this.results.V[k] || 0 : 0; };
      return V(pa) - V(pb);
    }
    // Wire a Modulino's GND/3.3V/SDA/SCL to the board's Qwiic connector (or its I2C header pins).
    connectQwiic(part) {
      const b = this.boardPart();
      if (!b) { this.toast('Add a board first.'); return; }
      const spec = PARTS[b.type].board;
      const targets = spec.qwiic ? ['QGND', 'Q3V3', 'QSDA', 'QSCL'] : ['GND', '3V3', spec.i2c.sda, spec.i2c.scl];
      const colors = ['#1f1f1f', '#d62828', '#2f7de1', '#f2c200'];
      this.mutate(() => {
        this.project.wires = this.project.wires.filter((w) => !(w.a.part === part.id || w.b.part === part.id));
        ['GND', '3V3', 'SDA', 'SCL'].forEach((pin, i) => {
          this.project.wires.push({ id: WB.uid('w'), a: { part: part.id, pin }, b: { part: b.id, pin: targets[i] }, pts: [], color: colors[i] });
        });
      });
      this.toast(`${part.name} connected to the ${spec.qwiic ? 'Qwiic connector' : 'I2C pins (SDA/SCL)'} of ${spec.short}.`);
    }

    // Echo pulse length (µs) for pulseIn() on a board pin wired to an HC-SR04 Echo that was triggered.
    echoMicros(pin, lastPulse) {
      const b = this.boardPart();
      const topo = this.getTopo();
      const node = topo.nodeOf.get(b.id + ':' + pin);
      if (node === undefined || !this.results) return 0;
      const V = (k) => (k ? this.results.V[k] || 0 : 0);
      const now = this.runtime ? this.runtime.millis() : 0;
      for (const p of this.project.parts) {
        const n = (id) => topo.nodeOf.get(p.id + ':' + id);
        if (p.type === 'ping') {
          // 3-pin sensor: trigger and echo share the SIG pin
          if (n('SIG') !== node) continue;
          if (V(n('5V')) - V(n('GND')) < 4) { this.runtime && this.runtime.warnOnce('us-power:' + p.id, `${p.name}: the ultrasonic sensor needs 5 V and GND connected.`); continue; }
          if (!(now - (lastPulse[pin] || -1e9) < 100)) { this.runtime && this.runtime.warnOnce('us-trig:' + p.id, `${p.name}: pulse SIG HIGH (OUTPUT) for about 5 µs, then switch the pin to INPUT and call pulseIn().`); continue; }
          return Math.round(Number(p.props.cm) * 58.3);
        }
        if (p.type !== 'hcsr04') continue;
        if (n('ECHO') !== node) continue;
        if (V(n('VCC')) - V(n('GND')) < 4) { this.runtime && this.runtime.warnOnce('us-power:' + p.id, `${p.name}: the ultrasonic sensor needs 5 V on VCC and GND connected.`); continue; }
        const trig = n('TRIG');
        const triggered = Object.keys(lastPulse).some((name) => now - lastPulse[name] < 100 && topo.nodeOf.get(b.id + ':' + name) === trig);
        if (!triggered) { this.runtime && this.runtime.warnOnce('us-trig:' + p.id, `${p.name}: no trigger pulse seen on Trig. Pulse it HIGH for 10 µs before pulseIn().`); continue; }
        return Math.round(Number(p.props.cm) * 58.3);
      }
      return 0;
    }
    // Settings for the time-domain solver (used when the circuit has capacitors or a function
    // generator): real time passed since the last solve, the nodes the scopes probe, and the
    // sample spacing the finest scope time base needs (500 points per screen).
    analogRequest() {
      const an = this.sim.analog;
      const now = performance.now();
      an.elapsed = an.lastReal == null ? 0 : (now - an.lastReal) / 1000;
      an.lastReal = now;
      const topo = this.getTopo();
      an.probes = [];
      an.scopes = [];
      let res = 1e-3;
      an.fine = false;
      for (const p of this.project.parts) {
        if (p.type !== 'scope') continue;
        const W = ((+p.props.tdiv || 20) * WB.SCOPE_DIVX) / 1000; // screen width in seconds
        // while AUTO measures, keep every solver step (no decimation) and don't let the
        // current time base shrink the step, so any period can be found quickly
        const fine = !!(WB.scopeAuto && WB.scopeAuto.has(p.id));
        if (fine) an.fine = true;
        else res = Math.min(res, W / 500);
        const idx = {};
        for (const id of ['CH1', 'CH2', 'GND']) {
          const k = topo.nodeOf.get(p.id + ':' + id);
          idx[id] = { k, i: an.probes.length };
          an.probes.push(k === undefined ? 0 : k);
        }
        an.scopes.push({ p, idx, W: W * 1000, fine });
      }
      // logic analyzers record from the same time-domain samples
      an.las = [];
      for (const p of this.project.parts) {
        if (p.type !== 'logicanalyzer') continue;
        const idx = {};
        for (const id of ['CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'CH8', 'GND']) {
          const k = topo.nodeOf.get(p.id + ':' + id);
          idx[id] = { k, i: an.probes.length };
          an.probes.push(k === undefined ? 0 : k);
        }
        an.las.push({ p, idx });
        res = Math.min(res, (+p.props.tdiv || 1) * 10 / 1000 / 500);
      }
      an.res = res;
      return an;
    }
    // Append the time-domain samples of each scope's channels (t in ms of simulated time).
    captureAnalog(an, out) {
      const topo = this.getTopo(), R = this.results;
      const P = out.nProbes + 1, S = out.samples;
      for (const sc of an.scopes) {
        const buf = (this.sim.scope[sc.p.id] = this.sim.scope[sc.p.id] || []);
        if (buf.length && !buf[buf.length - 1].lin) buf.length = 0;
        const ok = (id) => { const k = sc.idx[id].k; return k !== undefined && topo.nets[k] && topo.nets[k].length > 1 && !(k !== 0 && R.floating.has(k)); };
        const c1 = ok('CH1'), c2 = ok('CH2');
        const spacing = sc.fine ? 0 : sc.W / 500 * 0.999;
        for (let o = 0; o + P <= S.length; o += P) {
          const t = S[o] * 1000;
          if (buf.length && t - buf[buf.length - 1].t < spacing) continue;
          const g = S[o + 1 + sc.idx.GND.i];
          buf.push({ t, v1: c1 ? +(S[o + 1 + sc.idx.CH1.i] - g).toFixed(5) : null, v2: c2 ? +(S[o + 1 + sc.idx.CH2.i] - g).toFixed(5) : null, lin: true });
        }
        const keep = buf.length && !sc.fine ? buf[buf.length - 1].t - 2.2 * sc.W : -Infinity;
        let drop = 0;
        while (drop < buf.length - 2 && buf[drop].t < keep) drop++;
        if (buf.length - drop > 6000) drop = buf.length - 6000;
        if (drop) buf.splice(0, drop);
      }
      for (const la of an.las || []) {
        const ok = (id) => { const k = la.idx[id].k; return k !== undefined && topo.nets[k] && topo.nets[k].length > 1 && !(k !== 0 && R.floating.has(k)); };
        const conn = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => ok('CH' + c));
        const thr = +la.p.props.thr || 1.4;
        const buf = this.laBuffer(la.p, true);
        for (let o = 0; o + P <= S.length; o += P) {
          const gnd = S[o + 1 + la.idx.GND.i];
          const lv = conn.map((c, j) => (c ? (S[o + 1 + la.idx['CH' + (j + 1)].i] - gnd > thr ? 1 : 0) : null));
          this.laPush(buf, S[o] * 1000, lv, [null, null, null, null, null, null, null, null]);
        }
        if (S.length >= P) buf.tEnd = S[S.length - P] * 1000;
      }
    }
    // ---------------- logic analyzer recording
    laBuffer(p, analog) {
      const all = this.sim.la || (this.sim.la = {});
      let b = all[p.id];
      if (!b || b.analog !== analog) b = all[p.id] = { ev: [], key: null, analog, tEnd: 0 };
      return b;
    }
    laPush(buf, t, lv, pw) {
      const key = lv.join() + '|' + pw.map((x) => (x ? x.d.toFixed(3) + '/' + x.T.toFixed(4) : '')).join();
      if (key === buf.key) return;
      buf.key = key;
      buf.ev.push({ t, lv, pw });
      // keep ~12 s of history (and at most 40000 changes)
      let drop = 0;
      while (drop < buf.ev.length - 2 && buf.ev[drop + 1].t < t - 12000) drop++;
      if (buf.ev.length - drop > 40000) drop = buf.ev.length - 40000;
      if (drop) buf.ev.splice(0, drop);
    }
    // After a DC / digital solve: record the analyzers' channel levels (and PWM) when they change.
    // Each change is stamped with the sketch's time, at least 4 µs after the previous one, so
    // the edges of a fast sequence (shiftOut) are spread out as on a real board.
    captureLogic() {
      const R = this.results;
      if (!R || R.analog) return;
      const topo = this.getTopo();
      for (const p of this.project.parts) {
        if (p.type !== 'logicanalyzer') continue;
        const n = (id) => topo.nodeOf.get(p.id + ':' + id);
        const ng = n('GND'), g0 = ng ? R.V[ng] : 0, thr = +p.props.thr || 1.4;
        const lv = [], pw = [];
        for (let c = 1; c <= 8; c++) {
          const k = n('CH' + c);
          if (k === undefined || !topo.nets[k] || topo.nets[k].length < 2 || (k !== 0 && R.floating.has(k))) { lv.push(null); pw.push(null); continue; }
          const v = (k ? R.V[k] : 0) - g0, wv = R.wave(k);
          if (wv && wv.hi - g0 > thr && wv.lo - g0 < thr) { lv.push(1); pw.push({ d: wv.duty, T: wv.periodMs }); }
          else { lv.push(v > thr ? 1 : 0); pw.push(null); }
        }
        const buf = this.laBuffer(p, false);
        const rt = this.runtime, base = rt ? rt.millis() : performance.now() - this.sim.t0;
        const prev = buf.ev.length ? buf.ev[buf.ev.length - 1].t : -Infinity;
        // no pause (delay / yield) since the last change: the sketch ran straight on, ~4 µs per call
        const burst = rt && buf.epoch === rt.lastYield && prev > -Infinity;
        const t = burst ? prev + 0.004 : Math.max(base, prev + 0.004);
        const before = buf.ev.length;
        this.laPush(buf, t, lv, pw);
        if (buf.ev.length !== before || !burst) buf.epoch = rt ? rt.lastYield : null;
      }
    }
    // Record oscilloscope channel voltages (and PWM waveform) once per frame.
    captureScopes() {
      if (!this.results || this.results.analog) return;
      const topo = this.getTopo(), R = this.results;
      const t = performance.now() - this.sim.t0;
      for (const p of this.project.parts) {
        if (p.type !== 'scope') continue;
        const n = (id) => topo.nodeOf.get(p.id + ':' + id);
        const ng = n('GND');
        const connected = (k) => k !== undefined && topo.nets[k] && topo.nets[k].length > 1 && !(k !== 0 && R.floating.has(k));
        const chan = (id) => {
          const k = n(id);
          if (!connected(k)) return [null, null];
          const v = (k ? R.V[k] : 0) - (ng ? R.V[ng] : 0);
          const w = R.wave(k);
          return [+v.toFixed(4), w && { hi: w.hi - (ng ? R.V[ng] : 0), lo: w.lo - (ng ? R.V[ng] : 0), duty: w.duty, periodMs: w.periodMs }];
        };
        const [v1, w1] = chan('CH1'), [v2, w2] = chan('CH2');
        const buf = (this.sim.scope[p.id] = this.sim.scope[p.id] || []);
        buf.push({ t, v1, w1, v2, w2 });
        while (buf.length > 2 && buf[1].t < t - 10500) buf.shift(); // keep ~10 s (the longest time base)
        if (buf.length > 4000) buf.splice(0, buf.length - 4000);
      }
    }
    pinReading(name) {
      const b = this.boardPart();
      const node = this.getTopo().nodeOf.get(b.id + ':' + name);
      if (node === undefined || !this.results) return { v: 0, floating: true };
      if (node === 0) return { v: 0, floating: false };
      return { v: this.results.V[node], floating: this.results.floating.has(node) };
    }
    frame() {
      requestAnimationFrame(this.frame);
      if (this.sim) {
        // time-domain circuits (capacitors, function generators) advance every frame
        if (this.dirty || (this.results && this.results.analog)) this.solveNow();
        this.captureScopes();
        this.editor.applyVisuals();
        this.renderWarnings(); // let held warnings expire even when nothing is being solved
        const t = (performance.now() - this.sim.t0) / 1000;
        const an = this.results && this.results.analog;
        $('#sim-time').textContent = 'Running ' + Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0') + (an && an.speed < 0.95 ? ` · analog slow-motion ${Math.max(1, Math.round(an.speed * 100))}%` : '');
        if (this.results) {
          const live = new Set();
          for (const id in this.results.vis) {
            const v = this.results.vis[id];
            if (v.on && v.freq) { Audio.set(id, v.freq); live.add(id); }
          }
          for (const id in Audio.osc) if (!live.has(id)) Audio.set(id, 0);
        }
      }
      this.flushSerial();
    }
    compile(apiNames) {
      const b = this.boardPart();
      const tr = WB.Sketch.transpile(this.code.value, apiNames, { board: b ? PARTS[b.type].board : null });
      if (tr.error) return Promise.reject(tr.error);
      return WB.Sketch.load(tr.js).then((r) => Object.assign(r, { tr }));
    }
    // API names for the current board (used by Verify and the live checker)
    apiNamesFor() {
      const b = this.boardPart();
      const spec = b ? PARTS[b.type].board : WB.BOARDS['board-uno-q'];
      return Object.keys(new WB.Runtime(this, b || { type: 'board-uno-q', x: 0, y: 0, rot: 0, props: {} }, spec).makeApi());
    }
    // Check the sketch a moment after typing stops, and mark the first error.
    scheduleLiveCheck() {
      clearTimeout(this._liveT);
      this._liveT = setTimeout(() => this.liveCheck(), 900);
    }
    async liveCheck() {
      const src = this.code.value;
      const status = $('#code-status');
      try {
        await this.compile(this.apiNamesFor());
        if (this.code.value !== src) return;
        status.className = 'ok'; status.textContent = '✓ No errors';
        this.code.clearError();
      } catch (err) {
        if (this.code.value !== src) return;
        const msg = WB.Sketch.friendlyMessage(err.message);
        status.className = 'err';
        status.textContent = `✗ ${err.line ? 'Line ' + err.line + ': ' : ''}${msg}`;
        status.title = err.hint || '';
        if (err.line) this.code.showError(err.line, true);
      }
    }
    async verify() {
      this.clearConsole();
      const b = this.boardPart();
      const spec = b ? PARTS[b.type].board : WB.BOARDS['board-uno-q'];
      try {
        await this.compile(this.apiNamesFor());
        this.log(`✓ Sketch compiled for ${spec.label} — no errors.`, 'ok');
        const st = $('#code-status'); st.className = 'ok'; st.textContent = '✓ No errors';
        this.toast('✓ No errors');
      } catch (err) { this.reportCompileError(err); }
    }
    reportCompileError(err) {
      const line = err.line;
      const msg = WB.Sketch.friendlyMessage(err.message);
      this.log(`✗ Compilation error${line ? ' on line ' + line : ''}: ${msg}`, 'error');
      if (err.hint) this.log('   ' + err.hint, 'info');
      const st = $('#code-status');
      st.className = 'err';
      st.textContent = `✗ ${line ? 'Line ' + line + ': ' : ''}${msg}`;
      st.title = err.hint || '';
      if (line) this.code.showError(line);
      this.toast(`✗ Compilation error${line ? ' on line ' + line : ''} — see below the code`);
    }
    async startSim() {
      Audio.ensure();
      this.clearConsole();
      $('#serial-out').textContent = '';
      this.clearWarnings();
      const b = this.boardPart();
      const spec = b ? PARTS[b.type].board : null;
      if (WB.scopeAuto) WB.scopeAuto.clear();
      this.sim = { pins: {}, servos: [], modulino: {}, scope: {}, analog: { t: 0, lastReal: null }, matrix: spec && spec.matrix ? new Uint8Array(spec.matrix.w * spec.matrix.h) : null, partState: {}, warned: new Set(), t0: performance.now(), lcd: {}, neo: {}, irq: [], la: {}, nex: {} };
      // chips that react to clock edges (74HC595): solve after every digitalWrite so no edge is missed
      this.clocked = this.project.parts.some((p) => PARTS[p.type] && PARTS[p.type].clocked);
      this.setRunUI(true);
      this.markDirty();
      if (!b) { this.log('No microcontroller board — simulating the circuit only (batteries, switches, LEDs…).', 'info'); return; }
      const rt = (this.runtime = new WB.Runtime(this, b, spec));
      const api = rt.makeApi();
      let compiled;
      try { compiled = await this.compile(Object.keys(api)); }
      catch (err) { this.reportCompileError(err); this.stopSim(); return; }
      if (!this.sim || this.runtime !== rt) return;
      this.sketchUrl = compiled.url;
      this.log(`▶ Running on ${spec.label} (${spec.vcc} V logic) · circuit solver: ${WB.Native.kind}.`, 'ok');
      let prog;
      try { prog = await compiled.factory(api); }
      catch (e) { this.onRuntimeError(e); return; }
      rt.run(prog);
    }
    stopSim() {
      if (this.runtime) this.runtime.stop();
      this.runtime = null;
      this.sim = null;
      this.results = null;
      this.transient = {};
      Audio.stopAll();
      this.clearWarnings();
      this.setRunUI(false);
      this.editor.render();
    }
    onRuntimeError(e) {
      const line = WB.Sketch.errorLine(e, this.sketchUrl);
      let msg = e && e.message ? e.message : String(e);
      if (/is not defined/.test(msg)) msg += ' (unsupported library or a typo?)';
      this.log(`✗ Runtime error${line ? ' on line ' + line : ''}: ${msg}`, 'error');
      if (line) this.code.showError(line);
      if (this.runtime) this.runtime.running = false;
    }
    setRunUI(on) {
      const b = $('#btn-run');
      b.innerHTML = on ? '■ <span class="lbl-long">Stop simulation</span><span class="lbl-short">Stop</span>' : '▶ <span class="lbl-long">Start simulation</span><span class="lbl-short">Run</span>';
      b.classList.toggle('stop', on);
      document.body.classList.toggle('simulating', on);
      $('#sim-time').textContent = on ? 'Running' : 'Stopped';
      if (this.editor.drawing) this.editor.cancelDraw();
      this.editor.hideMenu();
      this.refreshInspector();
      this.refreshPropDialog();
    }
  }

  WB.DEFAULT_CODE = `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`;

  window.addEventListener('DOMContentLoaded', () => { WB.app = new App(); });
})(window.WB);

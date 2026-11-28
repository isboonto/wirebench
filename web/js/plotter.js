'use strict';
// Data plotter: records the channels of every "Data plotter" part over a whole run and draws them
// in the Plotter tab next to the Serial Monitor. Time is the simulation's time in seconds (exact
// solver time for circuits with capacitors / function generators, the sketch's clock otherwise).
// The recording stays after the simulation stops, so it can be inspected and saved as CSV.
(function (WB) {
  const MAX_POINTS = 60000; // per channel; above this every other point is dropped (resolution halves)

  const P = (WB.Plotter = {
    series: [],   // [{ pid, ch, label, color, t: [], v: [] }]
    tEnd: 0,      // last recorded time (s)
    limit: 0,     // simulation time set in the toolbar (s), 0 = until stopped
    hover: null,  // pointer x on the canvas (CSS px) for the readout
    app: null,

    // ---------------------------------------------------------------- recording
    // A new run: one empty series per channel of each plotter part.
    reset(app) {
      this.app = app;
      this.series = [];
      this.tEnd = 0;
      this.limit = app.simTimeSec();
      for (const p of app.project.parts) {
        if (p.type !== 'plotter') continue;
        for (let c = 1; c <= 4; c++) this.series.push({ pid: p.id, ch: c, label: `${p.name || 'PLT'} CH${c}`, color: WB.PLOT_COLORS[c - 1], t: [], v: [] });
      }
      this.requestDraw();
    },
    // vals: [v1, v2, v3, v4] for plotter part pid at time t (s); null = channel not connected.
    // hold: values stay constant between samples (DC solves), so changes are drawn as steps.
    push(pid, t, vals, hold) {
      if (this.limit && t > this.limit + 1e-9) return;
      for (const s of this.series) {
        if (s.pid !== pid) continue;
        const v = vals[s.ch - 1];
        if (v == null || !Number.isFinite(v)) continue;
        const n = s.t.length;
        if (n && t <= s.t[n - 1]) continue; // time only moves forward
        // a jump (digital edge, switch): repeat the old value just before it, so the edge is drawn
        // as a vertical step at the right time instead of a slope from the previous sample
        if (hold && n && s.v[n - 1] !== v && t - 1e-6 > s.t[n - 1]) { s.t.push(t - 1e-6); s.v.push(s.v[n - 1]); }
        s.t.push(t); s.v.push(v);
        if (s.t.length > MAX_POINTS) { s.t = s.t.filter((_, i) => i % 2 === 0); s.v = s.v.filter((_, i) => i % 2 === 0); }
      }
      if (t > this.tEnd) this.tEnd = t;
    },
    clear() {
      for (const s of this.series) { s.t = []; s.v = []; }
      this.tEnd = 0;
      this.requestDraw();
    },
    hasData() { return this.series.some((s) => s.t.length); },

    // ---------------------------------------------------------------- CSV
    // time_s, then one column per channel that recorded something. Rows are the union of all
    // sample times; a channel without a sample at that time leaves its cell empty.
    csv() {
      const used = this.series.filter((s) => s.t.length);
      const times = [...new Set(used.flatMap((s) => s.t))].sort((a, b) => a - b);
      const idx = used.map(() => 0);
      const rows = ['time_s,' + used.map((s) => `"${s.label} (V)"`).join(',')];
      for (const t of times) {
        const cells = used.map((s, j) => {
          while (idx[j] < s.t.length && s.t[idx[j]] < t) idx[j]++;
          return idx[j] < s.t.length && s.t[idx[j]] === t ? +s.v[idx[j]].toPrecision(7) : '';
        });
        rows.push(+t.toPrecision(9) + ',' + cells.join(','));
      }
      return rows.join('\r\n') + '\r\n';
    },

    // ---------------------------------------------------------------- view (auto scale / zoom)
    // auto: the view follows the recording (0 … end of run, values fitted). Zooming or panning
    // switches auto off and keeps the chosen window; Auto (or a double-click) turns it back on.
    view: { auto: true, x0: 0, x1: 1, y0: -1, y1: 1 },
    autoRange() {
      const used = this.series.filter((s) => s.t.length);
      let lo = Infinity, hi = -Infinity;
      for (const s of used) for (const v of s.v) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (!Number.isFinite(lo)) { lo = 0; hi = 5; }
      if (hi - lo < 1e-3) { lo -= 0.5; hi += 0.5; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0; // include 0 V when it's close
      return { x0: 0, x1: Math.max(this.limit || 0, this.tEnd, 1e-3), y0: lo, y1: hi };
    },
    range() { return this.view.auto ? this.autoRange() : this.view; },
    setAuto() { this.view.auto = true; this.syncButtons(); this.requestDraw(); },
    // zoom by factor f (<1 = in) around the point (cx, cy) in data units; axis 'x', 'y' or 'xy'
    zoom(f, axis, cx, cy) {
      const r = this.range();
      if (cx == null) cx = (r.x0 + r.x1) / 2;
      if (cy == null) cy = (r.y0 + r.y1) / 2;
      const v = { auto: false, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 };
      if (axis !== 'y') { v.x0 = cx - (cx - r.x0) * f; v.x1 = cx + (r.x1 - cx) * f; }
      if (axis !== 'x') { v.y0 = cy - (cy - r.y0) * f; v.y1 = cy + (r.y1 - cy) * f; }
      if (v.x1 - v.x0 < 1e-7 || v.y1 - v.y0 < 1e-7) return; // deep enough
      this.view = v;
      this.syncButtons();
      this.requestDraw();
    },

    // ---------------------------------------------------------------- markers
    // Two time markers (T1, T2) and two value markers (V1, V2), in data units; null = off.
    tm: null, vm: null,
    toggleTimeMarkers() {
      const r = this.range();
      this.tm = this.tm ? null : [r.x0 + (r.x1 - r.x0) * 0.25, r.x0 + (r.x1 - r.x0) * 0.75];
      this.syncButtons(); this.requestDraw();
    },
    toggleValueMarkers() {
      const r = this.range();
      this.vm = this.vm ? null : [r.y0 + (r.y1 - r.y0) * 0.75, r.y0 + (r.y1 - r.y0) * 0.25];
      this.syncButtons(); this.requestDraw();
    },
    syncButtons() {
      const on = (cmd, v) => document.querySelectorAll(`[data-plot="${cmd}"]`).forEach((b) => b.classList.toggle('on', !!v));
      on('tm', this.tm); on('vm', this.vm); on('auto', this.view.auto);
    },
    // marker readout under the graph (HTML, so it can wrap)
    info() {
      const el = document.getElementById('plot-info');
      if (!el) return;
      const used = this.series.filter((s) => s.t.length);
      const parts = [];
      const r = this.range(), span = r.x1 - r.x0;
      const tf = (t) => fmtTime(t, span);
      if (this.tm) {
        const [a, b] = this.tm, dt = Math.abs(b - a);
        parts.push(`<span class="pi-t">T1 ${tf(a)} · T2 ${tf(b)} · <b>Δt ${tf(dt)}</b>${dt > 0 ? ` (${fmtFreq(1 / dt)})` : ''}</span>`);
        for (const s of used) {
          const va = valueAt(s, a), vb = valueAt(s, b);
          const f = (v) => (v == null ? '—' : v.toFixed(3) + ' V');
          parts.push(`<span><i style="background:${s.color}"></i>${WB.esc(s.label)}: ${f(va)} → ${f(vb)}${va != null && vb != null ? ` · <b>Δ ${(vb - va).toFixed(3)} V</b>` : ''}</span>`);
        }
      }
      if (this.vm) {
        const [a, b] = this.vm;
        parts.push(`<span class="pi-v">V1 ${a.toFixed(3)} V · V2 ${b.toFixed(3)} V · <b>ΔV ${Math.abs(a - b).toFixed(3)} V</b></span>`);
      }
      el.innerHTML = parts.join('');
      el.hidden = !parts.length;
    },

    // ---------------------------------------------------------------- drawing
    visible() { const w = document.getElementById('plot-wrap'); return w && !w.hidden && w.offsetParent !== null; },
    requestDraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; if (this.visible()) { this.draw(); this.info(); } });
    },
    geom(cv) { const W = cv.clientWidth, H = cv.clientHeight; return { W, H, L: 50, R: 12, T: 22, B: 22, pw: W - 62, ph: H - 44 }; },
    draw() {
      const cv = document.getElementById('plot');
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const G = this.geom(cv), { W, H, L, T, pw, ph } = G;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(cv);
      const bg = css.getPropertyValue('--plot-bg').trim() || '#0f141a', grid = css.getPropertyValue('--plot-grid').trim() || '#253041', fg = css.getPropertyValue('--plot-fg').trim() || '#9aa6b5';
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const used = this.series.filter((s) => s.t.length);
      g.font = '11px system-ui, sans-serif';
      if (!used.length) {
        g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
        const msg = !this.app || !this.app.project.parts.some((p) => p.type === 'plotter')
          ? 'Add a Data plotter (Instruments) and connect its CH+ / CH− probes'
          : this.app.sim ? 'Recording… connect a channel\'s + probe to see its voltage' : 'Press Run to record the plotter\'s channels';
        g.fillText(msg, W / 2, H / 2);
        return;
      }
      const r = this.range();
      const X = (t) => L + ((t - r.x0) / (r.x1 - r.x0)) * pw, Y = (v) => T + (1 - (v - r.y0) / (r.y1 - r.y0)) * ph;
      this._map = { r, G };
      // grid + labels
      const span = r.x1 - r.x0;
      const tu = timeUnit(span);
      const tk = niceTicks(r.x0, r.x1, Math.max(2, Math.floor(pw / 80))), vk = niceTicks(r.y0, r.y1, Math.max(2, Math.floor(ph / 34)));
      g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = fg;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const t of tk.ticks) { const x = Math.round(X(t)) + 0.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.fillText(fmtNum(t * tu[1], tk.step * tu[1]), x, T + ph + 5); }
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const v of vk.ticks) { const y = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.fillText(fmtNum(v, vk.step), L - 5, y); }
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('V', 6, 4);
      g.fillText(tu[0], 6, T + ph + 5);
      // traces: only the visible part, at most ~2 points per pixel
      g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip();
      for (const s of used) {
        let i0 = lowerBound(s.t, r.x0) - 1, i1 = lowerBound(s.t, r.x1) + 1;
        i0 = Math.max(0, i0); i1 = Math.min(s.t.length - 1, i1);
        const step = Math.max(1, Math.floor((i1 - i0) / (pw * 2)));
        g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
        for (let i = i0; i <= i1; i += step) { const x = X(s.t[i]), y = Y(s.v[i]); if (i === i0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.lineTo(X(s.t[i1]), Y(s.v[i1]));
        g.stroke();
      }
      // end of the set simulation time
      if (this.limit) { g.strokeStyle = fg; g.setLineDash([3, 3]); const x = Math.round(X(this.limit)) - 0.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.setLineDash([]); }
      // markers
      const MK_T = '#ffd43b', MK_V = '#da77f2';
      g.font = 'bold 10px system-ui, sans-serif';
      if (this.vm) this.vm.forEach((v, i) => {
        const y = Math.round(Y(v)) + 0.5;
        g.strokeStyle = MK_V; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = MK_V; g.fillRect(L + pw - 22, y - 7, 22, 14); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('V' + (i + 1), L + pw - 11, y);
      });
      if (this.tm) {
        const [a, b] = this.tm.map(X);
        g.fillStyle = 'rgba(255,212,59,.07)'; g.fillRect(Math.min(a, b), T, Math.abs(b - a), ph);
        this.tm.forEach((t, i) => {
          const x = Math.round(X(t)) + 0.5;
          g.strokeStyle = MK_T; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.setLineDash([]);
          g.fillStyle = MK_T; g.fillRect(x - 11, T, 22, 14); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('T' + (i + 1), x, T + 7);
          for (const s of used) { const v = valueAt(s, t); if (v != null) { g.fillStyle = s.color; g.beginPath(); g.arc(x, Y(v), 3.2, 0, 7); g.fill(); } }
        });
      }
      g.restore();
      g.font = '11px system-ui, sans-serif';
      g.strokeStyle = fg; g.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
      // hover crosshair + legend (values at the pointer, else the latest values)
      let ht = null;
      if (this.hover != null && !this.drag && this.hover >= L && this.hover <= L + pw) {
        ht = r.x0 + ((this.hover - L) / pw) * span;
        g.strokeStyle = fg; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(Math.round(this.hover) + 0.5, T); g.lineTo(Math.round(this.hover) + 0.5, T + ph); g.stroke(); g.globalAlpha = 1;
      }
      g.textBaseline = 'middle'; g.textAlign = 'left';
      let lx = L;
      const head = ht != null ? `t = ${fmtTime(ht, span)}` : '';
      if (head) { g.fillStyle = fg; g.fillText(head, lx, 11); lx += g.measureText(head).width + 12; }
      for (const s of used) {
        const v = ht != null ? valueAt(s, ht) : s.v[s.v.length - 1];
        if (ht != null && v != null) { g.fillStyle = s.color; g.beginPath(); g.arc(X(ht), Y(v), 3, 0, 7); g.fill(); }
        const txt = `${s.label}: ${v == null ? '—' : v.toFixed(3) + ' V'}`;
        g.fillStyle = s.color; g.fillRect(lx, 7, 10, 3);
        g.fillStyle = fg; g.fillText(txt, lx + 14, 11);
        lx += g.measureText(txt).width + 26;
      }
      if (!this.view.auto) { g.fillStyle = fg; g.textAlign = 'right'; g.fillText('zoomed · double-click = auto scale', W - 6, T + ph + 11); }
    },

    // ---------------------------------------------------------------- UI
    bind(app) {
      this.app = app;
      document.querySelectorAll('.io-tab').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.io)));
      document.querySelectorAll('[data-plot]').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.plot;
        if (a === 'tm') this.toggleTimeMarkers();
        else if (a === 'vm') this.toggleValueMarkers();
        else if (a === 'auto') this.setAuto();
        else if (a === 'zin') this.zoom(0.5, 'x');
        else if (a === 'zout') this.zoom(2, 'x');
        else if (a === 'vin') this.zoom(0.5, 'y');
        else if (a === 'vout') this.zoom(2, 'y');
      }));
      const cv = document.getElementById('plot');
      const pos = (e) => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
      const toData = (p) => { const m = this._map; if (!m) return null; const { r, G } = m; return { t: r.x0 + ((p.x - G.L) / G.pw) * (r.x1 - r.x0), v: r.y0 + (1 - (p.y - G.T) / G.ph) * (r.y1 - r.y0) }; };
      const toPx = (t, v) => { const { r, G } = this._map; return { x: G.L + ((t - r.x0) / (r.x1 - r.x0)) * G.pw, y: G.T + (1 - (v - r.y0) / (r.y1 - r.y0)) * G.ph }; };
      // what is under the pointer: a marker (to drag) or the graph (to pan)
      const grab = (p) => {
        if (!this._map) return null;
        if (this.tm) for (let i = 0; i < 2; i++) if (Math.abs(toPx(this.tm[i], 0).x - p.x) < 7) return { kind: 'tm', i };
        if (this.vm) for (let i = 0; i < 2; i++) if (Math.abs(toPx(0, this.vm[i]).y - p.y) < 7) return { kind: 'vm', i };
        return { kind: 'pan' };
      };
      cv.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this._map) return;
        const p = pos(e), d = grab(p);
        if (!d) return;
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* keep dragging without capture */ }
        this.drag = Object.assign(d, { start: p, r: Object.assign({}, this.range()) });
        e.preventDefault();
      });
      cv.addEventListener('pointermove', (e) => {
        const p = pos(e);
        this.hover = p.x;
        const d = this.drag;
        if (d) {
          const q = toData(p);
          if (d.kind === 'tm') this.tm[d.i] = q.t;
          else if (d.kind === 'vm') this.vm[d.i] = q.v;
          else if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 3) {
            const { G } = this._map, r = d.r;
            const dx = ((p.x - d.start.x) / G.pw) * (r.x1 - r.x0), dy = ((p.y - d.start.y) / G.ph) * (r.y1 - r.y0);
            this.view = { auto: false, x0: r.x0 - dx, x1: r.x1 - dx, y0: r.y0 + dy, y1: r.y1 + dy };
            this.syncButtons();
          }
        } else {
          const g = grab(p);
          cv.style.cursor = g && g.kind === 'tm' ? 'ew-resize' : g && g.kind === 'vm' ? 'ns-resize' : this.view.auto ? 'crosshair' : 'grab';
        }
        this.requestDraw();
      });
      const end = () => { this.drag = null; this.requestDraw(); };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointerleave', () => { this.hover = null; this.requestDraw(); });
      cv.addEventListener('dblclick', () => this.setAuto());
      // wheel: zoom time around the pointer; Shift+wheel (or Ctrl+wheel): zoom volts
      cv.addEventListener('wheel', (e) => {
        if (!this._map) return;
        e.preventDefault();
        const q = toData(pos(e)), f = e.deltaY > 0 ? 1.25 : 0.8;
        this.zoom(f, e.shiftKey || e.ctrlKey ? 'y' : 'x', q.t, q.v);
      }, { passive: false });
      new ResizeObserver(() => this.requestDraw()).observe(cv);
      this.syncButtons();
    },
    showTab(which) {
      document.querySelectorAll('.io-tab').forEach((b) => b.classList.toggle('on', b.dataset.io === which));
      document.body.classList.toggle('io-plot', which === 'plot');
      document.getElementById('plot-wrap').hidden = which !== 'plot';
      try { localStorage.setItem('wirebench.ioTab', which); } catch (e) { /* storage unavailable */ }
      this.requestDraw();
    },
  });

  WB.fmtSimTime = (s) => (s < 1 ? +(s * 1000).toPrecision(4) + ' ms' : +s.toPrecision(4) + ' s');
  // first index with a[i] >= x
  function lowerBound(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
  // axis unit for a time span: [label, factor]
  function timeUnit(span) { return span < 2e-3 ? ['µs', 1e6] : span < 2 ? ['ms', 1e3] : ['s', 1]; }
  function fmtTime(t, span) { const [u, k] = timeUnit(span); const d = Math.max(0, Math.min(6, 3 - Math.floor(Math.log10(span * k || 1)))); return (t * k).toFixed(d) + ' ' + u; }
  function fmtFreq(f) { return f >= 1e6 ? (f / 1e6).toPrecision(4) + ' MHz' : f >= 1e3 ? (f / 1e3).toPrecision(4) + ' kHz' : f.toPrecision(4) + ' Hz'; }
  // value of a series at time t (linear between samples), null outside the recording
  function valueAt(s, t) {
    const a = s.t;
    if (!a.length || t < a[0] || t > a[a.length - 1]) return null;
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m; else hi = m; }
    if (a[hi] === a[lo]) return s.v[lo];
    return s.v[lo] + ((s.v[hi] - s.v[lo]) * (t - a[lo])) / (a[hi] - a[lo]);
  }
  // "nice" axis ticks (1, 2, 5 × 10^n)
  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) || 10 * mag;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { ticks, step };
  }
  function fmtNum(v, step) {
    const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step || 1) + 1e-9)));
    return v.toFixed(d);
  }
})(window.WB);

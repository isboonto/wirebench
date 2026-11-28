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

    // ---------------------------------------------------------------- drawing
    visible() { const w = document.getElementById('plot-wrap'); return w && !w.hidden && w.offsetParent !== null; },
    requestDraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; if (this.visible()) this.draw(); });
    },
    draw() {
      const cv = document.getElementById('plot');
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(cv);
      const bg = css.getPropertyValue('--plot-bg').trim() || '#0f141a', grid = css.getPropertyValue('--plot-grid').trim() || '#253041', fg = css.getPropertyValue('--plot-fg').trim() || '#9aa6b5';
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const used = this.series.filter((s) => s.t.length);
      const L = 46, R = 10, T = 22, B = 22, pw = W - L - R, ph = H - T - B;
      g.font = '11px system-ui, sans-serif';
      if (!used.length) {
        g.fillStyle = fg; g.textAlign = 'center';
        const msg = !this.app || !this.app.project.parts.some((p) => p.type === 'plotter')
          ? 'Add a Data plotter (Instruments) and connect its CH+ / CH− probes'
          : this.app.sim ? 'Recording… connect a channel\'s + probe to see its voltage' : 'Press Run to record the plotter\'s channels';
        g.fillText(msg, W / 2, H / 2);
        return;
      }
      // ranges
      const xMax = Math.max(this.limit || 0, this.tEnd, 1e-3);
      let lo = Infinity, hi = -Infinity;
      for (const s of used) for (const v of s.v) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo < 1e-3) { lo -= 0.5; hi += 0.5; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0; // include 0 V when it's close
      const X = (t) => L + (t / xMax) * pw, Y = (v) => T + (1 - (v - lo) / (hi - lo)) * ph;
      // grid + labels
      const tk = niceTicks(0, xMax, Math.max(2, Math.floor(pw / 80))), vk = niceTicks(lo, hi, Math.max(2, Math.floor(ph / 34)));
      const tUnit = xMax < 0.5 ? ['ms', 1000] : ['s', 1];
      g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = fg;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const t of tk.ticks) { const x = Math.round(X(t)) + 0.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.fillText(fmtNum(t * tUnit[1], tk.step * tUnit[1]), x, T + ph + 5); }
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const v of vk.ticks) { const y = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.fillText(fmtNum(v, vk.step), L - 5, y); }
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('V', 6, 4);
      g.fillText(tUnit[0], 6, T + ph + 5);
      // traces (at most ~2 points per pixel)
      g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip();
      for (const s of used) {
        g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
        const step = Math.max(1, Math.floor(s.t.length / (pw * 2)));
        for (let i = 0; i < s.t.length; i += step) { const x = X(s.t[i]), y = Y(s.v[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
        const n = s.t.length - 1; g.lineTo(X(s.t[n]), Y(s.v[n]));
        g.stroke();
      }
      // simulation-time end marker
      if (this.limit) { g.strokeStyle = fg; g.setLineDash([3, 3]); const x = Math.round(X(this.limit)) - 0.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.setLineDash([]); }
      g.restore();
      g.strokeStyle = fg; g.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
      // legend (latest value) or hover readout
      let ht = null;
      if (this.hover != null && this.hover >= L && this.hover <= L + pw) {
        ht = ((this.hover - L) / pw) * xMax;
        g.strokeStyle = fg; g.beginPath(); g.moveTo(Math.round(this.hover) + 0.5, T); g.lineTo(Math.round(this.hover) + 0.5, T + ph); g.stroke();
      }
      g.textBaseline = 'middle'; g.textAlign = 'left';
      let lx = L;
      const head = ht != null ? `t = ${fmtNum(ht * tUnit[1], tk.step * tUnit[1] / 10)} ${tUnit[0]}` : '';
      if (head) { g.fillStyle = fg; g.fillText(head, lx, 11); lx += g.measureText(head).width + 12; }
      for (const s of used) {
        const v = ht != null ? valueAt(s, ht) : s.v[s.v.length - 1];
        if (ht != null && v != null) { g.fillStyle = s.color; g.beginPath(); g.arc(X(ht), Y(v), 3, 0, 7); g.fill(); }
        const txt = `${s.label}: ${v == null ? '—' : v.toFixed(3) + ' V'}`;
        g.fillStyle = s.color; g.fillRect(lx, 7, 10, 3);
        g.fillStyle = fg; g.fillText(txt, lx + 14, 11);
        lx += g.measureText(txt).width + 26;
      }
    },

    // ---------------------------------------------------------------- UI
    bind(app) {
      this.app = app;
      const tabs = document.querySelectorAll('.io-tab');
      tabs.forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.io)));
      const cv = document.getElementById('plot');
      cv.addEventListener('pointermove', (e) => { this.hover = e.clientX - cv.getBoundingClientRect().left; this.requestDraw(); });
      cv.addEventListener('pointerleave', () => { this.hover = null; this.requestDraw(); });
      new ResizeObserver(() => this.requestDraw()).observe(cv);
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

'use strict';
window.WB = window.WB || {};
(function (WB) {
  WB.GRID = 10;
  let seq = 0;
  WB.uid = (p) => (p || 'id') + '_' + (Date.now() % 1e6).toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

  // Rotate a point clockwise (screen coords) by 0/90/180/270 degrees around the origin.
  WB.rotPt = function (x, y, rot) {
    const r = (((rot || 0) % 360) + 360) % 360;
    if (r === 90) return [-y, x];
    if (r === 180) return [-x, -y];
    if (r === 270) return [y, -x];
    return [x, y];
  };

  WB.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  WB.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  WB.snap = (v) => Math.round(v / WB.GRID) * WB.GRID;
  WB.clone = (o) => JSON.parse(JSON.stringify(o));
  WB.countNL = (s) => { let n = 0; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++; return n; };

  WB.fmtOhms = function (r) {
    r = Number(r);
    if (r >= 1e6) return +(r / 1e6).toPrecision(3) + ' MΩ';
    if (r >= 1e3) return +(r / 1e3).toPrecision(3) + ' kΩ';
    return +r.toPrecision(3) + ' Ω';
  };
  WB.fmtV = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2)) + ' V';
  WB.fmtI = (i) => { const a = Math.abs(i); return a >= 1 ? i.toFixed(2) + ' A' : a >= 1e-3 ? (i * 1e3).toFixed(1) + ' mA' : (i * 1e6).toFixed(0) + ' µA'; };

  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  WB.mix = function (a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    t = WB.clamp(t, 0, 1);
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  };

  WB.svgEl = function (tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };

  WB.download = function (filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
})(window.WB);

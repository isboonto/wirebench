'use strict';
// Jumper-wire auto-router: finds a tidy right-angle path between two pins on the
// 10 px grid using A* over (cell, direction). Costs favour short paths with few
// bends, steer around part bodies (boards, components, modules — not breadboards),
// and avoid running on top of other wires.
(function (WB) {
  const G = 10;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N
  const COST = { step: 1, bend: 6, part: 14, overlap: 8, cross: 1.5 };
  const MARGIN = 160; // search area around the two pins (px)

  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(n) {
      const a = this.a; a.push(n);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l].f < a[m].f) m = l;
          if (r < a.length && a[r].f < a[m].f) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    }
  }

  // Obstacles: bounding boxes of part bodies (breadboards and notes are fine to run over).
  function obstacles(app) {
    return app.project.parts.filter((p) => WB.PARTS[p.type] && !WB.PARTS[p.type].holes && !WB.PARTS[p.type].annotation).map((p) => {
      const b = WB.worldBBox(p);
      return { x0: b.x - 2, y0: b.y - 2, x1: b.x + b.w + 2, y1: b.y + b.h + 2 };
    });
  }

  // Occupancy of other wires: per grid cell, bit 1 = horizontal run, bit 2 = vertical run.
  function occupancy(app, editor, skipIds) {
    const occ = new Map();
    const mark = (x, y, bit) => { const k = x + ',' + y; occ.set(k, (occ.get(k) || 0) | bit); };
    for (const w of app.project.wires) {
      if (skipIds && skipIds.has(w.id)) continue;
      const pts = editor.wirePoints(w);
      if (!pts) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i].map((v) => Math.round(v / G)), [x1, y1] = pts[i + 1].map((v) => Math.round(v / G));
        if (y0 === y1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) mark(x, y0, 1);
        else if (x0 === x1) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) mark(x0, y, 2);
      }
    }
    return occ;
  }

  function route(A, B, obs, occ) {
    const ax = Math.round(A[0] / G), ay = Math.round(A[1] / G), bx = Math.round(B[0] / G), by = Math.round(B[1] / G);
    if (ax === bx && ay === by) return [];
    const m = MARGIN / G;
    const minX = Math.min(ax, bx) - m, maxX = Math.max(ax, bx) + m, minY = Math.min(ay, by) - m, maxY = Math.max(ay, by) + m;
    const W = maxX - minX + 1, H = maxY - minY + 1;
    // per-cell penalty for being inside a part body
    const inPart = new Uint8Array(W * H);
    for (const o of obs) {
      const cx0 = Math.max(minX, Math.ceil(o.x0 / G)), cx1 = Math.min(maxX, Math.floor(o.x1 / G));
      const cy0 = Math.max(minY, Math.ceil(o.y0 / G)), cy1 = Math.min(maxY, Math.floor(o.y1 / G));
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) inPart[(y - minY) * W + (x - minX)] = 1;
    }
    const idx = (x, y, d) => (((y - minY) * W + (x - minX)) << 2) | d;
    const best = new Float32Array(W * H * 4).fill(Infinity);
    const prev = new Int32Array(W * H * 4).fill(-1);
    const h = (x, y) => Math.abs(x - bx) + Math.abs(y - by);
    const heap = new Heap();
    for (let d = 0; d < 4; d++) { const i = idx(ax, ay, d); best[i] = 0; heap.push({ x: ax, y: ay, d, g: 0, f: h(ax, ay), i }); }
    let goal = -1, expanded = 0;
    while (heap.size) {
      const n = heap.pop();
      if (n.g > best[n.i]) continue;
      if (n.x === bx && n.y === by) { goal = n.i; break; }
      if (++expanded > 400000) break;
      for (let d = 0; d < 4; d++) {
        if (d === ((n.d + 2) & 3)) continue; // no U-turns
        const x = n.x + DIRS[d][0], y = n.y + DIRS[d][1];
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        let c = COST.step;
        if (d !== n.d && !(n.x === ax && n.y === ay)) c += COST.bend;
        const atEnd = (x === bx && y === by);
        if (inPart[(y - minY) * W + (x - minX)] && !atEnd) c += COST.part;
        const o = occ.get(x + ',' + y);
        if (o && !atEnd) {
          const horiz = d === 0 || d === 2;
          c += ((horiz && (o & 1)) || (!horiz && (o & 2))) ? COST.overlap : COST.cross;
        }
        const g = n.g + c, i = idx(x, y, d);
        if (g < best[i]) { best[i] = g; prev[i] = n.i; heap.push({ x, y, d, g, f: g + h(x, y), i }); }
      }
    }
    if (goal < 0) return null;
    // Walk back and keep only the corners
    const cells = [];
    for (let i = goal; i >= 0; i = prev[i]) {
      const c = i >> 2;
      cells.push([(c % W) + minX, Math.floor(c / W) + minY]);
    }
    cells.reverse();
    const pts = [];
    for (let i = 1; i < cells.length - 1; i++) {
      const [px, py] = cells[i - 1], [x, y] = cells[i], [nx, ny] = cells[i + 1];
      if ((x - px) !== (nx - x) || (y - py) !== (ny - y)) pts.push([x * G, y * G]);
    }
    return pts;
  }

  // Route one wire; returns true if a path was found (wire.pts is replaced, wire.auto = true).
  function routeWire(app, wire, ctx) {
    const ed = app.editor;
    const A = ed.pinPos(wire.a), B = ed.pinPos(wire.b);
    if (!A || !B) return false;
    ctx = ctx || { obs: obstacles(app), occ: occupancy(app, ed, new Set([wire.id])) };
    const pts = route(A, B, ctx.obs, ctx.occ);
    if (!pts) return false;
    wire.pts = pts;
    wire.auto = true;
    return true;
  }

  // Route several wires one after another so each avoids the ones before it.
  function routeMany(app, wires) {
    const ed = app.editor;
    const ids = new Set(wires.map((w) => w.id));
    const obs = obstacles(app);
    const occ = occupancy(app, ed, ids);
    // shorter wires first: they have fewer good options
    const order = wires.slice().sort((a, b) => {
      const la = dist(ed.pinPos(a.a), ed.pinPos(a.b)), lb = dist(ed.pinPos(b.a), ed.pinPos(b.b));
      return la - lb;
    });
    let n = 0;
    for (const w of order) {
      if (routeWire(app, w, { obs, occ })) {
        n++;
        const pts = ed.wirePoints(w);
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i].map((v) => Math.round(v / G)), [x1, y1] = pts[i + 1].map((v) => Math.round(v / G));
          if (y0 === y1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) occ.set(x + ',' + y0, (occ.get(x + ',' + y0) || 0) | 1);
          else if (x0 === x1) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) occ.set(x0 + ',' + y, (occ.get(x0 + ',' + y) || 0) | 2);
        }
      }
    }
    return n;
  }
  const dist = (a, b) => (a && b ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) : 0);

  // Does the wire have a slanted (non right-angle) piece? E.g. after one of its pins moved.
  function slanted(app, w) {
    const pts = app.editor.wirePoints(w);
    if (!pts) return false;
    for (let i = 0; i < pts.length - 1; i++) if (Math.abs(pts[i][0] - pts[i + 1][0]) > 0.5 && Math.abs(pts[i][1] - pts[i + 1][1]) > 0.5) return true;
    return false;
  }

  // After parts or wire ends moved: auto-routed wires, and straight pin-to-pin wires that became
  // slanted, get a new route; wires shaped by hand keep their joints and only get right-angle
  // corners where they became slanted. With "Auto-route new wires" off, only auto-routed wires move.
  function retidy(app, wires) {
    const on = app.autoRoute;
    const route = wires.filter((w) => w.auto || (on && !(w.pts && w.pts.length) && slanted(app, w)));
    if (route.length) routeMany(app, route);
    if (!on) return;
    for (const w of wires) {
      if (route.includes(w) || !slanted(app, w)) continue;
      const A = app.editor.pinPos(w.a), B = app.editor.pinPos(w.b);
      if (A && B) w.pts = WB.orthoPath(A, w.pts || [], B);
    }
  }

  WB.Router = { routeWire, routeMany, slanted, retidy };
})(window.WB);

'use strict';
(function (WB) {
  const PARTS = WB.PARTS;
  const WIRE_COLORS = ['#2f7de1', '#f2c200', '#22a34a', '#f07a1a', '#9b51e0', '#e8e8e8', '#00b3b3', '#d6336c'];
  WB.WIRE_COLORS = ['#d62828', '#1f1f1f'].concat(WIRE_COLORS);

  class Editor {
    constructor(app) {
      this.app = app;
      this.svg = document.getElementById('canvas');
      this.vp = document.getElementById('viewport');
      this.gridPat = document.getElementById('gridPattern');
      this.layerParts = document.getElementById('layer-parts');
      this.layerWires = document.getElementById('layer-wires');
      this.layerOver = document.getElementById('layer-over');
      this.tip = document.getElementById('tooltip');
      this.view = { x: 60, y: 60, s: 1.4 };
      this.partEls = new Map();
      this.pinEls = new Map();
      this.visKeys = new Map();
      this.mode = null;
      this.drawing = null;
      this.space = false;
      this.hoverPin = null;
      this.hlEls = [];
      this.bind();
      this.applyView();
    }

    // ------------------------------------------------------------ view
    applyView() {
      const { x, y, s } = this.view;
      const t = `translate(${x},${y}) scale(${s})`;
      this.vp.setAttribute('transform', t);
      this.gridPat.setAttribute('patternTransform', t);
      const zl = document.getElementById('zoom-label');
      if (zl) zl.textContent = Math.round(s * 100) + '%';
    }
    setZoom(s) { const r = this.svg.getBoundingClientRect(); this.zoomAt(r.width / 2, r.height / 2, s / this.view.s); }

    // ------------------------------------------------------------ context menu
    showMenu(e, wireCtx) {
      const menu = document.getElementById('ctx-menu');
      const stage = document.getElementById('stage').getBoundingClientRect();
      const parts = [...this.app.selection].filter((id) => this.app.part(id));
      const locked = this.app.locked();
      this.menuWire = wireCtx || null;
      menu.classList.toggle('wire', !!wireCtx);
      menu.querySelector('[data-ctx="tidyAll"]').disabled = locked || !this.app.project.wires.length;
      menu.querySelector('#ctx-autoroute').innerHTML = WB.icon(this.app.autoRoute ? 'checkOn' : 'checkOff') + '<span>Auto-route new wires</span>';
      if (wireCtx) {
        const wire = this.app.wire(wireCtx.id);
        menu.querySelector('[data-ctx="autoRoute"]').disabled = locked;
        menu.querySelector('[data-ctx="addJoint"]').disabled = locked;
        menu.querySelector('[data-ctx="removeJoint"]').disabled = locked || wireCtx.bend < 0;
        menu.querySelector('[data-ctx="removeJoint"]').style.display = wireCtx.bend < 0 ? 'none' : '';
        menu.querySelector('[data-ctx="straighten"]').disabled = locked || !(wire.pts && wire.pts.length);
        menu.querySelector('.ctx-colors').innerHTML = WB.WIRE_COLORS.map((c) => `<button class="sw${c === wire.color ? ' on' : ''}" data-ctx="color" data-color="${c}" style="background:${c}" title="${c}"${locked ? ' disabled' : ''}></button>`).join('');
      }
      menu.querySelector('[data-ctx="copy"]').disabled = !parts.length;
      for (const k of ['cut', 'duplicate', 'rotate', 'rotateBack']) menu.querySelector(`[data-ctx="${k}"]`).disabled = !parts.length || locked;
      menu.querySelector('[data-ctx="delete"]').disabled = !this.app.selection.size || locked;
      menu.querySelector('[data-ctx="paste"]').disabled = !(this.app.clipboard && this.app.clipboard.parts.length) || locked;
      menu.classList.add('open');
      const x = Math.min(e.clientX - stage.left, stage.width - menu.offsetWidth - 8);
      const y = Math.min(e.clientY - stage.top, stage.height - menu.offsetHeight - 8);
      menu.style.left = Math.max(4, x) + 'px';
      menu.style.top = Math.max(4, y) + 'px';
    }
    hideMenu() { document.getElementById('ctx-menu').classList.remove('open'); }
    toWorld(e) {
      const r = this.svg.getBoundingClientRect();
      return { x: (e.clientX - r.left - this.view.x) / this.view.s, y: (e.clientY - r.top - this.view.y) / this.view.s };
    }
    zoomAt(cx, cy, f) {
      const s = WB.clamp(this.view.s * f, 0.15, 6);
      const k = s / this.view.s;
      this.view.x = cx - (cx - this.view.x) * k;
      this.view.y = cy - (cy - this.view.y) * k;
      this.view.s = s;
      this.applyView();
    }
    zoom(f) { const r = this.svg.getBoundingClientRect(); this.zoomAt(r.width / 2, r.height / 2, f); }
    contentBBox() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (x, y, w, h) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
      for (const p of this.app.project.parts) { if (!PARTS[p.type]) continue; const b = WB.worldBBox(p); add(b.x, b.y, b.w, b.h); }
      for (const w of this.app.project.wires) { const pts = this.wirePoints(w); if (pts) for (const [x, y] of pts) add(x, y, 0, 0); }
      if (x0 === Infinity) return { x: 0, y: 0, w: 400, h: 300 };
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    fit() {
      const b = this.contentBBox();
      const r = this.svg.getBoundingClientRect();
      if (!r.width) return;
      const pad = 40;
      const s = WB.clamp(Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h), 0.2, 2.5);
      this.view.s = s;
      this.view.x = (r.width - b.w * s) / 2 - b.x * s;
      this.view.y = (r.height - b.h * s) / 2 - b.y * s;
      this.applyView();
    }

    // ------------------------------------------------------------ rendering
    visFor(p) {
      const v = Object.assign({}, this.app.transient[p.id] || {});
      const app = this.app;
      if (app.sim && app.results && app.results.vis[p.id]) Object.assign(v, app.results.vis[p.id]);
      if (app.sim && PARTS[p.type].board && app.sim.matrix) v.matrix = Array.from(app.sim.matrix);
      return v;
    }
    render() {
      this.layerParts.textContent = '';
      this.partEls.clear();
      this.pinEls.clear();
      this.visKeys.clear();
      this.hlEls = [];
      this.hoverPin = null;
      const parts = this.app.project.parts.filter((p) => PARTS[p.type]);
      const rank = (p) => { const d = PARTS[p.type]; return d.layer !== undefined ? d.layer : 2; };
      parts.sort((a, b) => rank(a) - rank(b));
      for (const p of parts) this.layerParts.appendChild(this.buildPart(p));
      this.renderWires();
      this.refreshHoles();
      this.refreshSelection();
    }
    buildPart(p) {
      const def = PARTS[p.type];
      const g = WB.svgEl('g', { class: 'part', 'data-id': p.id, transform: `translate(${p.x},${p.y}) rotate(${p.rot || 0})` });
      const body = WB.svgEl('g', { class: 'body' });
      const vis = this.visFor(p);
      body.innerHTML = def.render(p, vis);
      this.visKeys.set(p.id, JSON.stringify(vis));
      g.appendChild(body);
      const [bx, by, bw, bh] = def.bbox(p.props || {});
      g.appendChild(WB.svgEl('rect', { class: 'sel', x: bx - 3, y: by - 3, width: bw + 6, height: bh + 6, rx: 3 }));
      const pinsG = WB.svgEl('g', { class: 'pins' });
      let html = '';
      for (const pin of def.pins(p.props || {})) {
        if (pin.hidden) continue; // on-board connections (e.g. the CYD's LED and light sensor) have no pad
        html += def.holes
          ? `<rect class="pin hole" data-pin="${pin.id}" x="${pin.x - 3}" y="${pin.y - 3}" width="6" height="6" rx="1" fill="#4a4b4f" stroke="transparent" stroke-width="2.6"/>`
          : `<circle class="pin" data-pin="${pin.id}" cx="${pin.x}" cy="${pin.y}" r="${def.board ? 4.2 : 3.6}" fill="transparent"/>`;
      }
      pinsG.innerHTML = html;
      g.appendChild(pinsG);
      for (const el of pinsG.children) this.pinEls.set(p.id + ':' + el.getAttribute('data-pin'), el);
      this.partEls.set(p.id, g);
      return g;
    }
    updatePartTransform(p) {
      const g = this.partEls.get(p.id);
      if (g) g.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${p.rot || 0})`);
    }
    rerenderBody(p) {
      const g = this.partEls.get(p.id);
      if (!g) return;
      const vis = this.visFor(p);
      g.querySelector('.body').innerHTML = PARTS[p.type].render(p, vis);
      this.visKeys.set(p.id, JSON.stringify(vis));
      // parts whose size follows their settings (notes): keep the selection outline matching
      const sel = g.querySelector('.sel');
      if (sel) {
        const [bx, by, bw, bh] = PARTS[p.type].bbox(p.props || {});
        sel.setAttribute('x', bx - 3); sel.setAttribute('y', by - 3); sel.setAttribute('width', bw + 6); sel.setAttribute('height', bh + 6);
      }
    }
    applyVisuals() {
      for (const p of this.app.project.parts) {
        const def = PARTS[p.type];
        if (!def || !def.dynamic) continue;
        const vis = this.visFor(p);
        const key = JSON.stringify(vis);
        if (this.visKeys.get(p.id) === key) continue;
        this.visKeys.set(p.id, key);
        const g = this.partEls.get(p.id);
        if (g) g.querySelector('.body').innerHTML = def.render(p, vis);
      }
      // instruments that redraw every frame (oscilloscope traces)
      if (this.app.sim) for (const p of this.app.project.parts) {
        const def = PARTS[p.type];
        if (def && def.liveUpdate) { const g = this.partEls.get(p.id); if (g) def.liveUpdate(p, g, this.app); }
      }
    }
    refreshHoles() {
      const topo = this.app.getTopo();
      for (const [k, el] of this.pinEls) if (el.classList.contains('hole')) el.classList.toggle('occ', topo.occupied.has(k));
    }
    refreshSelection() {
      const sel = this.app.selection;
      for (const [id, g] of this.partEls) g.classList.toggle('selected', sel.has(id));
    }
    pinPos(ref) {
      const part = this.app.part(ref.part);
      if (!part) return null;
      const p = WB.worldPin(part, ref.pin);
      return p ? [p.x, p.y] : null;
    }
    wirePoints(w) {
      const A = this.pinPos(w.a), B = this.pinPos(w.b);
      if (!A || !B) return null;
      return [A].concat(w.pts || [], [B]);
    }
    renderWires() {
      let html = '';
      const sel = this.app.selection;
      for (const w of this.app.project.wires) {
        const pts = this.wirePoints(w);
        if (!pts) continue;
        const d = 'M' + pts.map((p) => p[0] + ',' + p[1]).join(' L');
        const isSel = sel.has(w.id);
        const dark = WB.mix(w.color, '#000000', 0.45);
        const A = pts[0], B = pts[pts.length - 1];
        html += `<g class="wire${isSel ? ' selected' : ''}" data-id="${w.id}">
          <path class="w-hit" d="${d}" stroke="transparent" stroke-width="10" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
          <path class="w-glow" d="${d}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
          <path d="${d}" stroke="${dark}" stroke-width="4.4" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
          <path d="${d}" stroke="${w.color}" stroke-width="2.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${A[0]}" cy="${A[1]}" r="2.6" fill="${dark}"/><circle cx="${B[0]}" cy="${B[1]}" r="2.6" fill="${dark}"/>`;
        if (isSel) {
          (w.pts || []).forEach((p, i) => { html += `<circle class="handle bend" data-wire="${w.id}" data-idx="${i}" cx="${p[0]}" cy="${p[1]}" r="3.6"/>`; });
          html += `<rect class="handle end" data-wire="${w.id}" data-end="a" x="${A[0] - 3.5}" y="${A[1] - 3.5}" width="7" height="7"/>`;
          html += `<rect class="handle end" data-wire="${w.id}" data-end="b" x="${B[0] - 3.5}" y="${B[1] - 3.5}" width="7" height="7"/>`;
        }
        html += '</g>';
      }
      this.layerWires.innerHTML = html;
    }

    // ------------------------------------------------------------ events
    bind() {
      const svg = this.svg;
      svg.addEventListener('pointerdown', (e) => this.onDown(e));
      window.addEventListener('pointermove', (e) => this.onMove(e));
      window.addEventListener('pointerup', (e) => this.onUp(e));
      svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      // Pinch / Ctrl+wheel anywhere else must never zoom the whole window (the desktop
      // web view has zoom control enabled so that touchpad pinches reach the canvas).
      window.addEventListener('wheel', (e) => { if (e.ctrlKey && !svg.contains(e.target)) e.preventDefault(); }, { passive: false, capture: true });
      // Safari/macOS trackpad pinch
      let gs = 1;
      svg.addEventListener('gesturestart', (e) => { e.preventDefault(); gs = 1; });
      svg.addEventListener('gesturechange', (e) => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, e.scale / gs);
        gs = e.scale;
      });
      // Touch screens: two-finger pinch + pan
      this.touches = new Map();
      svg.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); }, true);
      svg.addEventListener('pointermove', (e) => this.onTouchMove(e), true);
      const endTouch = (e) => { this.touches.delete(e.pointerId); if (this.touches.size < 2) this.pinch = null; };
      window.addEventListener('pointerup', endTouch, true);
      window.addEventListener('pointercancel', endTouch, true);
      svg.addEventListener('dblclick', (e) => this.onDbl(e));
      svg.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.drawing) { this.cancelDraw(); return; }
        const ti = this.targetInfo(e.target);
        const el = ti.wire || ti.part;
        let wireCtx = null;
        if (el) {
          const id = el.getAttribute('data-id');
          if (ti.wire) {
            // a jumper: select just this wire; remember where it was clicked (and which joint, if any)
            this.app.select(id, false);
            const bend = ti.handle && ti.handle.classList.contains('bend') ? +ti.handle.getAttribute('data-idx') : -1;
            wireCtx = { id, world: this.toWorld(e), bend };
          } else if (!this.app.selection.has(id)) this.app.select(id, false);
        } else this.app.clearSelection();
        this.mouseWorld = this.toWorld(e);
        this.mouseInside = true;
        this.menuWorld = this.mouseWorld;
        this.showMenu(e, wireCtx);
      });
      document.getElementById('ctx-menu').addEventListener('click', (e) => {
        const b = e.target.closest('[data-ctx]');
        if (!b) return;
        this.hideMenu();
        const a = b.getAttribute('data-ctx');
        const mw = this.menuWire, wire = mw && this.app.wire(mw.id);
        if (wire && a === 'addJoint') { this.insertBend(wire, mw.world); return; }
        if (wire && a === 'removeJoint') { this.app.mutate(() => { wire.pts.splice(mw.bend, 1); wire.auto = false; }); return; }
        if (wire && a === 'straighten') { this.app.mutate(() => { wire.pts = []; wire.auto = false; }); return; }
        if (wire && a === 'autoRoute') { this.app.mutate(() => { if (!WB.Router.routeWire(this.app, wire)) this.app.toast('No route found.'); }); return; }
        if (a === 'tidyAll') { this.app.tidyAllWires(); return; }
        if (a === 'autoRouteToggle') { this.app.setAutoRoute(!this.app.autoRoute); return; }
        if (wire && a === 'color') { const c = b.getAttribute('data-color'); this.app.mutate(() => { wire.color = c; }); return; }
        if (a === 'copy') this.app.copySelection(false);
        else if (a === 'cut') this.app.copySelection(true);
        else if (a === 'paste') { this.mouseWorld = this.menuWorld; this.mouseInside = true; this.app.paste(); }
        else if (a === 'duplicate') this.app.duplicateSelection();
        else if (a === 'rotate') this.app.rotateSelection(90);
        else if (a === 'rotateBack') this.app.rotateSelection(-90);
        else if (a === 'delete') this.app.deleteSelection();
      });
      window.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctx-menu')) this.hideMenu(); }, true);
      svg.addEventListener('pointerover', (e) => this.onOver(e));
      svg.addEventListener('pointerleave', () => { this.setHover(null); this.mouseInside = false; });
      svg.addEventListener('pointermove', (e) => { this.mouseWorld = this.toWorld(e); this.mouseInside = true; });
      // Space: hold and drag to pan; a quick tap (no drag) fits the whole circuit in view.
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        e.preventDefault(); // also stops a focused toolbar button from being "clicked" by Space
        if (e.repeat || this.space) return;
        this.space = true; this.spacePanned = false;
        svg.classList.add('panning');
      });
      window.addEventListener('keyup', (e) => {
        if (e.code !== 'Space' || !this.space) return;
        this.space = false;
        svg.classList.remove('panning');
        if (!this.spacePanned && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) this.fit();
      });
      // palette drop
      const stage = document.getElementById('stage');
      stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      stage.addEventListener('drop', (e) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/x-wb-part') || e.dataTransfer.getData('text/plain');
        if (PARTS[type]) this.app.addPart(type, this.toWorld(e));
      });
    }

    // Nearest pin to a world point within a few screen pixels (makes wiring forgiving).
    nearestPin(w, px) {
      const max = (px || 12) / this.view.s;
      let best = null, bd = max;
      for (const part of this.app.project.parts) {
        if (!PARTS[part.type]) continue;
        const b = WB.worldBBox(part);
        if (w.x < b.x - max || w.y < b.y - max || w.x > b.x + b.w + max || w.y > b.y + b.h + max) continue;
        for (const p of WB.worldPins(part)) {
          if (p.hidden) continue;
          const d = Math.hypot(p.x - w.x, p.y - w.y);
          if (d < bd) { bd = d; best = { part: part.id, pin: p.id }; }
        }
      }
      return best;
    }
    pinRefAt(e, ti) {
      if (ti && ti.pin && ti.part) return { part: ti.part.getAttribute('data-id'), pin: ti.pin.getAttribute('data-pin') };
      return this.nearestPin(this.toWorld(e));
    }

    // Mouse wheel  -> zoom around the cursor.
    // Touchpad pinch (reported as wheel + ctrlKey) -> smooth zoom around the fingers.
    // Touchpad two-finger swipe (small / fractional / horizontal deltas) -> pan.
    onWheel(e) {
      e.preventDefault();
      this.hideMenu && this.hideMenu();
      const r = this.svg.getBoundingClientRect();
      const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      const dx = e.deltaX * px, dy = e.deltaY * px;
      if (e.ctrlKey || e.metaKey) {
        // Pinch gestures send small deltas; Ctrl+mouse-wheel sends large ones — clamp so both feel right.
        const f = Math.exp(-WB.clamp(dy * 0.01, -0.15, 0.15));
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, f);
        return;
      }
      // Touchpads send a rapid stream of small (often whole-number) steps with momentum;
      // a mouse wheel sends isolated large steps (typically ±100 or ±120 per notch).
      const now = performance.now();
      const inStream = now < (this.touchpadUntil || 0);
      const mouseNotch = e.deltaMode !== 0 || (dx === 0 && Number.isInteger(dy) && Math.abs(dy) >= 60 && (Math.abs(dy) % 100 === 0 || Math.abs(dy) % 120 === 0));
      const looksTouchpad = !mouseNotch || (inStream && now - (this.lastWheel || 0) < 60);
      this.lastWheel = now;
      if (looksTouchpad) this.touchpadUntil = now + 250;
      if (looksTouchpad) {
        this.view.x -= dx;
        this.view.y -= dy;
        this.applyView();
      } else {
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0015, -dy));
      }
    }
    onTouchMove(e) {
      if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size !== 2) return;
      const [a, b] = [...this.touches.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = this.svg.getBoundingClientRect();
      if (this.pinch) {
        this.view.x += cx - this.pinch.cx;
        this.view.y += cy - this.pinch.cy;
        this.zoomAt(cx - r.left, cy - r.top, d / this.pinch.d);
      } else {
        // second finger landed: cancel any drag/wire the first finger started
        this.mode = null;
        if (this.drawing) this.cancelDraw();
      }
      this.pinch = { cx, cy, d: Math.max(d, 1) };
      e.stopPropagation();
    }

    targetInfo(t) {
      return {
        handle: t.closest && t.closest('.handle'),
        pin: t.closest && t.closest('.pin'),
        wire: t.closest && t.closest('.wire'),
        part: t.closest && t.closest('.part'),
      };
    }

    onDown(e) {
      if (e.button === 2) return;
      document.activeElement && document.activeElement.blur && document.activeElement !== document.body && document.activeElement.blur();
      const w = this.toWorld(e);
      this.downClient = { x: e.clientX, y: e.clientY };
      if (e.button === 1 || this.space) { if (this.space) this.spacePanned = true; this.startPan(e); e.preventDefault(); return; }
      const ti = this.targetInfo(e.target);
      const app = this.app;
      if (this.drawing) {
        const ref = this.pinRefAt(e, ti);
        if (ref) this.finishWire(ref);
        else { this.drawing.pts.push([WB.snap(w.x), WB.snap(w.y)]); this.updateRubber(w); }
        e.preventDefault();
        return;
      }
      // Simulation running: the circuit is locked. Interactive parts can be operated,
      // anything can be selected (to read its values), and the view can be panned.
      if (app.sim) {
        if (ti.part) {
          const part = app.part(ti.part.getAttribute('data-id'));
          const def = PARTS[part.type];
          if (def.interact && this.interact(part, def, e) !== false) { e.preventDefault(); return; }
          if (!def.holes || !ti.pin) { app.select(part.id, false); e.preventDefault(); return; }
        } else if (ti.wire) { app.select(ti.wire.getAttribute('data-id'), false); e.preventDefault(); return; }
        if (ti.pin || ti.handle) app.lockedToast();
        else app.clearSelection();
        this.startPan(e);
        return;
      }
      if (ti.handle) {
        const wid = ti.handle.getAttribute('data-wire');
        const wire = app.wire(wid);
        if (!wire) return;
        this.snapshot = app.snapshot();
        if (ti.handle.classList.contains('bend')) this.mode = { kind: 'bend', wire, idx: +ti.handle.getAttribute('data-idx'), moved: false, base: wire.pts.map((p) => p.slice()) };
        else this.mode = { kind: 'end', wire, end: ti.handle.getAttribute('data-end'), moved: false };
        e.preventDefault();
        return;
      }
      if (ti.pin && ti.part) {
        const ref = { part: ti.part.getAttribute('data-id'), pin: ti.pin.getAttribute('data-pin') };
        this.drawing = { from: ref, pts: [], dragStart: { x: e.clientX, y: e.clientY }, dragging: true };
        this.updateRubber(w);
        e.preventDefault();
        return;
      }
      if (ti.wire) {
        app.select(ti.wire.getAttribute('data-id'), e.shiftKey);
        e.preventDefault();
        return;
      }
      if (ti.part) {
        const part = app.part(ti.part.getAttribute('data-id'));
        const def = PARTS[part.type];
        // instrument front-panel buttons (e.g. the scope's) work while editing too
        if (def.interact === 'panel' && !e.shiftKey && this.interact(part, def, e) !== false) { e.preventDefault(); return; }
        // Ctrl/Alt/Cmd + drag: drag out a copy, leaving the original in place
        if (e.ctrlKey || e.altKey || e.metaKey) {
          if (!app.selection.has(part.id)) app.select(part.id, false);
          if (app.duplicateSelection(0)) { this.startDrag(w, true); this.mode.dup = true; e.preventDefault(); return; }
        }
        if (e.shiftKey) app.select(part.id, true);
        else if (!app.selection.has(part.id)) app.select(part.id, false);
        this.startDrag(w);
        e.preventDefault();
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) { this.mode = { kind: 'box', start: w, rect: null }; e.preventDefault(); return; }
      app.clearSelection();
      this.startPan(e);
    }

    startPan(e) {
      this.mode = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
      this.svg.classList.add('panning');
    }

    startDrag(w, onlySelected) {
      const app = this.app;
      const ids = new Set([...app.selection].filter((id) => app.part(id)));
      if (!onlySelected) for (const id of [...ids]) {
        const bb = app.part(id);
        if (!PARTS[bb.type].holes) continue;
        const holes = new Set(WB.worldPins(bb).map((p) => Math.round(p.x) + ',' + Math.round(p.y)));
        for (const q of app.project.parts) {
          if (ids.has(q.id) || PARTS[q.type].holes) continue;
          if (WB.worldPins(q).some((p) => holes.has(Math.round(p.x) + ',' + Math.round(p.y)))) ids.add(q.id);
        }
      }
      const orig = new Map([...ids].map((id) => { const p = app.part(id); return [id, { x: p.x, y: p.y }]; }));
      const wires = app.project.wires.filter((wi) => ids.has(wi.a.part) && ids.has(wi.b.part)).map((wi) => ({ w: wi, pts: (wi.pts || []).map((p) => p.slice()) }));
      this.mode = { kind: 'drag', ids, start: w, orig, wires, snapshot: app.snapshot(), dx: 0, dy: 0, moved: false };
    }

    panelHit(part, def, e) {
      const w = this.toWorld(e);
      const [lx, ly] = WB.rotPt(w.x - part.x, w.y - part.y, -(part.rot || 0));
      return def.hit(lx, ly, part);
    }
    interact(part, def, e) {
      const app = this.app;
      if (def.interact === 'panel') {
        // front-panel button under the pointer (part coordinates); false = not on a button
        const act = this.panelHit(part, def, e);
        if (!act) return false;
        def.panelAction(part, act, app);
        this.rerenderBody(part);
        app.markDirty();
        app.refreshInspector();
        app.refreshPropDialog();
        app.saveLocalSoon();
        app.updateModified();
        return true;
      }
      if (def.interact === 'touch') {
        // touch screen board (CYD): press and drag on the screen; its BOOT button; its light sensor (drag)
        const w = this.toWorld(e);
        const [lx, ly] = WB.rotPt(w.x - part.x, w.y - part.y, -(part.rot || 0));
        const h = def.hit(lx, ly);
        if (!h) return false;
        if (h.k === 'screen') { app.transient[part.id] = { touch: [h.x, h.y] }; this.mode = { kind: 'touch', part, def }; }
        else if (h.k === 'boot') { app.transient[part.id] = { pressed: true }; this.mode = { kind: 'press', part }; }
        else {
          const k = def.knob;
          this.mode = { kind: 'knob', part, def, startY: e.clientY, startV: Number(part.props[k.key]) };
          this.showTip(e, `${part.name}: ${k.fmt(part.props[k.key])} — drag up/down`);
        }
        this.rerenderBody(part);
        app.markDirty();
        return;
      }
      if (def.interact === 'buttons') {
        // which of the module's buttons is under the pointer (in the part's own coordinates)
        const w = this.toWorld(e);
        const [lx, ly] = WB.rotPt(w.x - part.x, w.y - part.y, -(part.rot || 0));
        const i = def.hit(lx, ly);
        if (i < 0) return;
        const pressed = new Array(def.nButtons || 3).fill(false);
        pressed[i] = true;
        app.transient[part.id] = { pressed };
        this.rerenderBody(part);
        app.markDirty();
        this.mode = { kind: 'press', part };
        return;
      }
      if (def.interact === 'cycle') {
        // e.g. multimeter dial: step to the next mode
        const { key, options } = def.cycle;
        part.props[key] = options[(options.indexOf(part.props[key]) + 1) % options.length];
        this.rerenderBody(part);
        app.markDirty();
        app.refreshInspector();
        app.refreshPropDialog();
        app.saveLocal();
        app.updateModified();
        return;
      }
      if (def.interact === 'press') {
        app.transient[part.id] = { pressed: true };
        this.rerenderBody(part);
        app.markDirty();
        this.mode = { kind: 'press', part };
      } else if (def.interact === 'toggle') {
        const key = def.toggleKey || 'on';
        part.props[key] = !part.props[key];
        this.rerenderBody(part);
        app.markDirty();
        app.refreshInspector();
        app.saveLocal();
      } else if (def.interact === 'knob') {
        const k = def.knob;
        this.mode = { kind: 'knob', part, def, startY: e.clientY, startV: Number(part.props[k.key]) };
        this.showTip(e, `${part.name}: ${k.fmt(part.props[k.key])} — drag up/down`);
      }
    }

    onMove(e) {
      const m = this.mode;
      if (this.drawing) {
        this.updateRubber(this.toWorld(e));
      }
      if (!m) return;
      if (m.kind === 'pan') {
        this.view.x = m.vx + (e.clientX - m.sx);
        this.view.y = m.vy + (e.clientY - m.sy);
        this.applyView();
      } else if (m.kind === 'drag') {
        const w = this.toWorld(e);
        const dx = WB.snap(w.x - m.start.x), dy = WB.snap(w.y - m.start.y);
        if (dx === m.dx && dy === m.dy) return;
        m.dx = dx; m.dy = dy; m.moved = true;
        for (const id of m.ids) {
          const p = this.app.part(id), o = m.orig.get(id);
          p.x = o.x + dx; p.y = o.y + dy;
          this.updatePartTransform(p);
        }
        for (const it of m.wires) it.w.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
        this.renderWires();
      } else if (m.kind === 'bend') {
        const w = this.toWorld(e);
        const pts = m.base.map((p) => p.slice());
        pts[m.idx] = [WB.snap(w.x), WB.snap(w.y)];
        // keep the segments next to the dragged joint at right angles (auto-routing on)
        const A = this.pinPos(m.wire.a), B = this.pinPos(m.wire.b);
        m.wire.pts = this.app.autoRoute && A && B ? orthoPath(A, pts, B) : pts;
        m.moved = true;
        this.renderWires();
      } else if (m.kind === 'end') {
        const w = this.toWorld(e);
        m.moved = true;
        const pts = this.wirePoints(m.wire);
        if (m.end === 'a') pts[0] = [w.x, w.y]; else pts[pts.length - 1] = [w.x, w.y];
        this.layerOver.innerHTML = `<path d="M${pts.map((p) => p[0] + ',' + p[1]).join(' L')}" class="rubber" stroke="${m.wire.color}"/>`;
      } else if (m.kind === 'box') {
        const w = this.toWorld(e);
        const x = Math.min(w.x, m.start.x), y = Math.min(w.y, m.start.y);
        m.rect = { x, y, w: Math.abs(w.x - m.start.x), h: Math.abs(w.y - m.start.y) };
        this.layerOver.innerHTML = `<rect class="boxsel" x="${x}" y="${y}" width="${m.rect.w}" height="${m.rect.h}"/>`;
      } else if (m.kind === 'touch') {
        const w = this.toWorld(e);
        const [lx, ly] = WB.rotPt(w.x - m.part.x, w.y - m.part.y, -(m.part.rot || 0));
        const h = m.def.hit(lx, ly);
        if (h && h.k === 'screen') { this.app.transient[m.part.id] = { touch: [h.x, h.y] }; this.app.markDirty(); }
      } else if (m.kind === 'knob') {
        const k = m.def.knob;
        const span = k.max - k.min;
        if (Math.abs(m.startY - e.clientY) > 3) m.moved = true;
        const v = k.perPx
          ? WB.clamp(Math.round(m.startV + (m.startY - e.clientY) / k.perPx), k.min, k.max)
          : WB.clamp(m.startV + ((m.startY - e.clientY) / 160) * span, k.min, k.max);
        m.part.props[k.key] = k.step ? +(Math.round(v / k.step) * k.step).toFixed(3) : span <= 1 ? +v.toFixed(3) : Math.round(v);
        this.rerenderBody(m.part);
        this.app.markDirty();
        this.showTip(e, `${m.part.name}: ${k.fmt(m.part.props[k.key])}`);
      }
    }

    onUp(e) {
      const app = this.app;
      if (this.drawing && this.drawing.dragging) {
        this.drawing.dragging = false;
        const moved = Math.hypot(e.clientX - this.drawing.dragStart.x, e.clientY - this.drawing.dragStart.y) > 6;
        if (moved) {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const ref = this.pinRefAt(e, el ? this.targetInfo(el) : {});
          if (ref) this.finishWire(ref);
        }
        return;
      }
      const m = this.mode;
      if (!m) return;
      this.mode = null;
      this.svg.classList.remove('panning');
      if (m.kind === 'drag' && m.moved) {
        app.pushUndo(m.snapshot);
        // auto-routed wires with one end on a moved part are re-routed (wires moving with both ends were translated)
        const affected = app.project.wires.filter((w) => w.auto && (m.ids.has(w.a.part) !== m.ids.has(w.b.part)));
        if (affected.length) WB.Router.routeMany(app, affected);
        app.changed();
      }
      else if (m.kind === 'drag' && m.dup) { app.undo(); app.redoStack = []; } // Ctrl+click without moving: drop the copy
      else if (m.kind === 'bend' && m.moved) { m.wire.auto = false; app.pushUndo(this.snapshot); app.changed(); }
      else if (m.kind === 'end') {
        this.layerOver.innerHTML = '';
        if (!m.moved) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const ref = this.pinRefAt(e, el ? this.targetInfo(el) : {});
        if (ref) {
          const other = m.end === 'a' ? m.wire.b : m.wire.a;
          if (!(ref.part === other.part && ref.pin === other.pin)) {
            m.wire[m.end] = ref;
            app.pushUndo(this.snapshot);
            if (m.wire.auto) WB.Router.routeWire(app, m.wire);
            app.changed();
            return;
          }
        }
        this.renderWires();
      } else if (m.kind === 'box') {
        this.layerOver.innerHTML = '';
        if (!m.rect) return;
        const r = m.rect;
        const inside = (x, y) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
        for (const p of app.project.parts) {
          const b = WB.worldBBox(p);
          if (inside(b.x, b.y) && inside(b.x + b.w, b.y + b.h)) app.selection.add(p.id);
        }
        for (const w of app.project.wires) { const pts = this.wirePoints(w); if (pts && pts.every(([x, y]) => inside(x, y))) app.selection.add(w.id); }
        app.selectionChanged();
      } else if (m.kind === 'press' || m.kind === 'touch') {
        delete app.transient[m.part.id];
        this.rerenderBody(m.part);
        app.markDirty();
      } else if (m.kind === 'knob') {
        if (!m.moved && m.def.knob.pressOnClick) {
          // a click without turning presses the knob's push button briefly
          const part = m.part;
          app.transient[part.id] = { pressed: true };
          this.rerenderBody(part);
          app.markDirty();
          setTimeout(() => { delete app.transient[part.id]; this.rerenderBody(part); app.markDirty(); }, 300);
        }
        this.hideTip();
        app.refreshInspector();
        app.saveLocal();
      }
    }

    onDbl(e) {
      const ti = this.targetInfo(e.target);
      const app = this.app;
      // Double-click a part -> properties dialog (operating a button/knob during simulation doesn't open it)
      if (ti.part && !ti.wire && !ti.handle) {
        const part = app.part(ti.part.getAttribute('data-id'));
        const def = part && PARTS[part.type];
        const onControl = def && (def.interact === 'panel' ? !!this.panelHit(part, def, e) : app.sim && def.interact);
        if (part && !onControl) app.openPropDialog(part.id, e.clientX, e.clientY);
        return;
      }
      if (ti.handle && ti.handle.classList.contains('bend')) {
        const wire = app.wire(ti.handle.getAttribute('data-wire'));
        const idx = +ti.handle.getAttribute('data-idx');
        app.mutate(() => {
          wire.pts.splice(idx, 1); wire.auto = false;
          const A = this.pinPos(wire.a), B = this.pinPos(wire.b);
          if (app.autoRoute && A && B) wire.pts = orthoPath(A, wire.pts, B); // square up what's left
        });
        return;
      }
      if (ti.wire && !ti.handle) this.insertBend(app.wire(ti.wire.getAttribute('data-id')), this.toWorld(e));
    }

    // Add a joint (bend point) to a wire at world point w, on the segment closest to it.
    insertBend(wire, w) {
      const app = this.app;
      const pts = this.wirePoints(wire);
      if (!pts) return;
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = segDist(w, pts[i], pts[i + 1]);
        if (d < bd) { bd = d; best = i; }
      }
      app.mutate(() => { wire.pts.splice(best, 0, [WB.snap(w.x), WB.snap(w.y)]); wire.auto = false; app.selection = new Set([wire.id]); });
    }

    // ------------------------------------------------------------ wire drawing
    updateRubber(w) {
      const d = this.drawing;
      if (!d) return;
      const A = this.pinPos(d.from);
      if (!A) return;
      // with auto-routing on, show the right-angle path the wire will get once you click its joints
      const end = [w.x, w.y];
      const pts = this.app.autoRoute && d.pts.length ? [A].concat(orthoPath(A, d.pts, end), [end]) : [A].concat(d.pts, [end]);
      this.layerOver.innerHTML = `<path class="rubber" d="M${pts.map((p) => p[0] + ',' + p[1]).join(' L')}"/>`;
    }
    cancelDraw() {
      this.drawing = null;
      this.layerOver.innerHTML = '';
    }
    finishWire(to) {
      const d = this.drawing;
      this.drawing = null;
      this.layerOver.innerHTML = '';
      if (!d || (to.part === d.from.part && to.pin === d.from.pin)) return;
      const app = this.app;
      const pa = WB.worldPin(app.part(d.from.part), d.from.pin) || {};
      const pb = WB.worldPin(app.part(to.part), to.pin) || {};
      let color;
      if (pa.kind === 'gnd' || pb.kind === 'gnd') color = '#1f1f1f';
      else if (pa.kind === 'pwr' || pb.kind === 'pwr') color = '#d62828';
      else color = WIRE_COLORS[app.project.wires.length % WIRE_COLORS.length];
      const wire = { id: WB.uid('w'), a: d.from, b: to, pts: d.pts, color };
      // Pin-to-pin wires (no hand-placed joints) are auto-routed into a tidy right-angle path;
      // wires drawn through clicked joints keep them, joined by right-angle corners.
      if (app.autoRoute && !d.pts.length) WB.Router.routeWire(app, wire);
      else if (app.autoRoute) wire.pts = orthoPath([pa.x, pa.y], d.pts, [pb.x, pb.y]);
      app.mutate(() => { app.project.wires.push(wire); app.selection = new Set([wire.id]); });
    }

    // ------------------------------------------------------------ hover / tooltip
    onOver(e) {
      if (this.mode && this.mode.kind !== 'pan') return;
      const pin = e.target.closest ? e.target.closest('.pin') : null;
      this.setHover(pin, e);
    }
    setHover(pin, e) {
      if (pin === this.hoverPin) return;
      for (const el of this.hlEls) el.classList.remove('net-hl');
      this.hlEls = [];
      this.hoverPin = pin;
      if (!pin) { this.hideTip(); return; }
      const partEl = pin.closest('.part');
      if (!partEl) return;
      const pid = partEl.getAttribute('data-id');
      const key = pid + ':' + pin.getAttribute('data-pin');
      const topo = this.app.getTopo();
      const node = topo.nodeOf.get(key);
      if (node !== undefined) {
        for (const k of topo.nets[node]) { const el = this.pinEls.get(k); if (el) { el.classList.add('net-hl'); this.hlEls.push(el); } }
      }
      const part = this.app.part(pid);
      const pinDef = WB.worldPin(part, pin.getAttribute('data-pin'));
      let txt = `<b>${WB.esc(part.name || PARTS[part.type].label)}</b> · ${WB.esc((pinDef && pinDef.label) || pin.getAttribute('data-pin'))}`;
      if (this.app.sim && this.app.results && node !== undefined) {
        const v = node === 0 ? 0 : this.app.results.V[node];
        const fl = node !== 0 && this.app.results.floating.has(node);
        txt += `<br><span class="volt">${fl ? 'floating' : WB.fmtV(v || 0)}</span>`;
      }
      this.showTip(e, txt, true);
    }
    showTip(e, html, isHtml) {
      if (!e) return;
      const r = this.svg.getBoundingClientRect();
      this.tip[isHtml ? 'innerHTML' : 'textContent'] = html;
      this.tip.style.left = e.clientX - r.left + 14 + 'px';
      this.tip.style.top = e.clientY - r.top + 14 + 'px';
      this.tip.classList.add('show');
    }
    hideTip() { this.tip.classList.remove('show'); }

    // ------------------------------------------------------------ export
    exportSVGString() {
      const b = this.contentBBox();
      const pad = 20;
      const clone = this.vp.cloneNode(true);
      clone.removeAttribute('transform');
      clone.querySelectorAll('.sel, .handle, .w-hit, .w-glow, #layer-over').forEach((el) => el.remove());
      clone.querySelectorAll('.pin:not(.hole)').forEach((el) => el.remove());
      clone.querySelectorAll('.hole.occ').forEach((el) => el.setAttribute('fill', '#2f9e5a'));
      const defs = document.getElementById('wbDefs').outerHTML;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}" width="${b.w + pad * 2}" height="${b.h + pad * 2}">${defs}<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + pad * 2}" height="${b.h + pad * 2}" fill="#ffffff"/>${clone.innerHTML}</svg>`;
    }
  }

  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    let t = l ? ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l : 0;
    t = WB.clamp(t, 0, 1);
    return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
  }

  // Right-angle version of a hand-drawn wire: start pin A, the joints the user clicked, end
  // pin B. Wherever two consecutive points are diagonal to each other a corner is added. Of
  // the two ways round (across first or up/down first) it takes the one that never doubles
  // back over the previous segment and, looking one point ahead, needs the fewest bends —
  // so every clicked joint is visited. Duplicate and in-line points are dropped. Returns just
  // the joints (without A and B), ready for wire.pts.
  const near = (a, b) => Math.abs(a - b) < 0.5;
  const sgn = (v) => (near(v, 0) ? 0 : Math.sign(v));
  // cost of heading off in direction d after arriving in direction prev: 0 straight on, 1 a bend, 10 a U-turn
  const turnCost = (prev, d) => (!prev ? 0 : prev[0] === d[0] && prev[1] === d[1] ? 0 : prev[0] === -d[0] && prev[1] === -d[1] ? 10 : 1);
  // cheapest way to leave Q towards N after arriving in direction d
  function leaveCost(d, Q, N) {
    if (!N) return 0;
    const ex = sgn(N[0] - Q[0]), ey = sgn(N[1] - Q[1]);
    const starts = [];
    if (ex) starts.push([ex, 0]);
    if (ey) starts.push([0, ey]);
    return starts.length ? Math.min(...starts.map((s) => turnCost(d, s))) : 0;
  }
  function orthoPath(A, pts, B) {
    const all = [A, ...pts, B], out = [A];
    let prev = null; // direction of the last segment, e.g. [1, 0] = heading right
    for (let i = 1; i < all.length; i++) {
      const P = out[out.length - 1], Q = all[i], N = all[i + 1];
      const sx = sgn(Q[0] - P[0]), sy = sgn(Q[1] - P[1]);
      if (sx && sy) {
        const costH = turnCost(prev, [sx, 0]) + leaveCost([0, sy], Q, N); // across, then up/down
        const costV = turnCost(prev, [0, sy]) + leaveCost([sx, 0], Q, N); // up/down, then across
        const hFirst = costH !== costV ? costH < costV : Math.abs(Q[0] - P[0]) > Math.abs(Q[1] - P[1]);
        out.push(hFirst ? [Q[0], P[1]] : [P[0], Q[1]]);
        prev = hFirst ? [0, sy] : [sx, 0];
      } else if (sx || sy) prev = [sx, sy];
      out.push(Q);
    }
    const s = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const Q = out[i], P = s[s.length - 1];
      if (near(Q[0], P[0]) && near(Q[1], P[1])) continue; // duplicate
      if (s.length >= 2) {
        const O = s[s.length - 2];
        if ((near(O[0], P[0]) && near(P[0], Q[0])) || (near(O[1], P[1]) && near(P[1], Q[1]))) { s[s.length - 1] = Q; continue; } // in line
      }
      s.push(Q);
    }
    return s.slice(1, -1).map(([x, y]) => [x, y]);
  }
  WB.orthoPath = orthoPath;

  WB.Editor = Editor;
})(window.WB);

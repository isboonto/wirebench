'use strict';
// SPICE netlist export for LTspice (Export → SPICE netlist).
//
// The circuit is written the way Wirebench's own solver sees it, so LTspice simulates the same
// thing: every part's simulation model (def.elements) is translated element by element —
//   R → R, C → C, L → L (winding resistance as Rser), voltage sources with their internal
//   resistance (Rser), function-generator waveforms as SINE / PULSE, diodes and LEDs as LTspice
//   "ideal diode" models (Vfwd / Ron, Vrev for zeners — the same piecewise-linear model Wirebench
//   uses), controlled-current elements as G (+ I).
// Parts whose model switches state while simulating are written with real SPICE models instead:
// BJTs and the TIP120 Darlington, MOSFETs (VDMOS), op-amps and voltage regulators (small
// behavioural subcircuits), and the controlled sources as E / G / H / F.
// Digital parts (555, 74HC logic, displays, the Arduino's sketch-driven pins …) can't be a fixed
// netlist; they are listed as comments with the net of every pin, ready for an LTspice part.
// Net names are the schematic's: GND = 0, +5V → P5V, D9, N1 …
(function (WB) {
  const PARTS = WB.PARTS;
  const num = (v) => {
    // compact SPICE number with an engineering suffix (LTspice: f p n u m k Meg G)
    if (!Number.isFinite(v)) return '0';
    if (v === 0) return '0';
    const a = Math.abs(v);
    const units = [[1e9, 'G'], [1e6, 'Meg'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
    for (const [m, s] of units) if (a >= m * 0.9995) return +(v / m).toPrecision(4) + s;
    return v.toExponential(3);
  };
  const GREEK = { 'π': 'pi', 'Ω': 'ohm', 'µ': 'u', 'μ': 'u', 'β': 'beta', 'α': 'alpha', 'θ': 'theta' };
  const ident = (s) => String(s).replace(/\+/g, 'P').replace(/−|-/g, 'M').replace(/[πΩµμβαθ]/g, (c) => GREEK[c]).replace(/[^A-Za-z0-9_]/g, '_');

  function build(app) {
    const A = WB.Schematic.analyse(app);
    const topo = A.topo;
    const lines = [], comments = [], models = new Map(), subckts = new Map(), warnings = [];
    // ---------------------------------------------------------------- node names
    let extra = 0;
    const internal = new Map();
    const nodeName = (n) => {
      if (n === 0) return '0';
      if (typeof n === 'string') return n;
      if (n >= topo.nodeCount) { if (!internal.has(n)) internal.set(n, 'X' + ++extra); return internal.get(n); }
      if (A.names.has(n)) return ident(A.names.get(n));
      return 'NC' + n; // a pin that is connected to nothing else
    };
    const byPart = (p, pin) => { const n = topo.nodeOf.get(p.id + ':' + pin); return n === undefined ? null : nodeName(n); };
    const usedNames = new Set();
    const elName = (letter, part, k, count) => {
      const base = ident(part.name || part.id);
      let nm = (count === 1 && base.toUpperCase().startsWith(letter)) ? base : `${letter}_${base}${count > 1 ? '_' + String.fromCharCode(97 + k) : ''}`;
      while (usedNames.has(nm.toUpperCase())) nm += '_';
      usedNames.add(nm.toUpperCase());
      return nm;
    };
    const diodeModel = (vf, rs, vz) => {
      const key = `D_${num(vf)}_${num(rs)}${vz ? '_Z' + num(vz) : ''}`.replace(/[^A-Za-z0-9_]/g, 'p');
      if (!models.has(key)) models.set(key, `.model ${key} D(Ron=${num(rs)} Roff=1G Vfwd=${num(vf)}${vz ? ` Vrev=${num(vz)}` : ''})`);
      return key;
    };

    let timeDomain = false, tStop = 0, scopeWindow = 0;
    const scopes = [];
    let srcNote = ''; // description of the last source() waveform, written after its parameters

    // ---------------------------------------------------------------- dedicated models
    const DEDICATED = {
      npn: (p) => bjt(p, 'NPN'), pnp: (p) => bjt(p, 'PNP'),
      darlington(p) {
        const sc = 'DARLINGTON_WB';
        subckts.set(sc, `.subckt ${sc} C B E\nQ1 C B M QDARL_WB\nQ2 C M E QDARL_WB\nRbe M E 8k\n.ends ${sc}`);
        models.set('QDARL_WB', '.model QDARL_WB NPN(IS=1e-12 BF=32 VAF=100 RB=10 RC=0.1 RE=0.05 CJE=200p CJC=100p TF=10n)');
        lines.push(`X${ident(p.name)} ${byPart(p, 'C')} ${byPart(p, 'B')} ${byPart(p, 'E')} ${sc} ; TIP120 Darlington (2 × NPN, β ≈ 1000)`);
      },
      nmos: (p) => mos(p, false), pmos: (p) => mos(p, true),
      opamp: (p) => opamp(p), lm358: (p) => opamp(p),
      regulator(p) {
        const m = { '7805': [5, 2, 'LM7805'], '7809': [9, 2, 'LM7809'], '7812': [12, 2, 'LM7812'], '1117': [3.3, 1.2, 'LM1117-3.3'] }[p.props.model] || [5, 2, 'LM7805'];
        const sc = 'REG_' + ident(m[2]);
        subckts.set(sc, `.subckt ${sc} IN GND OUT\n* behavioural ${m[2]}: ${m[0]} V out, ${m[1]} V dropout, 2 mA quiescent\nB1 N1 GND V=max(0, min(${m[0]}, V(IN,GND)-${m[1]}))\nR1 N1 OUT 0.05\nRq IN GND 2k\n.ends ${sc}`);
        lines.push(`X${ident(p.name)} ${byPart(p, 'IN')} ${byPart(p, 'GND')} ${byPart(p, 'OUT')} ${sc}`);
      },
      vcvs: (p) => dep(p, 'E'), vccs: (p) => dep(p, 'G'), ccvs: (p) => dep(p, 'H'), cccs: (p) => dep(p, 'F'),
    };
    function bjt(p, kind) {
      const beta = +(/β\s*(\d+)/.exec(PARTS[p.type].summary(p)) || [0, kind === 'NPN' ? 150 : 150])[1];
      const mdl = `Q${kind}_${ident(p.props.model || kind)}_WB`;
      models.set(mdl, `.model ${mdl} ${kind}(IS=1e-14 BF=${beta} VAF=100 BR=3 RB=10 RC=0.3 RE=0.2 CJE=25p CJC=8p TF=0.4n)`);
      lines.push(`${elName('Q', p, 0, 1)} ${byPart(p, 'C')} ${byPart(p, 'B')} ${byPart(p, 'E')} ${mdl} ; ${p.props.model || kind}, β = ${beta} (generic model)`);
    }
    function mos(p, pch) {
      const vth = +(/Vth\s*[−-]?([\d.]+)/.exec(PARTS[p.type].summary(p)) || [0, pch ? 3 : 2])[1];
      const mdl = `M_${ident(p.props.model || (pch ? 'PMOS' : 'NMOS'))}_WB`;
      models.set(mdl, `.model ${mdl} VDMOS(${pch ? 'pchan ' : ''}Vto=${pch ? -vth : vth} Kp=10 Rd=20m Rs=10m Cgs=1n Cgd=200p)`);
      lines.push(`${elName('M', p, 0, 1)} ${byPart(p, 'D')} ${byPart(p, 'G')} ${byPart(p, 'S')} ${mdl} ; ${p.props.model || ''} (generic VDMOS, Vth = ${pch ? '−' : ''}${vth} V)`);
    }
    function opamp(p) {
      const dual = p.type === 'lm358' || p.props.model === 'LM358';
      const hr = 1.5, lr = dual ? 0.02 : 1.5;
      const sc = dual ? 'OPAMP_LM358_WB' : 'OPAMP_LM741_WB';
      subckts.set(sc, `.subckt ${sc} INP INN VP VN OUT\n* behavioural op-amp: gain 100k, output ${hr} V below V+ and ${lr} V above V−, 50 Ω output\nRin INP INN 2Meg\nB1 N1 VN V=max(${lr}, min(V(VP,VN)-${hr}, 1e5*V(INP,INN)+V(VP,VN)/2))\nRout N1 OUT 50\n.ends ${sc}`);
      const n = (pin) => byPart(p, pin);
      if (dual) {
        lines.push(`X${ident(p.name)}A ${n('3')} ${n('2')} ${n('8')} ${n('4')} ${n('1')} ${sc} ; LM358 half A`);
        lines.push(`X${ident(p.name)}B ${n('5')} ${n('6')} ${n('8')} ${n('4')} ${n('7')} ${sc} ; LM358 half B`);
        lines.push(`R_${ident(p.name)}_Iq ${n('8')} ${n('4')} 7k ; supply current`);
      } else {
        lines.push(`X${ident(p.name)} ${n('3')} ${n('2')} ${n('7')} ${n('4')} ${n('6')} ${sc} ; LM741`);
        lines.push(`R_${ident(p.name)}_Iq ${n('7')} ${n('4')} 3k ; supply current`);
      }
    }
    function dep(p, letter) {
      const cc = letter === 'H' || letter === 'F';
      const op = byPart(p, 'O+'), on = byPart(p, 'O-'), name = elName(letter, p, 0, 1);
      // Wirebench's output pushes current out of O+, through the load, back into O−;
      // SPICE G / F currents flow from the first node to the second inside the source.
      if (cc) {
        const vs = `V_${ident(p.name)}_sense`;
        lines.push(`${vs} ${byPart(p, 'S+')} ${byPart(p, 'S-')} 0 ; senses the control current (into S+, out of S−)`);
        if (letter === 'H') lines.push(`${name} ${op} ${on} ${vs} ${num(+p.props.rm)} ; CCVS, Vout = ${p.props.rm} Ω × Iin`);
        else lines.push(`${name} ${on} ${op} ${vs} ${num(+p.props.beta)} ; CCCS, Iout = ${p.props.beta} × Iin (out of O+)`);
      } else if (letter === 'E') lines.push(`${name} ${op} ${on} ${byPart(p, 'C+')} ${byPart(p, 'C-')} ${num(+p.props.gain)} ; VCVS, Vout = ${p.props.gain} × Vin`);
      else lines.push(`${name} ${on} ${op} ${byPart(p, 'C+')} ${byPart(p, 'C-')} ${num(+p.props.gm / 1000)} ; VCCS, Iout = ${p.props.gm} mA/V × Vin (out of O+)`);
    }

    // ---------------------------------------------------------------- generic: the solver's own elements
    // while the simulation runs, the Arduino's pins are exported in their present state (HIGH / LOW / PWM)
    const live = !!(app.sim && app.sim.pins);
    const sim = live ? { pins: app.sim.pins, partState: {} } : { pins: {}, partState: {} };
    let next = topo.nodeCount;
    const parts = app.project.parts.filter((p) => PARTS[p.type] && !PARTS[p.type].holes && !PARTS[p.type].annotation);
    for (const p of parts) {
      const def = PARTS[p.type];
      if (p.type === 'scope') {
        scopes.push(p);
        scopeWindow = Math.max(scopeWindow, (10 * (+p.props.tdiv || 20)) / 1000);
      }
      if (DEDICATED[p.type]) { DEDICATED[p.type](p); continue; }
      if (!def.elements) continue;
      let els;
      try {
        els = def.elements({ part: p, props: p.props || {}, sim, state: {}, ui: {}, n: (pin) => { const v = topo.nodeOf.get(p.id + ':' + pin); return v === undefined ? -1 : v; }, newNode: () => next++ }) || [];
      } catch (e) { els = null; }
      const behavioural = !els || els.some((e) => e.upd || e.commit || e.off !== undefined || e.t === 'G' && e.p === undefined);
      if (behavioural || (def.board && false)) { describe(p, def); continue; }
      els = els.filter((e) => e.a >= 0 && e.b >= 0 && !(e.t === 'G' && (!(e.p >= 0) || !(e.q >= 0))));
      // a board's supplies and on-board LED only matter where something is connected to them
      if (def.board) {
        const dangling = (n) => n !== 0 && n < topo.nodeCount && !A.names.has(n);
        els = els.filter((e) => !(dangling(e.a) || dangling(e.b)));
        // then drop anything left hanging on an internal node (e.g. the "L" LED once D13 is unused)
        for (let changed = true; changed;) {
          const uses = new Map();
          for (const e of els) for (const n of [e.a, e.b]) if (n >= topo.nodeCount) uses.set(n, (uses.get(n) || 0) + 1);
          const keep = els.filter((e) => [e.a, e.b].every((n) => n < topo.nodeCount || uses.get(n) >= 2));
          changed = keep.length !== els.length; els = keep;
        }
      }
      if (!els.length) continue;
      const count = {};
      for (const e of els) { const L = { R: 'R', V: 'V', D: 'D', C: 'C', L: 'L', G: 'G' }[e.t]; count[L] = (count[L] || 0) + 1; }
      const k = {};
      const header = def.board ? `* ${p.name}: ${def.label} — on-board supplies and "L" LED` : null;
      if (header) lines.push(header);
      for (const e of els) {
        const L = { R: 'R', V: 'V', D: 'D', C: 'C', L: 'L', G: 'G' }[e.t];
        if (!L) continue;
        k[L] = (k[L] || 0);
        const name = elName(L, p, k[L]++, count[L]);
        const a = nodeName(e.a), b = nodeName(e.b);
        const note = e.cond ? ` ; in Wirebench only active while powered (≥ ${e.cond.min} V)` : '';
        if (e.t === 'R') { if (e.r < 1e9) lines.push(`${name} ${a} ${b} ${num(e.r)}${note}`); }
        else if (e.t === 'C') { lines.push(`${name} ${a} ${b} ${num(e.c)}`); timeDomain = true; }
        else if (e.t === 'L') { lines.push(`${name} ${a} ${b} ${num(e.l)} Rser=${num(Math.max(1e-3, e.rw || 0))}`); timeDomain = true; }
        else if (e.t === 'D') lines.push(`${name} ${a} ${b} ${diodeModel(e.vf, e.rs, e.vz)}${def.label === 'LED' ? ` ; ${p.props.color || ''} LED` : ''}`);
        else if (e.t === 'G') { lines.push(`${name} ${a} ${b} ${nodeName(e.p)} ${nodeName(e.q)} ${num(e.gm)}`); if (e.i0) lines.push(`I_${name.replace(/^G_?/, '')} ${a} ${b} ${num(e.i0)}`); }
        else if (e.t === 'V') {
          srcNote = '';
          const spec = source(e);
          const notes = [srcNote, note.replace(/^ ; /, '')].filter(Boolean).join('; ');
          lines.push(`${name} ${a} ${b} ${spec} Rser=${num(e.r)}${notes ? ' ; ' + notes : ''}`); // comment last: ';' ends the line for SPICE
        }
      }
    }
    function source(e) {
      const shape = e.shape | 0;
      if (shape && e.freq > 0) {
        timeDomain = true;
        const T = 1 / e.freq, lo = e.v - e.amp, hi = e.v + e.amp, edge = T / 1000;
        tStop = Math.max(tStop, 5 * T);
        if (shape === 1) return `SINE(${num(e.v)} ${num(e.amp)} ${num(e.freq)})`;
        if (shape === 2) return `PULSE(${num(hi)} ${num(lo)} ${num(T / 2)} ${num(edge)} ${num(edge)} ${num(T / 2 - edge)} ${num(T)})`;
        if (shape === 3) { srcNote = 'triangle'; return `PULSE(${num(lo)} ${num(hi)} 0 ${num(T / 2)} ${num(T / 2)} 0 ${num(T)})`; }
        if (shape === 4) { srcNote = 'sawtooth'; return `PULSE(${num(lo)} ${num(hi)} 0 ${num(T - edge)} ${num(edge)} 0 ${num(T)})`; }
      }
      if (e.duty != null && e.duty > 0 && e.duty < 1) {
        timeDomain = true;
        const f = e.freq > 0 ? e.freq : 490, T = 1 / f, edge = T / 1000;
        tStop = Math.max(tStop, 10 * T);
        srcNote = `PWM ${Math.round(e.duty * 100)} %`;
        return `PULSE(0 ${num(e.v)} 0 ${num(edge)} ${num(edge)} ${num(e.duty * T - edge)} ${num(T)})`;
      }
      return `DC ${num(e.v)}`;
    }
    // parts that can't be a fixed netlist: list every pin with its net
    function describe(p, def) {
      const pins = def.pins(p.props || {});
      const conn = pins.map((q) => { const nm = byPart(p, q.id); return nm && !/^NC/.test(nm) ? `${q.id}=${nm}` : null; }).filter(Boolean);
      comments.push(`* ${p.name} — ${def.label}${def.summary ? ' (' + def.summary(p) + ')' : ''}: not exported (digital / behavioural part).`);
      if (p.type === 'timer555') comments.push('*   In LTspice: add the component "NE555" (Misc folder) and wire its pins to these nets.');
      comments.push(conn.length ? `*   pins: ${conn.join('  ')}` : '*   (no pins connected)');
    }

    // Arduino pins driven by the sketch
    const board = parts.find((p) => PARTS[p.type].board);
    if (board) {
      const gpio = PARTS[board.type].pins({}).filter((q) => /^(D\d+|A\d+)$/.test(q.id)).map((q) => ({ id: q.id, n: topo.nodeOf.get(board.id + ':' + q.id) }))
        .filter((q) => q.n !== undefined && A.names.has(q.n)).map((q) => `${q.id}=${nodeName(q.n)}`);
      if (gpio.length && live) comments.push(`* ${board.name} — Arduino pins written with their state at export time (simulation running): ${gpio.join('  ')}`);
      else if (gpio.length) {
        comments.push(`* ${board.name} — Arduino pins used by the sketch: ${gpio.join('  ')}`);
        comments.push('*   Their signals come from the sketch. Export while the simulation runs to include their present state,');
        comments.push('*   or add sources, e.g.  V_D9 D9 0 PULSE(0 5 0 1u 1u 1m 2.04m) Rser=25  (490 Hz PWM, 50 %)');
      }
    }

    // ---------------------------------------------------------------- analysis
    let analysis;
    if (timeDomain || scopes.length) {
      const T = Math.max(tStop, scopeWindow ? 3 * scopeWindow : 0) || 0.1;
      analysis = `.tran 0 ${num(T)} 0 ${num(T / 2000)}`;
    } else analysis = '.op';
    const probes = scopes.map((s) => {
      const ch = (pin) => { const n = byPart(s, pin); return n && !/^NC/.test(n) ? `V(${n})` : '—'; };
      return `* ${s.name}: CH1 = ${ch('CH1')}, CH2 = ${ch('CH2')}  (${s.props.tdiv >= 1 ? s.props.tdiv + ' ms' : s.props.tdiv * 1000 + ' µs'}/div)`;
    });
    const meters = parts.filter((p) => p.type === 'multimeter').map((p) => `* ${p.name}: ${p.props.mode || 'V'} between ${byPart(p, String(p.props.mode || 'V').startsWith('A') ? 'A' : 'V') || '—'} and ${byPart(p, 'COM') || '—'}`);

    // ---------------------------------------------------------------- text
    const date = new Date().toISOString().slice(0, 10);
    const out = [];
    out.push(`* Wirebench ${WB.VERSION || ''} — SPICE netlist for LTspice`);
    out.push(`* Generated ${date} from the circuit on the workspace (${parts.length} parts).`);
    out.push('* Open this file in LTspice (File → Open, .cir) and press Run.');
    out.push('* Node names match Export → Schematic: 0 = GND, P5V = +5V, D9 = Arduino pin 9, N1 … = other nets.');
    out.push('*');
    out.push(...lines);
    if (comments.length) { out.push('*'); out.push('* ---- parts that are not part of the netlist ----'); out.push(...comments); }
    if (models.size || subckts.size) { out.push('*'); out.push('* ---- models ----'); out.push(...models.values()); out.push(...subckts.values()); }
    out.push('*');
    if (probes.length || meters.length) { out.push('* ---- instruments: what Wirebench measures ----'); out.push(...probes, ...meters); }
    out.push(analysis);
    out.push('.backanno');
    out.push('.end');
    // LTspice reads netlists as plain ASCII: spell out the symbols used in part names and comments
    const ASCII = { '—': '-', '–': '-', '−': '-', '→': '->', '←': '<-', 'Ω': 'ohm', 'µ': 'u', 'μ': 'u', 'β': 'beta', '×': 'x', '≥': '>=', '≤': '<=', '…': '...', '·': '.', '°': 'deg', '≈': '~', 'π': 'pi', '′': "'", '’': "'", '“': '"', '”': '"' };
    const text = (out.join('\n') + '\n').replace(/[^\x00-\x7F]/g, (ch) => ASCII[ch] !== undefined ? ASCII[ch] : '?');
    return { text, elements: lines.length, skipped: comments.filter((c) => /not exported/.test(c)).length, analysis, warnings };
  }

  WB.Spice = { build };
})(window.WB);

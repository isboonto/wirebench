'use strict';
// Loads the Rust circuit solver (crates/wb-core compiled to WebAssembly).
// If it can't be loaded (e.g. page opened from file://), the JavaScript
// solver in circuit.js is used instead.
(function (WB) {
  const STRIDE = 15;
  WB.Native = { ready: false, kind: 'JavaScript' };

  async function init() {
    try {
      const res = await fetch('wasm/wb_core.wasm');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
      const ex = instance.exports;
      if (typeof ex.wb_solve !== 'function' || typeof ex.wb_transient !== 'function' || ex.wb_version() < 5) throw new Error('unexpected module version');

      // Element layout (see crates/wb-core/src/lib.rs):
      // [kind, a, b, r, v, duty, hasCond, c1, c2, condMin, wave, freq, amp, x, vPrev]
      const write = (els) => {
        const E = els.length;
        const ptr = ex.wb_input(E * STRIDE);
        const inp = new Float64Array(ex.memory.buffer, ptr, E * STRIDE);
        for (let k = 0; k < E; k++) {
          const e = els[k], o = k * STRIDE;
          inp[o] = e.t === 'R' ? 0 : e.t === 'V' ? 1 : e.t === 'D' ? 2 : e.t === 'C' ? 3 : 4;
          inp[o + 1] = e.ca;
          inp[o + 2] = e.cb;
          inp[o + 3] = e.t === 'D' ? e.rs : e.t === 'C' ? e.c : e.t === 'L' ? e.l : e.r;
          inp[o + 4] = e.t === 'D' ? e.vf : e.t === 'V' ? e.v : e.t === 'C' ? e.vc || 0 : e.t === 'L' ? e.il || 0 : 0;
          inp[o + 5] = e.duty != null ? e.duty : -1;
          inp[o + 6] = e.cond ? 1 : 0;
          inp[o + 7] = e.cond ? e.cc1 : 0;
          inp[o + 8] = e.cond ? e.cc2 : 0;
          inp[o + 9] = e.cond ? e.cond.min : 0;
          inp[o + 10] = e.shape | 0;
          inp[o + 11] = e.freq || 0;
          inp[o + 12] = e.amp || 0;
          inp[o + 13] = e.t === 'D' ? e.vz || 0 : e.t === 'L' ? e.rw || 0 : 0;
          const prev = e.t === 'C' ? e.vc1 : e.t === 'L' ? e.il1 : undefined;
          inp[o + 14] = Number.isFinite(prev) ? prev : NaN;
        }
      };
      // Common head of both outputs: V[N], i[E], ipk[E], i2[E], reach[N]
      const readHead = (out, N, els) => {
        const E = els.length;
        const V = out.slice(0, N);
        for (let k = 0; k < E; k++) { els[k].i = out[N + k]; els[k].ipk = out[N + E + k]; els[k].i2 = out[N + 2 * E + k]; }
        const reach = new Uint8Array(N);
        for (let j = 0; j < N; j++) reach[j] = out[N + 3 * E + j] ? 1 : 0;
        return { V, reach, o: N + 3 * E + N };
      };

      WB.Native = {
        ready: true,
        kind: 'Rust (WebAssembly)',
        version: ex.wb_version(),
        solve(N, els) {
          write(els);
          const op = ex.wb_solve(N, els.length);
          const out = new Float64Array(ex.memory.buffer, op, ex.wb_output_len());
          let { V, reach, o } = readHead(out, N, els);
          const K = out[o++] | 0;
          const phases = [];
          for (let k = 0; k < K; k++, o += N) phases.push(out.slice(o, o + N));
          return { V, reach, phases };
        },
        transient(N, els, t0, dt, steps, probes, decim) {
          write(els);
          const pp = ex.wb_probes(probes.length);
          const pin = new Float64Array(ex.memory.buffer, pp, Math.max(1, probes.length));
          probes.forEach((p, i) => { pin[i] = p; });
          const op = ex.wb_transient(N, els.length, t0, dt, steps, probes.length, decim);
          const out = new Float64Array(ex.memory.buffer, op, ex.wb_output_len());
          let { V, reach, o } = readHead(out, N, els);
          const E = els.length;
          for (let k = 0; k < E; k++) {
            if (els[k].t === 'C') { els[k].vc = out[o + k]; els[k].vc1 = out[o + E + k]; }
            else if (els[k].t === 'L') { els[k].il = out[o + k]; els[k].il1 = out[o + E + k]; }
          }
          o += 2 * E;
          const S = out[o++] | 0;
          const samples = Array.from(out.subarray(o, o + S * (probes.length + 1)));
          return { V, reach, samples };
        },
      };
    } catch (e) {
      console.info('Wirebench: Rust/WebAssembly solver not available, using the JavaScript solver.', e && e.message);
    }
    return WB.Native;
  }

  WB.nativeReady = init();

  // Desktop (Tauri) bridge
  const tauri = window.__TAURI__ && window.__TAURI__.core;
  WB.isDesktop = !!tauri;
  WB.invoke = tauri ? (cmd, args) => tauri.invoke(cmd, args) : null;
})(window.WB);

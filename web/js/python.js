'use strict';
// Wirebench 2.x — starts the UNO Q's Python program (js/py-worker.mjs) and connects its Bridge
// to the running sketch: Python's Bridge.call("name", ...) runs the function the sketch made
// available with Bridge.provide("name", fn), between the sketch's own steps, and returns its result.
(function (WB) {
  WB.Python = {
    // rt: the sketch runtime (or null); out(text, kind): where print() output goes
    start(code, rt, out) {
      const w = new Worker('js/py-worker.mjs', { type: 'module' });
      const info = { worker: w, t0: performance.now(), ready: null };
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'print') out(m.text, m.err ? 'err' : 'out');
        else if (m.type === 'ready') { info.ready = m; out(`[Python ${m.version} ready in ${m.ms} ms${m.jspi ? '' : ' — this browser lacks JSPI: Bridge.call and time.sleep will not work'}]`, 'info'); }
        else if (m.type === 'error') out(m.text, 'err');
        else if (m.type === 'done') out('[Python program ended]', 'info');
        else if (m.type === 'notify') { const fn = rt && rt.bridgeFns[m.name]; if (fn) rt.pendingIsr.push(async () => { await fn(...m.args); }); }
        else if (m.type === 'call') {
          const fn = rt && rt.running && rt.bridgeFns[m.name];
          if (!fn) { w.postMessage({ type: 'reply', id: m.id, error: `the sketch provides no function "${m.name}" (Bridge.provide("${m.name}", …) in setup())` }); return; }
          // run it between the sketch's own steps, like the real Bridge's RPC handler
          rt.pendingIsr.push(async () => {
            try { const v = await fn(...m.args); w.postMessage({ type: 'reply', id: m.id, value: v === undefined ? null : v }); }
            catch (err) { w.postMessage({ type: 'reply', id: m.id, error: String(err && err.message || err) }); }
          });
        }
      };
      w.onerror = (e) => out('Python worker failed: ' + (e.message || 'unknown error'), 'err');
      w.postMessage({ type: 'run', code });
      return info;
    },
    stop(info) { if (info && info.worker) info.worker.terminate(); },
  };
})(window.WB);

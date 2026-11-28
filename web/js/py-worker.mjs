// JumperCraft 2.x — the UNO Q's Linux side: runs the project's Python program in a background
// worker with Pyodide (CPython compiled to WebAssembly), so `while True` loops and time.sleep()
// never freeze the page. Messages:
//   page -> worker: { type: 'run', code }                start Python
//                   { type: 'reply', id, value|error }    answer to a Bridge.call
//   worker -> page: { type: 'ready', ms, jspi }           Python is loaded
//                   { type: 'print', text, err }          print() output
//                   { type: 'call', id, name, args }      Bridge.call to a function the sketch provides
//                   { type: 'notify', name, args }        Bridge.notify (no answer)
//                   { type: 'done' } / { type: 'error', text }
import { loadPyodide } from '../vendor/pyodide/pyodide.mjs';

const t0 = performance.now();
const pending = new Map();
let nextId = 1;

// called from Python (through run_sync) — returns a promise the page settles with the sketch's answer
self.wbBridgeCall = (name, args) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  postMessage({ type: 'call', id, name: String(name), args: args && args.toJs ? args.toJs() : Array.from(args || []) });
});
self.wbBridgeNotify = (name, args) => postMessage({ type: 'notify', name: String(name), args: args && args.toJs ? args.toJs() : Array.from(args || []) });
self.wbSleep = (s) => new Promise((r) => setTimeout(r, Math.max(0, Number(s) || 0) * 1000));

// arduino.app_utils as on the UNO Q (Arduino App Lab): Bridge and App
const APP_UTILS = `
import js
from pyodide.ffi import run_sync, to_js

class _Bridge:
    """Talks to the sketch on the microcontroller (Arduino_RouterBridge)."""
    def call(self, name, *args, timeout=None):
        return run_sync(js.wbBridgeCall(name, to_js(list(args))))
    def notify(self, name, *args):
        js.wbBridgeNotify(name, to_js(list(args)))
    def provide(self, name, fn):
        _provided[name] = fn

class _App:
    def run(self, user_loop=None):
        import time
        try:
            while True:
                if user_loop is not None:
                    user_loop()
                else:
                    time.sleep(1)
        except KeyboardInterrupt:
            pass

_provided = {}
Bridge = _Bridge()
App = _App()
__all__ = ["Bridge", "App"]
`;

// time.sleep() waits without blocking the worker (so Bridge answers can arrive)
const PRELUDE = `
import time, js
from pyodide.ffi import run_sync
def _wb_sleep(s):
    run_sync(js.wbSleep(s))
time.sleep = _wb_sleep
`;

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'reply') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.value);
    return;
  }
  if (m.type !== 'run') return;
  let py;
  try {
    py = await loadPyodide({
      indexURL: new URL('../vendor/pyodide/', import.meta.url).href,
      stdout: (text) => postMessage({ type: 'print', text }),
      stderr: (text) => postMessage({ type: 'print', text, err: true }),
    });
  } catch (err) {
    postMessage({ type: 'error', text: 'Python could not start: ' + (err && err.message || err) });
    return;
  }
  postMessage({ type: 'ready', ms: Math.round(performance.now() - t0), jspi: typeof WebAssembly.Suspending === 'function', version: py.version });
  try {
    py.FS.mkdirTree('/home/pyodide/arduino');
    py.FS.writeFile('/home/pyodide/arduino/__init__.py', '');
    py.FS.writeFile('/home/pyodide/arduino/app_utils.py', APP_UTILS);
    await py.runPythonAsync(PRELUDE);
    await py.runPythonAsync(m.code);
    postMessage({ type: 'done' });
  } catch (err) {
    postMessage({ type: 'error', text: String(err && err.message || err) });
  }
};

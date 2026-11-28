//! JumperCraft circuit solver.
//!
//! Every element is reduced to conductances and current injections (voltage
//! sources use their Norton equivalent). LEDs/diodes are piecewise-linear
//! (off, or Vf in series with Rs) and solved iteratively. Sources with a PWM
//! duty cycle are averaged over 16 phases. Node 0 is ground.
//!
//! `transient` steps the circuit through time for circuits with capacitors,
//! inductors or function-generator sources. Capacitors and inductors use the
//! second-order backward differentiation formula (BDF2 / Gear-2): a capacitor
//! becomes a conductance 3C/(2dt) in parallel with a current source built from
//! its last two voltages. Unlike backward Euler it does not artificially damp
//! LC ringing, and unlike the trapezoidal rule it does not ring on stiff parts
//! (a large capacitor straight across a supply). The first step after a reset
//! (no previous value yet) is backward Euler. Sources follow their waveform
//! (sine, square, triangle, sawtooth, or a real PWM square wave).
//!
//! The same code is used natively (tests, desktop) and compiled to
//! WebAssembly for the editor UI via the `wb_*` C-ABI functions below.

use std::cell::RefCell;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Resistor,
    Source,
    Diode,
    /// Capacitor: `r` holds the capacitance (F), `v` its voltage (a - b).
    Capacitor,
    /// Inductor: `r` holds the inductance (H), `v` its current (a -> b),
    /// `x` its winding (series) resistance.
    Inductor,
}

/// Source waveform for function generators (`amp` = peak, `v` = DC offset).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Wave {
    None,
    Sine,
    Square,
    Triangle,
    Sawtooth,
}

#[derive(Clone, Debug)]
pub struct Element {
    pub kind: Kind,
    pub a: usize,
    pub b: usize,
    /// Resistance (R), series resistance (V source / diode Rs), capacitance (C).
    pub r: f64,
    /// Source voltage / offset, diode forward voltage, or capacitor voltage.
    pub v: f64,
    /// PWM duty cycle (0..1) for sources; `None` = constant.
    pub duty: Option<f64>,
    /// Element is active only while V(c1) - V(c2) >= min.
    pub cond: Option<(usize, usize, f64)>,
    /// Time-varying source shape, frequency (Hz) and peak amplitude (V).
    /// A PWM source (`duty`) uses `freq` as its switching frequency.
    pub wave: Wave,
    pub freq: f64,
    pub amp: f64,
    /// Extra parameter: zener voltage for a diode (0 = ordinary diode),
    /// winding resistance for an inductor.
    pub x: f64,
    pub on: bool,
    /// Zener diode conducting in reverse (breakdown).
    pub rev: bool,
    pub cond_on: bool,
    /// Average current (a -> b through the element; for sources: out of `a`).
    pub i: f64,
    /// Peak current over the PWM phases / time steps.
    pub ipk: f64,
    /// Mean square current (for AC / RMS readings).
    pub i2: f64,
    /// Capacitor voltage / inductor current one step before `v` (BDF2 history);
    /// NaN = unknown, the next step falls back to backward Euler.
    pub v_prev: f64,
}

impl Element {
    pub fn resistor(a: usize, b: usize, r: f64) -> Self {
        Self::new(Kind::Resistor, a, b, r, 0.0)
    }
    pub fn source(a: usize, b: usize, v: f64, r: f64) -> Self {
        Self::new(Kind::Source, a, b, r, v)
    }
    pub fn diode(a: usize, b: usize, vf: f64, rs: f64) -> Self {
        Self::new(Kind::Diode, a, b, rs, vf)
    }
    pub fn capacitor(a: usize, b: usize, c: f64) -> Self {
        Self::new(Kind::Capacitor, a, b, c, 0.0)
    }
    /// Zener diode: forward like a diode, conducts in reverse above `vz`.
    pub fn zener(a: usize, b: usize, vf: f64, vz: f64, rs: f64) -> Self {
        let mut e = Self::new(Kind::Diode, a, b, rs, vf);
        e.x = vz;
        e
    }
    /// Inductor of `l` henries with winding resistance `rw`.
    pub fn inductor(a: usize, b: usize, l: f64, rw: f64) -> Self {
        let mut e = Self::new(Kind::Inductor, a, b, l, 0.0);
        e.x = rw;
        e
    }
    /// Winding resistance used by the solver (never exactly 0).
    fn rw(&self) -> f64 {
        self.x.max(1e-3)
    }
    /// Function-generator source: `offset` + a waveform of peak `amp` at `freq` Hz.
    pub fn wave_source(a: usize, b: usize, wave: Wave, freq: f64, amp: f64, offset: f64, r: f64) -> Self {
        let mut e = Self::new(Kind::Source, a, b, r, offset);
        e.wave = wave;
        e.freq = freq;
        e.amp = amp;
        e
    }
    fn new(kind: Kind, a: usize, b: usize, r: f64, v: f64) -> Self {
        Element { kind, a, b, r, v, duty: None, cond: None, wave: Wave::None, freq: 0.0, amp: 0.0, x: 0.0, on: false, rev: false, cond_on: false, i: 0.0, ipk: 0.0, i2: 0.0, v_prev: f64::NAN }
    }
    /// Source voltage in a DC solve (PWM phase 0..1; waveforms sit at their offset).
    fn src_v(&self, phase: f64) -> f64 {
        match self.duty {
            Some(d) => {
                if phase < d {
                    self.v
                } else {
                    0.0
                }
            }
            None => self.v,
        }
    }
    /// Source voltage at time `t` (seconds).
    pub fn src_at(&self, t: f64) -> f64 {
        let frac = |f: f64| {
            let x = t * f;
            x - x.floor()
        };
        match self.wave {
            Wave::None => match self.duty {
                Some(d) => {
                    let f = if self.freq > 0.0 { self.freq } else { 490.0 };
                    if frac(f) < d {
                        self.v
                    } else {
                        0.0
                    }
                }
                None => self.v,
            },
            Wave::Sine => self.v + self.amp * (2.0 * std::f64::consts::PI * self.freq * t).sin(),
            Wave::Square => self.v + if frac(self.freq) < 0.5 { self.amp } else { -self.amp },
            Wave::Triangle => {
                let p = frac(self.freq);
                let shape = if p < 0.25 {
                    4.0 * p
                } else if p < 0.75 {
                    2.0 - 4.0 * p
                } else {
                    4.0 * p - 4.0
                };
                self.v + self.amp * shape
            }
            Wave::Sawtooth => self.v + self.amp * (2.0 * frac(self.freq) - 1.0),
        }
    }
    fn active(&self) -> bool {
        self.cond.is_none() || self.cond_on
    }
    fn value(&self, mode: Mode) -> f64 {
        match mode {
            Mode::Dc(phase) => self.src_v(phase),
            Mode::Tran { t, .. } => self.src_at(t),
        }
    }
}

/// How elements are evaluated: DC operating point at a PWM phase (capacitors
/// open, waveforms at their offset), or one transient step ending at time `t`.
#[derive(Clone, Copy)]
enum Mode {
    Dc(f64),
    Tran { t: f64, dt: f64 },
}

pub struct Solution {
    /// Average node voltages (index 0 = ground).
    pub v: Vec<f64>,
    /// True if the node has a conductive path to ground.
    pub reach: Vec<bool>,
    /// Node voltages in each PWM phase (empty when nothing is PWM-driven).
    /// Used by the oscilloscope to draw square waves.
    pub phases: Vec<Vec<f64>>,
}

const GMIN: f64 = 1e-9;

fn gauss(a: &mut [f64], b: &mut [f64], n: usize) -> Vec<f64> {
    for k in 0..n {
        let mut piv = k;
        let mut max = a[k * n + k].abs();
        for i in (k + 1)..n {
            let v = a[i * n + k].abs();
            if v > max {
                max = v;
                piv = i;
            }
        }
        if max < 1e-30 {
            continue;
        }
        if piv != k {
            for j in 0..n {
                a.swap(k * n + j, piv * n + j);
            }
            b.swap(k, piv);
        }
        let d = a[k * n + k];
        for i in (k + 1)..n {
            let f = a[i * n + k] / d;
            if f == 0.0 {
                continue;
            }
            for j in k..n {
                a[i * n + j] -= f * a[k * n + j];
            }
            b[i] -= f * b[k];
        }
    }
    let mut x = vec![0.0; n];
    for i in (0..n).rev() {
        let mut s = b[i];
        for j in (i + 1)..n {
            s -= a[i * n + j] * x[j];
        }
        let d = a[i * n + i];
        x[i] = if d.abs() < 1e-30 { 0.0 } else { s / d };
    }
    x
}

fn assemble(n_nodes: usize, els: &[Element], mode: Mode) -> Vec<f64> {
    let mut volts = vec![0.0; n_nodes];
    if n_nodes <= 1 {
        return volts;
    }
    let n = n_nodes - 1;
    let mut a = vec![0.0; n * n];
    let mut b = vec![0.0; n];
    for i in 0..n {
        a[i * n + i] += GMIN;
    }
    let g2 = |a: &mut Vec<f64>, p: usize, q: usize, g: f64| {
        if p > 0 {
            a[(p - 1) * n + p - 1] += g;
        }
        if q > 0 {
            a[(q - 1) * n + q - 1] += g;
        }
        if p > 0 && q > 0 {
            a[(p - 1) * n + q - 1] -= g;
            a[(q - 1) * n + p - 1] -= g;
        }
    };
    let inj = |b: &mut Vec<f64>, p: usize, q: usize, cur: f64| {
        if p > 0 {
            b[p - 1] += cur;
        }
        if q > 0 {
            b[q - 1] -= cur;
        }
    };
    for e in els {
        if !e.active() {
            continue;
        }
        match e.kind {
            Kind::Resistor => g2(&mut a, e.a, e.b, 1.0 / e.r),
            Kind::Source => {
                let g = 1.0 / e.r;
                g2(&mut a, e.a, e.b, g);
                inj(&mut b, e.a, e.b, e.value(mode) * g);
            }
            Kind::Diode => {
                if e.on {
                    let g = 1.0 / e.r;
                    g2(&mut a, e.a, e.b, g);
                    inj(&mut b, e.a, e.b, e.v * g);
                } else if e.rev {
                    // zener breakdown: V(a) - V(b) = -(Vz + i·Rs)
                    let g = 1.0 / e.r;
                    g2(&mut a, e.a, e.b, g);
                    inj(&mut b, e.a, e.b, -e.x * g);
                } else {
                    g2(&mut a, e.a, e.b, GMIN);
                }
            }
            Kind::Inductor => match mode {
                Mode::Dc(_) => g2(&mut a, e.a, e.b, 1.0 / e.rw()),
                Mode::Tran { dt, .. } => {
                    // v = Rw·i + L·di/dt with L·di/dt ≈ k·i - hist  =>  i = g·v + g·hist
                    let (k, hist) = companion(e, dt);
                    let g = 1.0 / (e.rw() + k);
                    g2(&mut a, e.a, e.b, g);
                    inj(&mut b, e.a, e.b, -g * hist);
                }
            },
            Kind::Capacitor => match mode {
                Mode::Dc(_) => g2(&mut a, e.a, e.b, GMIN),
                Mode::Tran { dt, .. } => {
                    // i = C·dv/dt ≈ g·v - hist
                    let (g, hist) = companion(e, dt);
                    g2(&mut a, e.a, e.b, g);
                    inj(&mut b, e.a, e.b, hist);
                }
            },
        }
    }
    let x = gauss(&mut a, &mut b, n);
    volts[1..].copy_from_slice(&x);
    volts
}

/// Discretised derivative of a capacitor's voltage / an inductor's current `y`:
/// X·dy/dt ≈ g·y_new - hist, where X is the capacitance or inductance. BDF2 when
/// the previous value is known, backward Euler otherwise. Returns (g, hist).
fn companion(e: &Element, dt: f64) -> (f64, f64) {
    let x = e.r;
    if e.v_prev.is_finite() {
        // dy/dt ≈ (3y - 4y1 + y2) / (2dt)
        let h = x / (2.0 * dt);
        (3.0 * h, h * (4.0 * e.v - e.v_prev))
    } else {
        let g = x / dt;
        (g, g * e.v)
    }
}

fn current(e: &Element, v: &[f64], mode: Mode) -> f64 {
    if !e.active() {
        return 0.0;
    }
    let vd = v[e.a] - v[e.b];
    match e.kind {
        Kind::Resistor => vd / e.r,
        Kind::Source => (e.value(mode) - vd) / e.r,
        Kind::Diode => {
            if e.on {
                (vd - e.v) / e.r
            } else if e.rev {
                (vd + e.x) / e.r
            } else {
                0.0
            }
        }
        Kind::Capacitor => match mode {
            Mode::Dc(_) => 0.0,
            Mode::Tran { dt, .. } => {
                let (g, hist) = companion(e, dt);
                g * vd - hist
            }
        },
        Kind::Inductor => match mode {
            Mode::Dc(_) => vd / e.rw(),
            Mode::Tran { dt, .. } => {
                let (k, hist) = companion(e, dt);
                (vd + hist) / (e.rw() + k)
            }
        },
    }
}

/// Update diode / conditional-element states from `v`; true if any changed.
fn update_states(els: &mut [Element], v: &[f64]) -> bool {
    let mut changed = false;
    for e in els.iter_mut() {
        if e.kind == Kind::Diode {
            let vd = v[e.a] - v[e.b];
            let on = vd > e.v;
            let rev = e.x > 0.0 && -vd > e.x;
            if on != e.on || rev != e.rev {
                e.on = on;
                e.rev = rev;
                changed = true;
            }
        }
        if let Some((c1, c2, min)) = e.cond {
            let on = v[c1] - v[c2] >= min;
            if on != e.cond_on {
                e.cond_on = on;
                changed = true;
            }
        }
    }
    changed
}

/// Solve one operating point, iterating diode states until they settle.
fn solve_point(n_nodes: usize, els: &mut [Element], mode: Mode, max_iter: usize) -> Vec<f64> {
    let mut v = assemble(n_nodes, els, mode);
    for _ in 0..max_iter {
        if !update_states(els, &v) {
            break;
        }
        v = assemble(n_nodes, els, mode);
    }
    v
}

/// Nodes with a conductive path to ground (capacitors count as conductive).
fn reachable(n_nodes: usize, els: &[Element]) -> Vec<bool> {
    let mut adj = vec![Vec::new(); n_nodes.max(1)];
    for e in els.iter() {
        let conductive = match e.kind {
            Kind::Resistor => e.r < 1e7,
            Kind::Source => e.active(),
            Kind::Diode => e.on || e.rev,
            Kind::Capacitor | Kind::Inductor => true,
        };
        if conductive {
            adj[e.a].push(e.b);
            adj[e.b].push(e.a);
        }
    }
    let mut reach = vec![false; n_nodes.max(1)];
    reach[0] = true;
    let mut stack = vec![0usize];
    while let Some(u) = stack.pop() {
        for &w in &adj[u] {
            if !reach[w] {
                reach[w] = true;
                stack.push(w);
            }
        }
    }
    reach
}

/// Solve the network (DC operating point, PWM averaged). `n_nodes` includes
/// ground (node 0). Element currents are written back into `els`.
pub fn solve(n_nodes: usize, els: &mut [Element]) -> Solution {
    let pwm = els.iter().any(|e| matches!(e.duty, Some(d) if d > 0.0 && d < 1.0));
    let k_phases = if pwm { 16 } else { 1 };
    let mut avg = vec![0.0; n_nodes.max(1)];
    let mut phases: Vec<Vec<f64>> = Vec::new();
    for e in els.iter_mut() {
        e.i = 0.0;
        e.ipk = 0.0;
        e.i2 = 0.0;
    }
    for k in 0..k_phases {
        let mode = Mode::Dc((k as f64 + 0.5) / k_phases as f64);
        let v = solve_point(n_nodes, els, mode, 60);
        for e in els.iter_mut() {
            let i = current(e, &v, mode);
            e.i += i / k_phases as f64;
            e.i2 += i * i / k_phases as f64;
            if i.abs() > e.ipk.abs() {
                e.ipk = i;
            }
        }
        for (j, x) in v.iter().enumerate() {
            avg[j] += x / k_phases as f64;
        }
        if k_phases > 1 {
            phases.push(v.clone());
        }
    }
    let reach = reachable(n_nodes, els);
    Solution { v: avg, reach, phases }
}

/// Result of a transient run.
pub struct Transient {
    /// Node voltages averaged over the run.
    pub v: Vec<f64>,
    pub reach: Vec<bool>,
    /// Recorded samples, flat: for each sample `[t, V(probe 0), V(probe 1), ...]`.
    pub samples: Vec<f64>,
}

/// Step the circuit from time `t0` for `steps` steps of `dt` seconds.
/// Capacitor voltages / inductor currents (`e.v`, and `e.v_prev` one step
/// earlier) carry the state in and out. When `dt` differs from the previous
/// run, pass `v_prev` = NaN (one backward-Euler step restarts BDF2). Element `i`, `i2`
/// and `ipk` are averaged / peaked over the run. Every `decim` steps the
/// voltages of the `probes` nodes are recorded.
pub fn transient(n_nodes: usize, els: &mut [Element], t0: f64, dt: f64, steps: usize, probes: &[usize], decim: usize) -> Transient {
    let steps = steps.max(1);
    let decim = decim.max(1);
    let mut avg = vec![0.0; n_nodes.max(1)];
    let mut samples = Vec::with_capacity((steps / decim + 1) * (probes.len() + 1));
    for e in els.iter_mut() {
        e.i = 0.0;
        e.ipk = 0.0;
        e.i2 = 0.0;
    }
    let w = 1.0 / steps as f64;
    for k in 0..steps {
        let t = t0 + (k + 1) as f64 * dt;
        let mode = Mode::Tran { t, dt };
        let v = solve_point(n_nodes, els, mode, 20);
        for e in els.iter_mut() {
            let i = current(e, &v, mode);
            e.i += i * w;
            e.i2 += i * i * w;
            if i.abs() > e.ipk.abs() {
                e.ipk = i;
            }
            if e.kind == Kind::Capacitor {
                e.v_prev = e.v;
                e.v = v[e.a] - v[e.b];
            } else if e.kind == Kind::Inductor {
                e.v_prev = e.v;
                e.v = i;
            }
        }
        for (j, x) in v.iter().enumerate() {
            avg[j] += x * w;
        }
        if (k + 1) % decim == 0 {
            samples.push(t);
            for &p in probes {
                samples.push(if p < v.len() { v[p] } else { 0.0 });
            }
        }
    }
    let reach = reachable(n_nodes, els);
    Transient { v: avg, reach, samples }
}

// ---------------------------------------------------------------------------
// WebAssembly / C ABI.
//
// Input: 15 f64 per element:
//   [kind(0=R,1=V,2=D,3=C,4=L), a, b, r (C: farads, L: henries), v (C: its voltage, L: its current),
//    duty(<0 = none), hasCond, c1, c2, condMin, wave(0 none,1 sine,2 square,3 triangle,4 saw), freq, amp,
//    x (diode: zener voltage, 0 = none; L: winding resistance),
//    vPrev (C/L: v one step earlier, NaN = unknown)]
// wb_solve output: V[n_nodes], i[n_els], ipk[n_els], i2[n_els], reach[n_nodes] (1.0 / 0.0),
//         K (number of PWM phases, 0 if none), then K × V[n_nodes] phase voltages
// wb_transient output: V[n_nodes], i[n_els], ipk[n_els], i2[n_els], reach[n_nodes],
//         state[n_els] (capacitor voltage / inductor current at the end), state_prev[n_els]
//         (the same one step earlier), S (sample count),
//         then S × [t, V(probe)...]. Probe nodes are written with wb_probes.
// ---------------------------------------------------------------------------

pub const STRIDE: usize = 15;

thread_local! {
    static INPUT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static PROBES: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
}

/// Make room for `len` f64 values of input and return a pointer to them.
#[no_mangle]
pub extern "C" fn wb_input(len: usize) -> *mut f64 {
    INPUT.with(|b| {
        let mut b = b.borrow_mut();
        b.clear();
        b.resize(len, 0.0);
        b.as_mut_ptr()
    })
}

/// Make room for `len` probe node numbers (for `wb_transient`).
#[no_mangle]
pub extern "C" fn wb_probes(len: usize) -> *mut f64 {
    PROBES.with(|b| {
        let mut b = b.borrow_mut();
        b.clear();
        b.resize(len.max(1), 0.0);
        b.as_mut_ptr()
    })
}

pub fn decode(buf: &[f64], n_els: usize, n_nodes: usize) -> Vec<Element> {
    let node = |x: f64| -> usize { (x.max(0.0) as usize).min(n_nodes.saturating_sub(1)) };
    (0..n_els)
        .map(|k| {
            let s = &buf[k * STRIDE..(k + 1) * STRIDE];
            let kind = match s[0] as i32 {
                1 => Kind::Source,
                2 => Kind::Diode,
                3 => Kind::Capacitor,
                4 => Kind::Inductor,
                _ => Kind::Resistor,
            };
            let r = match kind {
                Kind::Capacitor => s[3].max(1e-15),
                Kind::Inductor => s[3].max(1e-12),
                _ => s[3].max(1e-6),
            };
            let mut e = Element::new(kind, node(s[1]), node(s[2]), r, s[4]);
            if s[5] >= 0.0 {
                e.duty = Some(s[5]);
            }
            if s[6] != 0.0 {
                e.cond = Some((node(s[7]), node(s[8]), s[9]));
            }
            e.wave = match s[10] as i32 {
                1 => Wave::Sine,
                2 => Wave::Square,
                3 => Wave::Triangle,
                4 => Wave::Sawtooth,
                _ => Wave::None,
            };
            e.freq = s[11];
            e.amp = s[12];
            e.x = s[13].max(0.0);
            e.v_prev = s[14];
            e
        })
        .collect()
}

/// Solve the elements previously written with `wb_input`. Returns a pointer
/// to the output buffer (see layout above); its length is `wb_output_len()`.
#[no_mangle]
pub extern "C" fn wb_solve(n_nodes: usize, n_els: usize) -> *const f64 {
    let n_nodes = n_nodes.max(1);
    let mut els = INPUT.with(|b| decode(&b.borrow(), n_els, n_nodes));
    let sol = solve(n_nodes, &mut els);
    OUTPUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        o.extend_from_slice(&sol.v);
        o.extend(els.iter().map(|e| e.i));
        o.extend(els.iter().map(|e| e.ipk));
        o.extend(els.iter().map(|e| e.i2));
        o.extend(sol.reach.iter().map(|&r| if r { 1.0 } else { 0.0 }));
        o.push(sol.phases.len() as f64);
        for ph in &sol.phases {
            o.extend_from_slice(ph);
        }
        o.as_ptr()
    })
}

/// Run a transient simulation of the elements written with `wb_input`
/// (see layout above). Returns a pointer to the output buffer.
#[no_mangle]
pub extern "C" fn wb_transient(n_nodes: usize, n_els: usize, t0: f64, dt: f64, steps: usize, n_probes: usize, decim: usize) -> *const f64 {
    let n_nodes = n_nodes.max(1);
    let mut els = INPUT.with(|b| decode(&b.borrow(), n_els, n_nodes));
    let probes: Vec<usize> = PROBES.with(|b| b.borrow().iter().take(n_probes).map(|&x| (x.max(0.0) as usize).min(n_nodes - 1)).collect());
    let tr = transient(n_nodes, &mut els, t0, dt, steps, &probes, decim);
    OUTPUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        o.extend_from_slice(&tr.v);
        o.extend(els.iter().map(|e| e.i));
        o.extend(els.iter().map(|e| e.ipk));
        o.extend(els.iter().map(|e| e.i2));
        o.extend(tr.reach.iter().map(|&r| if r { 1.0 } else { 0.0 }));
        o.extend(els.iter().map(|e| if matches!(e.kind, Kind::Capacitor | Kind::Inductor) { e.v } else { 0.0 }));
        o.extend(els.iter().map(|e| if matches!(e.kind, Kind::Capacitor | Kind::Inductor) { e.v_prev } else { f64::NAN }));
        o.push((tr.samples.len() / (probes.len() + 1)) as f64);
        o.extend_from_slice(&tr.samples);
        o.as_ptr()
    })
}

#[no_mangle]
pub extern "C" fn wb_output_len() -> usize {
    OUTPUT.with(|o| o.borrow().len())
}

#[no_mangle]
pub extern "C" fn wb_version() -> u32 {
    5
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() < tol
    }

    #[test]
    fn voltage_divider() {
        // 5 V source on node 1, 1k/1k divider to ground, midpoint node 2.
        let mut els = vec![Element::source(1, 0, 5.0, 0.01), Element::resistor(1, 2, 1000.0), Element::resistor(2, 0, 1000.0)];
        let s = solve(3, &mut els);
        assert!(close(s.v[2], 2.5, 1e-3), "v2 = {}", s.v[2]);
        assert!(close(els[1].i, 0.0025, 1e-5));
    }

    #[test]
    fn led_with_resistor() {
        // 5 V pin (25 ohm) -> 220 ohm -> red LED (1.8 V, 15 ohm) -> GND
        let mut els = vec![Element::source(1, 0, 5.0, 25.0), Element::resistor(1, 2, 220.0), Element::diode(2, 0, 1.8, 15.0)];
        solve(3, &mut els);
        let expected = (5.0 - 1.8) / (25.0 + 220.0 + 15.0);
        assert!(close(els[2].i, expected, 1e-6), "i = {}", els[2].i);
    }

    #[test]
    fn reversed_led_is_off() {
        let mut els = vec![Element::source(1, 0, 5.0, 25.0), Element::resistor(1, 2, 220.0), Element::diode(0, 2, 1.8, 15.0)];
        solve(3, &mut els);
        assert_eq!(els[2].i, 0.0);
    }

    #[test]
    fn pwm_averages_current() {
        let mut src = Element::source(1, 0, 5.0, 25.0);
        src.duty = Some(0.5);
        let mut els = vec![src, Element::resistor(1, 2, 220.0), Element::diode(2, 0, 1.8, 15.0)];
        let s = solve(3, &mut els);
        let full = (5.0 - 1.8) / 260.0;
        assert!(close(els[2].i, full / 2.0, 1e-6));
        assert!(close(els[2].ipk, full, 1e-6));
        assert!(close(els[2].i2, full * full / 2.0, 1e-9));
        // phase voltages: node 1 is high (~5 V minus drop) in the first half, 0 V in the second
        assert_eq!(s.phases.len(), 16);
        assert!(s.phases[0][1] > 4.5);
        assert!(s.phases[15][1].abs() < 1e-6);
    }

    #[test]
    fn floating_node_detected() {
        let mut els = vec![Element::source(1, 0, 5.0, 0.1), Element::resistor(1, 2, 100.0), Element::resistor(3, 4, 100.0)];
        let s = solve(5, &mut els);
        assert!(s.reach[2]);
        assert!(!s.reach[3] && !s.reach[4]);
    }

    #[test]
    fn conditional_source() {
        // TMP36-like output only active when supply node 1 is above 2.6 V.
        let mut out = Element::source(2, 0, 0.75, 50.0);
        out.cond = Some((1, 0, 2.6));
        let mut els = vec![Element::source(1, 0, 3.3, 0.1), out, Element::resistor(2, 0, 1e6)];
        let s = solve(3, &mut els);
        assert!(close(s.v[2], 0.75, 1e-3));
        els[0].v = 1.0;
        let s = solve(3, &mut els);
        assert!(s.v[2].abs() < 1e-3);
    }

    #[test]
    fn c_abi_roundtrip() {
        let data = [
            1.0, 1.0, 0.0, 0.01, 5.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, f64::NAN, //
            0.0, 1.0, 2.0, 1000.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, f64::NAN, //
            0.0, 2.0, 0.0, 1000.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, f64::NAN,
        ];
        let p = wb_input(data.len());
        unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), p, data.len()) };
        let out = wb_solve(3, 3);
        let len = wb_output_len();
        assert_eq!(len, 3 + 3 + 3 + 3 + 3 + 1);
        let o = unsafe { std::slice::from_raw_parts(out, len) };
        assert!(close(o[2], 2.5, 1e-3));
        assert_eq!(o[12], 1.0);
    }

    #[test]
    fn rc_charging_follows_exponential() {
        // 5 V step through 1 kΩ into 1 µF: tau = 1 ms. After 1 ms, Vc = 5(1 - 1/e) = 3.16 V.
        let mut els = vec![Element::source(1, 0, 5.0, 0.01), Element::resistor(1, 2, 1000.0), Element::capacitor(2, 0, 1e-6)];
        let tr = transient(3, &mut els, 0.0, 1e-6, 1000, &[2], 100);
        assert!(close(els[2].v, 5.0 * (1.0 - (-1.0f64).exp()), 0.01), "vc = {}", els[2].v);
        assert_eq!(tr.samples.len(), 10 * 2);
        // the state carries over: another 4 ms brings it close to 5 V
        transient(3, &mut els, 1e-3, 1e-6, 4000, &[], 1);
        assert!(els[2].v > 4.9);
    }

    #[test]
    fn rc_lowpass_attenuates_at_cutoff() {
        // Sine of 1 V peak at f = 1/(2πRC) into an RC low-pass: output peak = 1/√2.
        let r = 1000.0;
        let c = 1e-6;
        let f = 1.0 / (2.0 * std::f64::consts::PI * r * c);
        let mut els = vec![Element::wave_source(1, 0, Wave::Sine, f, 1.0, 0.0, 0.01), Element::resistor(1, 2, r), Element::capacitor(2, 0, c)];
        let dt = 1.0 / f / 2000.0;
        transient(3, &mut els, 0.0, dt, 20000, &[], 1); // settle for 10 periods
        let tr = transient(3, &mut els, 10.0 / f, dt, 2000, &[2], 1);
        let peak = tr.samples.chunks(2).map(|s| s[1]).fold(0.0f64, f64::max);
        assert!(close(peak, std::f64::consts::FRAC_1_SQRT_2, 0.01), "peak = {}", peak);
    }

    #[test]
    fn half_wave_rectifier() {
        // 5 V peak sine, diode, 1 kΩ load: output never goes negative, peak ≈ 5 - 0.7.
        let mut els = vec![Element::wave_source(1, 0, Wave::Sine, 50.0, 5.0, 0.0, 0.01), Element::diode(1, 2, 0.7, 1.0), Element::resistor(2, 0, 1000.0)];
        let tr = transient(3, &mut els, 0.0, 1e-5, 2000, &[2], 1);
        let lo = tr.samples.chunks(2).map(|s| s[1]).fold(f64::MAX, f64::min);
        let hi = tr.samples.chunks(2).map(|s| s[1]).fold(f64::MIN, f64::max);
        assert!(lo > -1e-3, "lo = {}", lo);
        assert!(close(hi, 4.3 * 1000.0 / 1001.0, 0.01), "hi = {}", hi);
    }

    #[test]
    fn waveforms() {
        let tri = Element::wave_source(1, 0, Wave::Triangle, 1.0, 2.0, 1.0, 1.0);
        assert!(close(tri.src_at(0.25), 3.0, 1e-9) && close(tri.src_at(0.75), -1.0, 1e-9) && close(tri.src_at(0.0), 1.0, 1e-9));
        let sq = Element::wave_source(1, 0, Wave::Square, 10.0, 1.0, 0.0, 1.0);
        assert!(close(sq.src_at(0.01), 1.0, 1e-9) && close(sq.src_at(0.07), -1.0, 1e-9));
        let mut pwm = Element::source(1, 0, 5.0, 1.0);
        pwm.duty = Some(0.25);
        pwm.freq = 100.0;
        assert!(close(pwm.src_at(0.001), 5.0, 1e-9) && close(pwm.src_at(0.004), 0.0, 1e-9));
    }
    #[test]
    fn zener_regulates() {
        // 12 V through 470 Ω into a 5.1 V zener (cathode to the output): output ≈ 5.1 V.
        let mut els = vec![Element::source(1, 0, 12.0, 0.01), Element::resistor(1, 2, 470.0), Element::zener(0, 2, 0.7, 5.1, 2.0)];
        let s = solve(3, &mut els);
        let i = (12.0 - 5.1) / 472.0;
        assert!(close(s.v[2], 5.1 + i * 2.0, 1e-3), "v = {}", s.v[2]);
        assert!(els[2].rev && close(els[2].i, -i, 1e-5));
        // below Vz it does not conduct
        els[0].v = 3.0;
        let s = solve(3, &mut els);
        assert!(close(s.v[2], 3.0, 1e-3) && !els[2].rev);
        // forward biased it is an ordinary diode
        els[0].v = -5.0;
        let s = solve(3, &mut els);
        assert!(close(s.v[2], -0.7 - (4.3 / 472.0) * 2.0, 1e-3), "v = {}", s.v[2]);
    }

    #[test]
    fn rl_current_rises_exponentially() {
        // 5 V into 100 Ω + 10 mH (Rw = 0): tau = L/R = 100 µs. After tau, i = 50 mA (1 - 1/e).
        let mut els = vec![Element::source(1, 0, 5.0, 0.01), Element::resistor(1, 2, 100.0), Element::inductor(2, 0, 10e-3, 0.0)];
        transient(3, &mut els, 0.0, 1e-7, 1000, &[], 1);
        let want = 0.05 * (1.0 - (-1.0f64).exp());
        assert!(close(els[2].v, want, 5e-4), "i = {}", els[2].v);
        // steady state: the inductor is a short, i = 50 mA
        transient(3, &mut els, 1e-4, 1e-6, 2000, &[], 1);
        assert!(close(els[2].v, 0.05, 1e-4));
        // in a DC solve it is a short through its winding resistance
        let mut dc = vec![Element::source(1, 0, 5.0, 0.01), Element::resistor(1, 2, 100.0), Element::inductor(2, 0, 10e-3, 0.0)];
        let s = solve(3, &mut dc);
        assert!(s.v[2].abs() < 1e-3);
    }

    #[test]
    fn lc_resonates() {
        // Charged 1 µF capacitor across 1 mH: oscillates at 1/(2π√LC) ≈ 5.03 kHz.
        let mut c = Element::capacitor(1, 0, 1e-6);
        c.v = 1.0;
        let mut els = vec![c, Element::inductor(1, 0, 1e-3, 0.0)];
        let tr = transient(2, &mut els, 0.0, 1e-7, 4000, &[1], 1);
        let v: Vec<f64> = tr.samples.chunks(2).map(|s| s[1]).collect();
        let crossings = v.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        assert_eq!(crossings, 2, "two full periods in 0.4 ms"); // 0.4 ms × 5.03 kHz ≈ 2.01
    }

    #[test]
    fn lc_keeps_its_energy() {
        // Nearly lossless LC (Rw is clamped to 1 mΩ) with a coarse step of 1/50 period:
        // after 10 periods the amplitude must stay close to 1 V. Backward Euler loses
        // 0.8 % per step (about 98 % after 10 periods); BDF2 loses about 0.4 % per
        // period at this coarse step (like a Q of ~800), and far less with finer steps.
        let (l, c) = (1e-3f64, 1e-6f64);
        let period = 2.0 * std::f64::consts::PI * (l * c).sqrt();
        let mut cap = Element::capacitor(1, 0, c);
        cap.v = 1.0;
        let mut els = vec![cap, Element::inductor(1, 0, l, 0.0)];
        let dt = period / 50.0;
        transient(2, &mut els, 0.0, dt, 450, &[], 1);
        let tr = transient(2, &mut els, 450.0 * dt, dt, 50, &[1], 1);
        let peak = tr.samples.chunks(2).map(|s| s[1].abs()).fold(0.0f64, f64::max);
        assert!(peak > 0.95 && peak < 1.01, "peak after 10 periods = {}", peak);
    }

    #[test]
    fn rlc_underdamped_overshoot() {
        // The "RLC underdamped ringing" example: 0 -> 5 V step through 50 Ω (generator)
        // + 10 Ω + 10 mH (12 Ω winding) into 100 nF, with the editor's 4 µs step.
        // Analytic: R = 72 Ω, ζ = R/2·√(C/L) ≈ 0.114, overshoot e^(-πζ/√(1-ζ²)) ≈ 70 %.
        let (r, l, rw, c) = (60.0f64, 10e-3f64, 12.0f64, 100e-9f64);
        let zeta = (r + rw) / 2.0 * (c / l).sqrt();
        let want = 5.0 * (1.0 + (-std::f64::consts::PI * zeta / (1.0 - zeta * zeta).sqrt()).exp());
        let mut els = vec![Element::source(1, 0, 5.0, r), Element::inductor(1, 2, l, rw), Element::capacitor(2, 0, c)];
        let tr = transient(3, &mut els, 0.0, 4e-6, 250, &[2], 1);
        let peak = tr.samples.chunks(2).map(|s| s[1]).fold(0.0f64, f64::max);
        assert!((peak - want).abs() / want < 0.01, "peak = {} V, analytic {} V", peak, want);
    }

    #[test]
    fn stiff_capacitor_does_not_ring() {
        // 100 µF straight across a 5 V source with 0.01 Ω (τ = 1 µs) and a 100 µs step:
        // the voltage must settle without alternating (the trapezoidal rule would ring).
        let mut els = vec![Element::source(1, 0, 5.0, 0.01), Element::capacitor(1, 0, 100e-6), Element::resistor(1, 0, 1000.0)];
        let tr = transient(2, &mut els, 0.0, 1e-4, 20, &[1], 1);
        let settled = 5.0 * 1000.0 / 1000.01;
        for s in tr.samples.chunks(2).skip(2) {
            assert!((s[1] - settled).abs() < 1e-3, "v = {}", s[1]);
        }
    }
}

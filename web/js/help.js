'use strict';
// Help menu pages. Parts and boards are listed from the live part library so the help stays accurate.
(function (WB) {
  WB.VERSION = '1.0.0-beta.6';
  const esc = (s) => WB.esc(s);
  const k = (s) => s.split('+').map((x) => `<kbd>${esc(x)}</kbd>`).join('+');

  const TOPICS = [
    ['guide', 'Getting started'],
    ['shortcuts', 'Shortcuts'],
    ['parts', 'Parts & boards'],
    ['reference', 'Arduino functions'],
    ['trouble', 'Troubleshooting'],
    ['about', 'About'],
  ];

  // ---------------------------------------------------------------- About page
  const LINKS = {
    site: 'https://isboonto.github.io/jumpercraft/',
    repo: 'https://github.com/isboonto/jumpercraft',
    releases: 'https://github.com/isboonto/jumpercraft/releases',
    issues: 'https://github.com/isboonto/jumpercraft/issues',
    contribute: 'https://github.com/isboonto/jumpercraft/blob/main/CONTRIBUTING.md',
    sponsor: 'https://github.com/sponsors/isboonto',
  };
  // GitHub pages for feedback (Help menu and About page). The problem form gets the version and
  // platform filled in (only those two: no personal data or project content is sent).
  WB.githubLink = (kind) => {
    const base = 'https://github.com/isboonto/jumpercraft/';
    const platform = WB.isDesktop ? 'Desktop app (Windows)' : 'Web version';
    if (kind === 'bug') return base + 'issues/new?template=bug_report.yml&version=' + encodeURIComponent(WB.VERSION) + '&platform=' + encodeURIComponent(platform);
    if (kind === 'feature') return base + 'issues/new?template=feature_request.yml';
    if (kind === 'contribute') return LINKS.contribute;
    if (kind === 'sponsor') return LINKS.sponsor;
    return LINKS.issues;
  };
  const LOGO = '<svg viewBox="0 0 24 24" width="56" height="56" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="10" r="1.3" fill="currentColor"/><circle cx="11" cy="10" r="1.3" fill="currentColor"/><circle cx="15" cy="14" r="1.3" fill="currentColor"/><path d="M7 10 C 9 16, 13 16, 15 14" fill="none" stroke="#ffb020" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const ICON = {
    heart: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill="currentColor"/></svg>',
    globe: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    code: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 7 4 12l5 5M15 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bug: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 8a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0v-3a4 4 0 0 1 4-4Zm0 0V5m-6 8H3m18 0h-3M6.5 8.5 4.5 7m13 1.5 2-1.5M6.5 17.5 4.5 19m13-1.5 2 1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };
  function aboutHeader() {
    const P = WB.PARTS;
    const types = Object.keys(P);
    const boards = types.filter((t) => P[t].board).length;
    const parts = types.filter((t) => !P[t].board && !P[t].holes && !P[t].annotation).length;
    const examples = (WB.EXAMPLES || []).length;
    const link = (key, icon, label, primary) => `<a class="about-btn${primary ? ' ' + (primary === true ? 'primary' : primary) : ''}" href="${esc(LINKS[key] || WB.githubLink(key))}" target="_blank" rel="noopener" data-ext>${ICON[icon] || WB.icon(icon)}<span>${label}</span></a>`;
    return `
      <div class="about-hero">
        <div class="about-logo">${LOGO}</div>
        <div class="about-title">
          <h2>JumperCraft</h2>
          <p>Breadboard designer and electronics simulator for Arduino and analog circuits</p>
          <div class="about-badges"><span class="badge accent">Version ${esc(WB.VERSION)}</span><span class="badge">${WB.isDesktop ? 'Desktop app' : 'Web version'}</span><span class="badge">MIT License</span></div>
        </div>
      </div>
      <div class="about-links">
        ${link('site', 'globe', 'Website', true)}${link('repo', 'code', 'Source code')}${link('releases', 'download', 'Download')}${link('bug', 'bug', 'Report a problem')}${link('feature', 'bulb', 'Suggest a feature')}${link('contribute', 'pr', 'Contribute')}${link('sponsor', 'heart', 'Support JumperCraft', 'sponsor')}
      </div>
      <div class="about-cards">
        <div class="about-card"><h4>Author</h4><p class="big">Sudchai Boonto</p><p class="muted small">© 2026 · released under the MIT License — free to use, change and share.</p></div>
        <div class="about-card"><h4>Engine</h4><p>Circuit solver: <b>${esc(WB.Native.kind)}</b></p><p>Running as: <b>${WB.isDesktop ? 'Windows app (Rust · Tauri · WebView2)' : 'web page in your browser'}</b></p></div>
        <div class="about-card"><h4>Library</h4><div class="about-stats"><div><b>${boards}</b><span>boards</span></div><div><b>${parts}</b><span>parts</span></div><div><b>${examples}</b><span>examples</span></div></div></div>
      </div>`;
  }
  // "What's new in X" blocks become collapsible sections, the newest one open.
  function changelogSections(html) {
    let first = true;
    return html.replace(/<h3>(What's new in [^<]+)<\/h3>\s*<ul>([\s\S]*?)<\/ul>/g, (m, title, items) => {
      const open = first; first = false;
      return `<details class="about-ver"${open ? ' open' : ''}><summary>${title.replace("What's new in ", 'Version ')}</summary><ul>${items}</ul></details>`;
    });
  }

  const pages = {
    guide: () => `
      <h2>Getting started</h2>
      <p class="sub">Build a circuit on the breadboard, write a sketch, and simulate it — in six steps.</p>
      <ol>
        <li><b>Add a board.</b> Drag an <b>Arduino UNO Q</b> (or another board) from <b>Parts → Boards</b> onto the canvas, or double-click it. A project has one board.</li>
        <li><b>Add parts.</b> Drag parts (LEDs, resistors, buttons, sensors, Modulino…) onto the canvas or the breadboard, or double-click them in the parts list. Quicker: point at the workspace and just <b>type the part name</b> (for example <i>led</i> or <i>res</i>) — a search box opens; press Enter to drop the part at the mouse. Legs placed in breadboard holes connect automatically — connected holes turn green.</li>
        <li><b>Wire it up.</b> Click a pin or hole to start a jumper wire, then click another pin to finish. The wire is <b>auto-routed</b> into a tidy right-angle path around parts (and re-routes when you move a part). Click empty space on the way to place joints yourself instead; the wire still runs at right angles through your joints (also when you drag a joint later). Wires are always kept at right angles; drag any piece of a wire to move it. Right-click a wire (on a touch screen: press and hold) to auto-route it again, add or remove a joint, or change its color; <b>Tidy wires</b> (toolbar) re-routes everything at once. Prefer the look of real jumpers? Choose <b>File → New wires → Curved</b>: new wires are drawn as smooth curves, and you bend one by dragging it anywhere (each bend adds a joint the curve passes through). Right-click any wire to <b>Make curved</b> or <b>Make straight</b>.
          Modulino modules have a <b>Connect to board</b> button that wires them to the Qwiic connector for you.</li>
        <li><b>Configure parts.</b> Double-click a part to change its settings (resistance, LED color, sensor values…).</li>
        <li><b>Write the sketch.</b> Type Arduino code in the <b>Sketch</b> panel. Errors are checked as you type — a red badge shows the problem and the line turns red. Press <b>✓ Verify</b> to check explicitly.</li>
        <li><b>Simulate.</b> Press <b>▶ Start simulation</b> (${k('Ctrl+Enter')}). While it runs, press buttons, flip switches and drag knobs or sensors on the canvas; output appears in the <b>Serial Monitor</b>. Hover any pin to read its voltage. The circuit is locked while simulating — stop it to edit.</li>
      </ol>
      <h3>Electronics without a microcontroller</h3>
      <p>You don't need a board: build a circuit from the <b>Instruments</b> and <b>Passive</b> parts and press <b>▶ Start simulation</b>. Try the examples under <b>DC circuits</b>, <b>Transients</b> and <b>AC circuits &amp; filters</b> in the Examples menu (RC filter, rectifier, capacitor charging).</p>
      <ul>
        <li><b>Function generator</b>: a sine, square, triangle or sawtooth signal from 0.1 Hz to 1 MHz, with amplitude (V peak-to-peak) and DC offset. Its front panel has clickable buttons, also while simulating: the four <b>waveform</b> keys; <b>FREQUENCY</b> ÷10 / − / + / ×10 (− and + step through 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 in each decade); <b>AMPLITUDE</b> − +; <b>OFFSET</b> − + (0.5 V steps); and <b>OUTPUT ON/OFF</b>, which disconnects the output. For an exact value (for example 159 Hz), double-click it and type it in. It has a 50 Ω output, like a real one.</li>
        <li><b>Dual power supply</b>: two separate 0–30 V channels, each with its own current limit. Click the buttons on its panel (−1 / −.1 / +.1 / +1 V, I − / I +). <b>TRACK</b> joins CH1 − to CH2 + inside and makes CH2 follow CH1, so you get a ± supply (for example ±12 V for an LM741) with the middle terminal as ground. <b>SWP</b> (sweep) makes a channel move from a start voltage to its set voltage over the sweep time and repeat: press it once for a <b>ramp</b>, twice for <b>up and down</b>, a third time for steady DC again. The start voltage and sweep time are in its settings (double-click it). With the scope in X-Y mode a sweep draws I–V curves — see the example <i>LED I–V curve: DC sweep on the dual power supply</i>.</li>
        <li><b>DC power supply</b>: 0–30 V; set it with the buttons on its panel (−1 / −.1 / +.1 / +1 V, and I + / I − for the current limit), also while simulating. It limits the current to the value you set: when that is reached the <b>CC</b> light turns on and the voltage drops.</li>
        <li><b>Capacitors</b> (ceramic and electrolytic) and <b>diodes</b> are simulated through time, so RC charging, filters, rectifiers and smoothing behave as in real life. Electrolytic capacitors are polarized: the stripe (−) side must go to the lower voltage.</li>
        <li><b>Inductors</b> (10 µH – 1 H, with their winding resistance) resist changes in current: an RL circuit shows the exponential rise and the voltage kick when the current is interrupted (add a flyback diode across a coil that gets switched off). Together with a capacitor an inductor makes an LC resonant circuit.</li>
        <li><b>Zener diodes</b> (3.3, 5.1, 9.1, 12 V) work like a diode forwards and conduct in reverse above their zener voltage. Connected in reverse (band to the higher voltage) with a series resistor they hold a steady voltage — a simple regulator.</li>
        <li><b>Transistors and chips</b> (Parts → Semiconductors and ICs): NPN / PNP transistors (2N2222, BC547, 2N3906, BC557), the TIP120 power transistor, N- and P-channel MOSFETs, voltage regulators (7805, 7809, 7812, LM1117-3.3), the 4N35 optocoupler, the 555 timer, op-amps (LM741, LM358), 74HC logic gates (00, 02, 04, 08, 32, 86), the 74HC595 shift register, the CD4511 7-segment decoder and the L293D motor driver. Chips need power on their VCC and GND pins. <b>Double-click a chip or transistor to see its pinout</b> (pin numbers and names); hovering a pin also shows its name. Try <b>Examples → Semiconductors &amp; ICs → 555 timer LED blinker</b>: its oscilloscope shows the output and the timing capacitor charging between 1/3 and 2/3 of the supply.</li>
        <li><b>Controlled sources</b> (Parts → Controlled sources): ideal <b>VCVS</b> (Vout = μ·Vin), <b>VCCS</b> (Iout = g·Vin), <b>CCVS</b> (Vout = r·Iin) and <b>CCCS</b> (Iout = β·Iin), like SPICE E, G, H and F sources. Voltage control is measured between C+ and C− (no current drawn); current control is the current flowing in at S+ and out at S−. The output pushes current out of O+, through the load, back into O−. Gains can be negative. They have no supply rails, so an unstable circuit runs away instead of clipping. Try the examples under <b>Examples → Controlled sources</b>.</li>
        <li><b>Notes</b>: press <b>📝 Note</b> in the toolbar (or the <b>N</b> key) to put a sticky note on the canvas, then type your text. Double-click a note to edit it; choose its color, text size and width. Notes are saved with the project, ignored by the circuit and the parts list, and can be edited while the simulation runs.</li>
        <li><b>X-Y mode</b>: press <b>X-Y</b> on the scope to plot CH1 (sideways) against CH2 (up and down) instead of against time — for V-I curves of diodes and transistors, or Lissajous figures. CH1 ▼▲ then moves the picture left/right. <b>INV</b> turns a channel upside down. To put the scope ground in the middle of a circuit, set the function generator's <b>COM terminal</b> to <i>Floating</i> (see <b>Electronics · Diode V-I curve</b>).</li>
        <li>The function generator's <b>COM</b> and the scope's <b>GND</b> are earthed, as on real bench instruments: they are always connected to each other (and to the board's GND). Clipping the scope ground to a point that isn't ground shorts it, just like in a real lab. The multimeter and the power supply are floating.</li>
      </ul>
      <h3>Measuring with the multimeter and oscilloscope</h3>
      <ul>
        <li><b>Multimeter</b> (Parts → Instruments): connect the <b>COM</b> jack to ground or the low side and <b>VΩ</b> to the point you measure. Click a mode on the dial (or the knob, to step to the next one) to choose <b>V</b> (DC voltage), <b>V~</b> (AC voltage, rms), <b>A</b> (DC current), <b>A~</b> (AC current, rms) and <b>Ω</b> (resistance).
          For current, put the meter <b>in series</b> using the <b>A</b> and <b>COM</b> jacks. Measure resistance with the circuit unpowered. Readings appear while the simulation runs; in DC modes PWM and AC signals read as their average, like a real meter. AC modes show the rms of the changing part only.</li>
        <li><b>Voltmeter</b> and <b>Ammeter (compact)</b> (Parts → Instruments): small panel meters with two pins 0.1" apart, so they plug straight into the breadboard and stay on the circuit — handy when you want to watch several values at once. Connect the voltmeter <b>across</b> the part (+ to the point you measure, − to the low side; 10 MΩ input). Put the ammeter <b>in series</b> — current flows in at + and out at − (50 mΩ shunt). Click the <b>DC / AC</b> badge to switch between DC and true-RMS AC readings.</li>
        <li><b>Bode plotter</b> (Parts → Instruments): measures a circuit's <b>frequency response</b>. Connect <b>OUT</b> to the circuit's input (instead of a function generator), <b>IN</b> to its output and <b>COM</b> to ground, then press <b>SWEEP</b> — no need to start the simulation. It steps a small sine from START to STOP and plots the <b>gain in dB</b> (yellow) and the <b>phase</b> (cyan, dashed) on a logarithmic frequency axis, and marks the <b>−3 dB</b> points (orange). Each frequency is simulated until it has settled, so op-amps, transistors and diodes behave as in the real circuit; keep the test signal small (100 mV) so amplifiers don't clip. Other generators are set to zero while it sweeps.</li>
        <li><b>Data plotter</b> (Parts → Instruments): records up to four voltages over the <b>whole run</b> and draws them in the <b>Plotter</b> tab next to the Serial Monitor. Each channel measures between its <b>+</b> and <b>−</b> probe; leave − open to measure against GND. Set the <b>⏱ simulation time</b> in the toolbar (for example 5 s or 50 ms) and the simulation stops by itself after it; the graph keeps the whole recording. Point at the graph to read the values at that moment, press <b>CSV</b> to save the data (time in seconds, one column per channel) for MATLAB, Julia, Python or Excel, and <b>↻ Run again</b> (in the Plotter tab or the toolbar) to start over. Circuits with capacitors are recorded at the solver's exact time steps. Try <b>Examples → Electronics → Data plotter: capacitor charging curve</b>.</li>
        <li><b>Logic analyzer</b> (Parts → Instruments): eight digital channels shown as timing diagrams — ideal for fast signals such as <code>shiftOut()</code>, I²C-style clock and data, servo pulses and button bounce. HIGH means above the threshold (1.4 V by default). <b>TIME/DIV</b> sets the time base (1 µs to 1 s); <b>TRIG</b> picks the channel whose rising or falling (<b>EDGE</b>) edge starts the screen, or OFF for a rolling display. Each Arduino call takes about 4 µs of simulated time, as on a real UNO, so a byte sent with shiftOut() takes about 100 µs. Measured frequencies (and PWM duty) appear at the right of each channel.</li>
        <li><b>Oscilloscope</b>: connect <b>CH1</b>/<b>CH2</b> to the signals (and <b>GND</b> to circuit ground). Its front panel has clickable buttons, also while simulating:
          <ul>
            <li><b>TIME / DIV − +</b>: time base, 10 µs to 1 s per division.</li>
            <li><b>CH1 / CH2 − +</b>: volts per division for each channel, 10 mV to 20 V.</li>
            <li><b>DC / AC</b>: coupling. <b>DC</b> shows the whole signal; <b>AC</b> removes the DC part, so you can zoom in on small ripple riding on a DC voltage (for example a power-supply ripple). In AC the readout shows the rms of the AC part and the DC level in brackets.</li>
            <li><b>▼ POS ▲</b>: moves the channel's 0 V level (the coloured arrow at the screen edge) up or down.</li>
            <li><b>AUTO</b>: measures the signals and picks a time base that shows 2–5 periods, plus volts/div and position so each trace fills the screen.</li>
          </ul>
          The same settings are in the inspector and the settings dialog (double-click the scope away from its buttons). The trace triggers on a rising edge of CH1, so repeating signals stand still. Below the screen: average (or AC rms), peak-to-peak and frequency.
          For fast signals the analog part of the simulation runs in <b>slow motion</b> (shown on the scope and next to the run time) so every point can be calculated.</li>
      </ul>
      <h3>Saving your work</h3>
      <p>Your work is saved automatically. Use <b>Save</b> / <b>Open</b> to keep projects as <b>JumperCraft project files (.wbproj)</b> — in the desktop app you can also double-click a .wbproj file to open it — and older .json projects still open; and <b>Export</b> for a picture of the breadboard (PNG/SVG), the sketch (.ino), a <b>schematic diagram</b> (an A4 sheet drawn from your circuit with standard symbols, a parts list and a title block — save it as SVG or PNG), or a netlist and parts list. The schematic draws the <b>wires</b>: parts are placed next to what they connect to and joined by right-angle wires; a dot marks joined wires, wires that cross without a dot are not connected, ⏚ is ground and × a pin that is not connected. Switch to <b>Net labels</b> in the preview for the label style (pins with the same label are connected).</p>
      <p><b>File → Export → SPICE netlist for LTspice</b> writes your circuit as a <b>.cir</b> file for LTspice (File → Open, then Run), using the same component models JumperCraft simulates plus BJT, MOSFET and op-amp models; the oscilloscope sets the <code>.tran</code> time. Digital parts (555, 74HC logic, displays) are listed as comments with the net of each pin. Export while the simulation runs to include the Arduino pins' present state (HIGH, LOW or PWM).</p>
      <h3>Learn from examples</h3>
      <p>The <b>Examples</b> menu has ready-made projects: blink, buttons, fading, potentiometer, traffic light, servo, LED matrix, melody, temperature, ultrasonic distance, PIR motion, Modulino, and analog electronics with the function generator, power supply and scope.</p>`,

    shortcuts: () => {
      const rows = [
        ['Editing', [
          ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste parts (paste lands at the mouse pointer)'],
          ['Ctrl+D', 'Duplicate selection'],
          ['Ctrl+drag a part', 'Drag out a copy'],
          ['R / Shift+R', 'Rotate selection clockwise / counter-clockwise'],
          ['Type a name (mouse over the workspace)', 'Search all parts and add the chosen one at the mouse — e.g. type <i>led</i>, <i>res</i>, <i>555</i> or <i>note</i>, then Enter'],
          ['N (mouse away from the workspace)', 'Add a note in the middle of the view'],
          ['Delete', 'Delete selection'],
          ['Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z)', 'Undo / redo changes to the circuit — also right after editing a value in the Inspector; works with any keyboard layout (e.g. Thai). In the sketch editor and text boxes they undo your typing'],
          ['Ctrl+A', 'Select everything'],
          ['Shift+click / Shift+drag', 'Add to selection / box select'],
          ['Double-click a part', 'Open its settings'],
          ['Right-click', 'Context menu (parts and wires)'],
          ['Press and hold (touch)', 'The same menu on a phone or tablet'],
          ['Esc', 'Cancel wire / close menu or dialog / clear selection'],
        ]],
        ['Wiring', [
          ['Click pin → click pin', 'Draw a jumper wire'],
          ['Drag from a pin', 'Draw a wire by dragging'],
          ['Click empty space while wiring', 'Add a joint'],
          ['Double-click a wire', 'Add a joint there'],
          ['Drag a joint / wire end', 'Move the joint / re-attach the wire'],
          ['Right-click a wire', 'Auto-route it, make it curved or straight, add/remove joints, change color'],
          ['Drag a curved wire', 'Bend it there (File → New wires → Curved)'],
          ['Tidy wires (toolbar)', 'Auto-route the selected wires, or all wires'],
        ]],
        ['View', [
          ['Mouse wheel / pinch', 'Zoom'],
          ['Two-finger swipe', 'Pan (touchpad)'],
          ['Drag background / hold Space + drag', 'Pan'],
          ['Ctrl+= / Ctrl+− / Ctrl+0', 'Zoom in / out / fit everything'],
          ['Space (tap)', 'Fit everything in view (F also works with the mouse away from the workspace)'],
        ]],
        ['Sketch & simulation', [
          ['Ctrl+Enter', 'Start / stop simulation'],
          ['Ctrl+B', 'Show / hide the code panel (the circuit is refitted to the new space)'],
          ['Ctrl+Shift+B', 'Show / hide the parts panel (◧ Parts: the parts list and the inspector on the left)'],
          ['Drag a category heading', 'Reorder the parts list (right-click a heading: move up / down / to top, or reset the order)'],
          ['Ctrl+S / Ctrl+O', 'Save / open project (● in the title and on Save = unsaved changes; JumperCraft asks before replacing or closing them)'],
          ['Ctrl+P', 'Print: choose the breadboard view, schematic, instrument screens, sketch and parts list, then print or save as PDF (File → Print…)'],
          ['Tab', 'Indent in the code editor'],
          ['F1', 'Open this help'],
        ]],
      ];
      return `<h2>Keyboard &amp; mouse shortcuts</h2><p class="sub">On a Mac, use Cmd instead of Ctrl.</p><div class="cols">` +
        rows.map(([title, list]) => `<div><h3>${title}</h3><table>${list.map(([a, b]) => `<tr><td style="white-space:nowrap">${a.split(' / ').map((s) => (/[A-Z][a-z]*\+|^[A-Z]$|^F\d|^Esc$|^Delete$|^Tab$/.test(s) ? k(s) : esc(s))).join(' / ')}</td><td>${esc(b)}</td></tr>`).join('')}</table></div>`).join('') +
        '</div>';
    },

    parts: () => {
      let html = '<h2>Parts &amp; boards</h2><p class="sub">Everything in the parts list. Double-click a part on the canvas to see its settings; hover a pin to see what it does.</p>';
      html += '<h3>Boards</h3><table><tr><th>Board</th><th>Logic</th><th>Notes</th></tr>';
      for (const t in WB.BOARDS) {
        const b = WB.BOARDS[t];
        html += `<tr><td>${esc(b.label)}</td><td>${b.vcc} V</td><td>${esc(b.info)}${b.qwiic ? ' <span class="tag">Qwiic</span>' : ''}${b.matrix ? ` <span class="tag">${b.matrix.w}×${b.matrix.h} matrix</span>` : ''}</td></tr>`;
      }
      html += '</table><div class="cols">';
      for (const cat of WB.CATEGORIES) {
        if (cat === 'Boards') continue;
        const list = Object.keys(WB.PARTS).filter((t) => WB.PARTS[t].category === cat);
        if (!list.length) continue;
        html += `<div><h3>${esc(cat)}</h3><ul>${list.map((t) => {
          const d = WB.PARTS[t];
          const how = d.interact === 'press' ? 'click to press' : d.interact === 'toggle' ? 'click to toggle' : d.interact === 'knob' ? 'drag to adjust' : d.interact === 'buttons' ? 'click A/B/C' : d.interact === 'panel' ? 'click its front-panel buttons' : '';
          return `<li>${esc(d.label)}${how ? ` <span class="tag">${how}</span>` : ''}</li>`;
        }).join('')}</ul></div>`;
      }
      return html + '</div>';
    },

    reference: () => `
      <h2>Arduino functions &amp; libraries</h2>
      <p class="sub">The simulator runs the common Arduino language subset. Unsupported things are reported as errors before the sketch runs.</p>
      <div class="cols">
        <div><h3>Digital &amp; analog I/O</h3><p><code>pinMode</code> (<code>INPUT</code>, <code>OUTPUT</code>, <code>INPUT_PULLUP</code>, <code>INPUT_PULLDOWN</code>), <code>digitalWrite</code>, <code>digitalRead</code>, <code>analogRead</code>, <code>analogWrite</code> (PWM pins ~3 5 6 9 10 11), <code>analogReadResolution</code>, <code>analogWriteResolution</code></p></div>
        <div><h3>Time</h3><p><code>delay</code>, <code>delayMicroseconds</code>, <code>millis</code>, <code>micros</code></p></div>
        <div><h3>Sound &amp; pulses</h3><p><code>tone</code>, <code>noTone</code>, <code>pulseIn</code> (HC-SR04 echo)</p></div>
        <div><h3>Interrupts</h3><p><code>attachInterrupt</code> (<code>RISING</code>, <code>FALLING</code>, <code>CHANGE</code>), <code>detachInterrupt</code>, <code>digitalPinToInterrupt</code></p></div>
        <div><h3>Math</h3><p><code>map</code>, <code>constrain</code>, <code>min</code>, <code>max</code>, <code>abs</code>, <code>sq</code>, <code>sqrt</code>, <code>pow</code>, <code>sin</code>/<code>cos</code>/<code>tan</code>, <code>random</code>, <code>randomSeed</code>, <code>bitRead</code>/<code>bitWrite</code>/<code>bitSet</code>/<code>bitClear</code>, <code>lowByte</code>/<code>highByte</code></p></div>
        <div><h3>Serial Monitor</h3><p><code>Serial.begin</code>, <code>print</code>, <code>println</code> (with <code>DEC</code>/<code>HEX</code>/<code>BIN</code> or decimals), <code>printf</code>, <code>write</code>, <code>available</code>, <code>read</code>, <code>readString</code>, <code>readStringUntil</code>, <code>parseInt</code>, <code>parseFloat</code>. On the UNO Q, <code>Monitor</code> works the same way.</p></div>
        <div><h3>Language</h3><p>Variables and arrays (including 2-D), <code>const</code>, <code>#define</code>, functions, <code>static</code> locals, <code>if</code>/<code>switch</code>/<code>for</code>/<code>while</code>/<code>do</code>, range-for, <code>String</code>, casts, integer division like C.</p></div>
      </div>
      <h3>Libraries (<code>#include</code>)</h3>
      <table>
        <tr><td><code>Servo.h</code></td><td><code>attach</code>, <code>write</code>, <code>writeMicroseconds</code>, <code>read</code>, <code>detach</code></td></tr>
        <tr><td><code>LiquidCrystal.h</code></td><td>LCD 16×2 (parallel): <code>LiquidCrystal lcd(rs, en, d4, d5, d6, d7)</code>; <code>begin</code>, <code>print</code>, <code>write</code>, <code>setCursor</code>, <code>clear</code>, <code>home</code>, <code>createChar</code>, <code>cursor</code>/<code>blink</code>, <code>display</code>/<code>noDisplay</code>, <code>scrollDisplayLeft/Right</code>, <code>autoscroll</code>. The LCD is found by its RS and E wiring.</td></tr>
        <tr><td><code>LiquidCrystal_I2C.h</code>, <code>Wire.h</code></td><td>LCD 16×2 with the I2C backpack (set the LCD's Interface to I2C, wire SDA/SCL): <code>init</code>/<code>begin</code>, <code>backlight</code>/<code>noBacklight</code> and the methods above</td></tr>
        <tr><td><code>Adafruit_NeoPixel.h</code></td><td><code>Adafruit_NeoPixel strip(n, pin, NEO_GRB + NEO_KHZ800)</code>; <code>begin</code>, <code>show</code>, <code>setPixelColor</code>, <code>Color</code>, <code>ColorHSV</code>, <code>fill</code>, <code>clear</code>, <code>setBrightness</code>, <code>numPixels</code></td></tr>
        <tr><td><code>Keypad.h</code></td><td><code>Keypad(makeKeymap(keys), rowPins, colPins, rows, cols)</code>; <code>getKey</code>, <code>waitForKey</code>, <code>isPressed</code>, <code>getState</code></td></tr>
        <tr><td><code>SoftwareSerial.h</code></td><td><code>SoftwareSerial nex(rx, tx)</code>; <code>begin</code>, <code>print</code>, <code>write</code>, <code>available</code>, <code>read</code>, <code>listen</code>. Talks to a <b>Nextion touch display</b> wired to those pins (display TX → rx, display RX → tx). Send Nextion instructions ending with three <code>0xFF</code> bytes, e.g. <code>t0.txt="hi"</code>, <code>n0.val=5</code>, <code>page 1</code>, <code>get n0.val</code>; touch events come back as <code>0x65 page id event FF FF FF</code>. A Nextion on D0/D1 works with <code>Serial</code> too (Mega: <code>Serial1</code>–<code>3</code>). The screen design is the display's <b>Screen layout</b> setting.</td></tr>
        <tr><td><code>TFT_eSPI.h</code> (CYD board)</td><td>The CYD's 320×240 screen: <code>TFT_eSPI tft = TFT_eSPI();</code> <code>init</code>, <code>setRotation</code>, <code>fillScreen</code>, <code>drawPixel</code>, <code>drawLine</code>, <code>drawRect</code>/<code>fillRect</code>, <code>drawRoundRect</code>/<code>fillRoundRect</code>, <code>drawCircle</code>/<code>fillCircle</code>, <code>drawEllipse</code>, <code>drawTriangle</code>/<code>fillTriangle</code>, <code>drawArc</code>, <code>drawWideLine</code>, gradients, <code>setTextColor</code>, <code>setTextSize</code>, <code>setTextFont</code> (1, 2, 4, 6, 7, 8), <code>setTextDatum</code>, <code>setTextPadding</code>, <code>print</code>, <code>drawString</code>, <code>drawCentreString</code>, <code>drawNumber</code>, <code>drawFloat</code>, <code>textWidth</code>, <code>color565</code>, <code>TFT_RED</code> … colours. GPIO21 is the backlight (<code>init()</code> switches it on). FreeFonts, sprites and images are not simulated.</td></tr>
        <tr><td><code>XPT2046_Touchscreen.h</code>, <code>SPI.h</code> (CYD board)</td><td>The CYD's touch panel: <code>XPT2046_Touchscreen ts(33, 36)</code>, <code>ts.begin(spi)</code>, <code>setRotation</code>, <code>touched()</code>, <code>getPoint()</code> → <code>TS_Point</code> with raw <code>x</code>, <code>y</code>, <code>z</code> (about 200–3700 and 240–3800; map them to pixels). Press and drag on the screen while the simulation runs. <code>SPIClass</code> / <code>SPI</code> exist so the usual CYD code compiles.</td></tr>
        <tr><td><code>Arduino_GFX_Library.h</code> (CYD 7" board)</td><td>The 7" CYD's 800×480 screen, as in the board's usual setup: <code>Arduino_ESP32RGBPanel *rgbpanel = new Arduino_ESP32RGBPanel(…)</code> and <code>Arduino_RGB_Display *gfx = new Arduino_RGB_Display(800, 480, rgbpanel, 0, true)</code> (the panel pins and timing are fixed on this board, so any values are accepted). <code>gfx-&gt;begin</code>, <code>fillScreen</code>, <code>drawPixel</code>, <code>drawLine</code>, rectangles, rounded rectangles, circles, ellipses, triangles, <code>fillArc</code>/<code>drawArc</code>, <code>setCursor</code>, <code>setTextColor</code>, <code>setTextSize</code>, <code>print</code>/<code>println</code>/<code>printf</code>, <code>setRotation</code>, <code>width</code>/<code>height</code>, <code>color565</code>, colours <code>RED</code> … (also <code>RGB565_RED</code> …). The backlight is GPIO2 — switch it on with <code>digitalWrite(2, HIGH)</code> or dim it with <code>ledcWrite</code>. <code>setFont</code> fonts and bitmaps are not simulated.</td></tr>
        <tr><td><code>TAMC_GT911.h</code> (CYD 7" board)</td><td>The 7" CYD's capacitive touch: <code>TAMC_GT911 ts = TAMC_GT911(19, 20, 18, 38, 800, 480)</code>, <code>begin</code>, <code>setRotation</code>, <code>read()</code>, then <code>isTouched</code>, <code>touches</code>, <code>points[0].x</code> / <code>.y</code>. With <code>ROTATION_NORMAL</code> the point is mirrored, as on the real board: <code>map(ts.points[0].x, 800, 0, 0, 799)</code>.</td></tr>
        <tr><td>ESP32 functions (CYD boards)</td><td><code>ledcAttach</code>/<code>ledcWrite</code> (core 3) and <code>ledcSetup</code>/<code>ledcAttachPin</code> (core 2), <code>ledcWriteTone</code>, <code>dacWrite</code> (25, 26), 12-bit <code>analogRead</code>, <code>Serial2.begin(baud, SERIAL_8N1, rx, tx)</code>, <code>ESP.getFreeHeap()</code> and friends, <code>esp_random()</code>. Wi-Fi and Bluetooth are not simulated.</td></tr>
        <tr><td><code>IRremote.h</code></td><td><code>IrReceiver.begin(pin)</code>, <code>decode()</code>, <code>decodedIRData.command</code>, <code>resume()</code> (and the older <code>IRrecv</code> / <code>decode_results</code>); NEC codes from the IR remote part</td></tr>
        <tr><td><code>Arduino_LED_Matrix.h</code></td><td>UNO Q / UNO R4 WiFi built-in matrix: <code>begin</code>, <code>loadFrame</code>, <code>renderBitmap</code>, <code>draw</code>, <code>loadSequence</code>, <code>play</code>, <code>clear</code>, plus <code>setPixel(x, y)</code></td></tr>
        <tr><td><code>Modulino.h</code></td><td><code>Modulino.begin()</code>; Buttons (<code>update</code>, <code>isPressed</code>, <code>setLeds</code>), Buzzer (<code>tone</code>, <code>noTone</code>), Pixels (<code>set</code>, <code>clear</code>, <code>show</code>, <code>RED</code>/<code>GREEN</code>/<code>BLUE</code>/<code>VIOLET</code>/<code>WHITE</code>, <code>ModulinoColor</code>), Knob (<code>get</code>, <code>set</code>, <code>isPressed</code>), Distance (<code>available</code>, <code>get</code>), Movement (<code>update</code>, <code>getX/Y/Z</code>), Thermo (<code>getTemperature</code>, <code>getHumidity</code>)</td></tr>
        <tr><td><code>Arduino_RouterBridge.h</code></td><td>UNO Q only: <code>Bridge.begin</code>, <code>Bridge.provide</code> (call it from the Serial Monitor with <code>@name args</code>), <code>Bridge.call</code>/<code>notify</code> (logged, Linux side not simulated), <code>Monitor</code></td></tr>
        <tr><td>Standard headers</td><td><code>math.h</code>, <code>stdlib.h</code>, <code>string.h</code>, <code>stdint.h</code> … (accepted, nothing extra needed)</td></tr>
      </table>
      <h3>Not simulated</h3>
      <p>User-defined <code>class</code>/<code>struct</code>, pointers, templates, and libraries not listed above (for example Wire/I²C by hand, SPI, WiFi). On the UNO Q only the microcontroller side runs; the Linux/Python side is not simulated.</p>`,

    trouble: () => `
      <h2>Troubleshooting</h2>
      <h3>My LED doesn't light up</h3>
      <ul>
        <li>Check the direction: the <b>anode (+, longer leg)</b> goes toward the pin, the <b>cathode (−)</b> toward GND. Hover the legs to see which is which.</li>
        <li>Make sure the circuit reaches <b>GND</b>. Hover a pin while simulating: it shows the voltage, or "floating" if nothing drives it.</li>
        <li>Did you call <code>pinMode(pin, OUTPUT)</code>? Without it the pin only turns on its weak pull-up (you get a warning).</li>
        <li>Holes in the same <b>column</b> (a–e or f–j) are connected; holes in the same row are not. The center gap separates the two halves.</li>
      </ul>
      <h3>"LED burned out" or "pin is carrying … mA"</h3>
      <p>Put a 220 Ω – 1 kΩ resistor in series with the LED. Stop and restart the simulation to replace a burned LED.</p>
      <h3>digitalRead returns random values</h3>
      <p>The input is <b>floating</b>. Use <code>pinMode(pin, INPUT_PULLUP)</code> (pressed = LOW) or add a pull-down resistor.</p>
      <h3>Modulino "not found on the I2C bus"</h3>
      <p>Select the module and press <b>Connect to board</b>, or wire its GND, 3.3V, SDA and SCL to the board yourself. Call <code>Modulino.begin()</code> and the module's <code>begin()</code> in <code>setup()</code>.</p>
      <h3>A compilation error I don't understand</h3>
      <p>Look at the red badge above the code and the highlighted line. Common causes: a missing <code>;</code>, a misspelled name (the message suggests the right one), different capitalization (<code>serial</code> vs <code>Serial</code>), or a library that isn't supported (see <b>Arduino functions &amp; libraries</b>).</p>
      <h3>I can't move or wire parts</h3>
      <p>The circuit is locked while the simulation runs. Press <b>■ Stop</b> first.</p>
      <h3>No sound from the buzzer</h3>
      <p>Check the 🔊 button in the toolbar. A <b>passive</b> buzzer needs <code>tone()</code>; an <b>active</b> one beeps with <code>digitalWrite(HIGH)</code> (change the type in its settings).</p>
      <h3>The scope says "not connected" or shows a flat line</h3>
      <p>Connect <b>CH1</b>/<b>CH2</b> to a hole or pin that is part of the circuit. Check the time base: a 50 Hz signal needs about 5–10 ms/div, a 10 kHz one about 20–50 µs/div. If the trace runs off the screen, change the volts per division.</p>
      <h3>"Analog slow-motion" next to the run time</h3>
      <p>Fast signals (high frequency, or a fast scope time base) need many tiny time steps. When the computer can't calculate them in real time, the analog part runs slower than real time so the result stays correct. A slower time base or lower frequency brings it back to real time.</p>
      <h3>Zoom / pan with a touchpad</h3>
      <p>Pinch to zoom and swipe with two fingers to pan. Holding <kbd>Ctrl</kbd> while scrolling always zooms.</p>`,

    about: () => `
      ${aboutHeader()}
      <h3 class="about-h">What's new</h3>
      <h3>What's new in 1.0 (beta)</h3>
      <ul>
        <li>1.0.0-beta.6: <b>Data plotter</b> (Instruments) — records up to four voltages, each between a <b>+</b> and a <b>−</b> probe (leave − open to measure against GND), over the whole run, and draws them in the new <b>Plotter</b> tab next to the Serial Monitor. Point at the graph to read values; <b>CSV</b> saves the data for MATLAB, Julia, Python or Excel. New <b>⏱ simulation time</b> in the toolbar: the simulation stops by itself after that time (it is saved with the project). <b>↻ Run again</b> (toolbar and Plotter tab) starts over from the beginning. New example: <i>Data plotter: capacitor charging curve</i>.</li>
        <li>1.0.0-beta.5 (update): <b>Feedback on GitHub</b> in the Help menu — <b>Report a problem…</b> (the form on GitHub already has your JumperCraft version filled in), <b>Suggest a feature…</b> and <b>Contribute (pull requests)…</b>, and <b>Support JumperCraft ♥</b> to donate through GitHub Sponsors; the same buttons are on this About page. While the simulation runs, clicking a wire shows only its two ends, not its joints (wires can't be changed while it runs). The DC power supply's readings fit inside its screen again.</li>
        <li>1.0.0-beta.5: a <b>General</b> category at the top of the parts list with the parts used most often (Arduino UNO R3, half breadboard, resistor, LEDs, pushbutton, switch, potentiometer, LDR, buzzer, servo, capacitors, diode, transistor, battery, multimeter) — they are still in their own categories too. The <b>Inspector</b> shows a <b>picture</b> of the selected part next to its <b>standard schematic symbol</b>.</li>
        <li>1.0.0-beta.4: <b>Curved wires</b>, as in Fritzing — choose <b>File → New wires → Curved</b>, then drag a wire anywhere to bend it; right-click a wire to make it curved or straight. Curved wires follow their pins when you move a part and are left alone by Tidy wires. <b>Nicer parts</b>: LEDs (clear epoxy with the die inside), pushbuttons (steel cover and rivets), the slide switch, and batteries — now drawn as AA cells in a holder (1.5–6 V), an 18650 Li-ion cell (3.7 V) or a 9 V battery with snap terminals — plus shading on resistors, capacitors and diodes.</li>
        <li>1.0.0-beta.3: a <b>Support JumperCraft ♥</b> button on this About page — if JumperCraft helps you or your students, you can support its development through GitHub Sponsors.</li>
        <li>1.0.0-beta.2: <b>Wirebench is now JumperCraft.</b> The old name turned out to be used already by another electronics tool. Your work carries over: the autosave, settings, “My examples” (the old Wirebench examples folder is still read) and <code>.wbproj</code> project files all keep working, and installing JumperCraft removes the old Wirebench program. The web version moved to <b>isboonto.github.io/jumpercraft</b>; the old address forwards there.</li>
        <li>1.0.0-beta.1: the first <b>1.0 beta</b> — everything from 0.1 to 0.12 in one release, and the first with ready-made Windows installers on GitHub (Releases, marked “Pre-release”). New in it: the <b>dual power supply</b> can <b>sweep</b> — its <b>SWP</b> button makes a channel ramp from a start voltage to its set voltage (or up and down) over a sweep time, for I–V curves on the scope in X-Y mode; new example <i>LED I–V curve: DC sweep on the dual power supply</i>. Both power supplies are now drawn twice as large, so their buttons and displays are easier to use. <b>Auto-routing</b>: wires no longer end in a slanted piece after you move a part or drag a wire's end — they are routed again (wires you shaped yourself keep their joints and get right-angle corners), and older projects with the power supplies open with tidy wires. Auto-routing can no longer be switched off (the “Auto-route new wires” menu item and “Remove joints” are gone), so wires always run at right angles. <b>Phones and tablets</b>: on a phone the toolbar wraps onto more rows (so <b>Run</b> is always visible), the circuit fills the screen and the Parts and Code panels slide over it; on an upright iPad the toolbar also wraps instead of hiding Rotate and Tidy wires. On iPad and iPhone a part now moves with <b>one finger</b> (Safari used to take one-finger drags for scrolling). <b>Breadboards</b> have a grip frame round the holes, so they are easy to move with a finger. <b>Wires</b> can be dragged at any point: a horizontal piece moves up or down, a vertical one left or right, and the wire stays at right angles and on its pins. On a touch screen, <b>press and hold</b> (half a second) opens the same menu as a right-click — also on iPad, which had no menu before — and a wire's menu is the same wherever you press it (<b>Remove joint</b> takes the nearest joint). Please report anything that doesn't work as expected; fixes come as further betas before 1.0.0.</li>
      </ul>
      <h3>What's new in 0.12</h3>
      <ul>
        <li>0.12.1: the <b>web version loads about four times faster</b>. Since 0.9.1 its security policy had made Chrome and Edge download its 18 program files one after another; they now download all at once, together with the circuit solver. The Examples menu has a new <b>Touch screens: Nextion &amp; CYD</b> heading for the Nextion and CYD examples.</li>
        <li>0.12.0: new board <b>CYD 7"</b> (ESP32-8048S070C, ESP32-S3). Its 800×480 screen works with the <b>Arduino_GFX</b> library (the usual <code>Arduino_ESP32RGBPanel</code> / <code>Arduino_RGB_Display</code> setup compiles as it is; <code>gfx-&gt;fillScreen</code>, shapes, arcs, text, rotation) and its capacitive touch with <b>TAMC_GT911</b> (<code>read()</code>, <code>isTouched</code>, <code>points[0]</code>). The backlight is GPIO2: the screen stays dark until the sketch switches it on (a hint says how), and <code>ledcWrite</code> dims it. Connectors P1–P4 (IO17–20, IO11–13, TX/RX); BOOT button. New example: <i>CYD 7" · touch screen</i>.</li>
      </ul>
      <h3>What's new in 0.11</h3>
      <ul>
        <li>0.11.0: new board <b>CYD — ESP32 Cheap Yellow Display</b> (ESP32-2432S028R). Its 2.8" 320×240 screen works with the <b>TFT_eSPI</b> library (shapes, arcs, gradients, text in fonts 1/2/4/6/7/8, rotation; GPIO21 is the backlight) and its touch panel with <b>XPT2046_Touchscreen</b> — press and drag on the screen while the simulation runs. On the board: RGB LED (4/16/17, LOW = on), light sensor (34 — drag it to change the light), BOOT button (0), speaker (26); connectors P1, P3 and CN1 to wire your own parts. ESP32 functions: <code>ledcAttach</code>/<code>ledcWrite</code> (and the older <code>ledcSetup</code>/<code>ledcAttachPin</code>), <code>dacWrite</code>, 12-bit <code>analogRead</code>, <code>Serial2.begin(baud, SERIAL_8N1, rx, tx)</code>. Clear errors for input-only pins and pins used by the screen. Two new examples.</li>
      </ul>
      <h3>What's new in 0.10</h3>
      <ul>
        <li>0.10.0: new part <b>Nextion 7" touch display</b> (Displays). Design its screen in the <b>Screen layout</b> setting — one object per line with the Nextion Editor's names (text, number, float, button, toggle, checkbox, slider, progress bar, gauge, waveform; several pages) — and drive it with the real Nextion instructions (<code>t0.txt="hi"</code>, <code>n0.val=5</code>, <code>page 1</code>, <code>get</code>, <code>vis</code>, <code>cls</code>/<code>fill</code>/<code>line</code>/<code>cir</code>/<code>xstr</code>, <code>add</code> …, each ending with three <code>0xFF</code>). Touch it while the simulation runs: it sends real touch events (<code>0x65 page id event</code>), <code>get</code> replies and error codes. New library <b>SoftwareSerial.h</b>; a Nextion on D0/D1 also works with <code>Serial</code> (Mega: <code>Serial1</code>–<code>3</code>). Warnings for swapped TX/RX, a different baud rate and wrong attribute names. New example: <i>UNO R3 · Nextion 7" touch display</i>.</li>
      </ul>
      <h3>What's new in 0.9</h3>
      <ul>
        <li>0.9.2: <b>Export → Schematic diagram</b> and <b>Print</b> always start with the connections drawn as <b>wires</b>. Net labels is still one click away (“Connections: Wires | Net labels”), but is no longer remembered — a remembered choice made it look as if the wires had disappeared.</li>
        <li>0.9.1: <b>security</b> — project files are checked when they are opened, so a shared or downloaded project can no longer slip script into JumperCraft through a part setting or wire colour; sketches can't reach outside the simulator (names starting with <code>__</code>, <code>this</code>, <code>.constructor</code> and similar JavaScript internals are refused — none of them are Arduino C++); and a content security policy blocks injected scripts in both the desktop app and the web version. Print: a new <b>Schematic: Wires / Net labels</b> choice (default Wires) — the printout no longer follows the last choice in the schematic export.</li>
        <li>0.9.0: <b>File → Print…</b> (Ctrl+P). Choose the breadboard view, schematic, instrument screens (each instrument enlarged, exactly as it shows now — for lab reports), sketch with line numbers, and parts list &amp; netlist; add a title and your name; pick A4 or Letter, landscape or portrait. Each section starts a new page. Choose “Save as PDF” as the printer to get a PDF.</li>
        <li>New oscilloscopes start with 0 V in the middle of the screen for both channels.</li>
      </ul>
      <h3>What's new in 0.8</h3>
      <ul>
        <li>0.8.0: two new instruments. The <b>Bode plotter</b> sweeps a small sine from START to STOP and plots gain (dB) and phase against frequency, with the −3 dB points marked — it simulates every frequency through the full solver, so op-amps and transistors work too (SPICE export: an <code>.ac</code> analysis). The 8-channel <b>logic analyzer</b> draws timing diagrams with an edge trigger and records every edge of fast sequences such as <code>shiftOut()</code>. New examples: <i>Bode plot: RC low-pass and Sallen-Key filters</i> and <i>Logic analyzer: watch shiftOut() and a 74HC595</i>.</li>
      </ul>
      <h3>What's new in 0.7</h3>
      <ul>
        <li>0.7.3: one <b>File</b> menu for New, Open, Save, Export and Theme, and small line icons in front of every menu item (File, Help, right-click and category menus) and on the toolbar's edit buttons.</li>
        <li>0.7.2: fixed the <b>◧ Parts</b> button — hiding the left panel showed a black area instead of a wider canvas. <b>Tidy wires</b> and auto-route now have a wire-route icon instead of ✨.</li>
        <li>0.7.1: <b>unsaved changes</b> are tracked — a ● in the title and on Save, and JumperCraft asks <i>Save / Don't save / Cancel</i> before New, Open, an example, a double-clicked project or closing the window (the desktop window title now shows the project name). New <b>compact Voltmeter and Ammeter</b> (Parts → Instruments): small panel meters that plug into the breadboard, with DC / AC (true RMS) readings. The toolbar now fits any window width without buttons overlapping; on narrower windows New / Open / Save move into a <b>File</b> menu.</li>
        <li>0.7.0: <b>rearrange the part categories</b> — drag a category heading up or down the parts list, or right-click it for Move to top / up / down / bottom and Reset category order; your order is remembered. Opening or closing the <b>code panel</b> or the parts panel now <b>refits the circuit</b> to the space left.</li>
      </ul>
      <h3>What's new in 0.6</h3>
      <ul>
        <li>0.6.9: projects are saved as <b>JumperCraft project files (.wbproj)</b>, named after the project, with a header (format, version, date, board) and one line per part and wire; in the desktop app double-clicking a .wbproj file opens it. Older .json projects still open.</li>
        <li>0.6.8: a new <b>About</b> page — version and platform at a glance, links to the website, source code, downloads and issue tracker (opened in your browser), author, engine and library cards, and this changelog in collapsible sections.</li>
        <li>0.6.7: circuit warnings stay on screen at least 4 seconds after the problem last occurred (then fade out) instead of flashing; warnings that differ only in a value update in place.</li>
        <li>0.6.6: <b>Export → SPICE netlist for LTspice</b> (.cir, same component models as the simulator); Arduino boards in the schematic are full symbols with every pin (PWM, RX/TX, SDA/SCL marked); every dialog has a close button at the top right.</li>
        <li>0.6.5: the schematic now draws the <b>wires</b> — parts are placed next to what they connect to and joined by right-angle wires with junction dots; the net-label style is still available in the preview.</li>
        <li>0.6.4: <b>Export → Schematic diagram</b> — an A4/A3 schematic sheet drawn from your circuit, with standard symbols, net labels, a parts list and a title block; save it as SVG or PNG.</li>
        <li>0.6.3: <b>Ctrl+Z / Ctrl+Y</b> undo and redo now also work right after editing a value in the Inspector, and with non-Latin keyboard layouts such as Thai (all Ctrl shortcuts do); "Nothing to undo" is shown when there is nothing left.</li>
        <li>0.6.2: new board <b>Arduino Mega 2560</b> — 54 digital pins, A0–A15, Serial1–3, six interrupts — with an LED chaser example (pins 22–29, speed knob on A8); the <b>74HC595</b> example has an oscilloscope showing outputs Q0 and Q1.</li>
        <li>0.6.1: pinouts are drawn on a light, datasheet-style background so the chip and pin names are easy to read in both themes.</li>
        <li>0.6.0: <b>pinouts</b> — double-click a chip (555, op-amps, 74HC logic, 74HC595, CD4511, L293D, 4N35) or a transistor / MOSFET / regulator to see its pin diagram with pin numbers and names; the <b>555 timer</b> example has an oscilloscope showing the output and the timing capacitor (1/3 to 2/3 of the supply).</li>
      </ul>
      <h3>What's new in 0.5</h3>
      <ul>
        <li>0.5.10: wires drawn through your own joints now run at <b>right angles</b> through every joint (also while dragging or after removing a joint); slanted ground jumpers in the examples are laid out at right angles too.</li>
        <li>0.5.9: <b>type to add</b> — point at the workspace and type a part name (e.g. <i>led</i>, <i>res</i>, <i>555</i>); a search box opens and Enter drops the part at the mouse. Tap <b>Space</b> to fit the whole circuit in view (hold Space and drag to pan).</li>
        <li>0.5.8: <b>notes</b> — put sticky notes with your own text on the canvas (<b>📝 Note</b> in the toolbar, or the <b>N</b> key); choose color, text size and width; saved with the project and editable while simulating. The installer now upgrades older versions installed under the previous publisher name.</li>
        <li>0.5.7: the oscilloscope shows <b>Vpp and frequency for small signals</b> too (below 20 mV), with three-digit readings such as 17.4 mVpp; AUTO also picks a fine enough scale for them.</li>
        <li>0.5.6: the <b>Examples</b> menu is grouped by topic (DC circuits, Transients, AC circuits &amp; filters, Semiconductors &amp; ICs, Controlled sources, Arduino …); larger category headings in the parts list; new example: Sallen-Key high-pass filter; released under the <b>MIT License</b>.</li>
        <li>0.5.5: <b>your own examples</b> in the desktop app: projects saved in the examples folder (Examples… → Open examples folder…) appear under <b>My examples</b> without rebuilding; new example: RLC circuit with underdamped ringing; capacitors and inductors use <b>BDF2</b> integration instead of backward Euler, so LC and RLC ringing is no longer damped too quickly; new <b>Controlled sources</b> parts (VCVS, VCCS, CCVS, CCCS) with two examples: Sallen-Key filter and transistor small-signal model.</li>
        <li>0.5.4: the DC power supply has buttons instead of a knob, like the dual supply.</li>
        <li>0.5.3: oscilloscope <b>X-Y mode</b> (CH1 moves the dot sideways, CH2 up and down) and an <b>INV</b> button per channel; the function generator's COM can be set to <b>floating</b>; new <b>trimmer</b> and <b>slide potentiometers</b>; new examples: LM358 amplifier + comparator, diode V-I curve in X-Y mode.</li>
        <li>0.5.2: the <b>LM358 dual op-amp</b> has its own entry in Parts → ICs (next to the LM741); larger text in the parts list.</li>
        <li>0.5.1: integer division works like C (<code>millis() / 1000</code> prints whole seconds, <code>7 / 2</code> is 3, <code>7.0 / 2</code> or a <code>float</code> variable gives 3.5); new <b>dual power supply</b> with tracking (± supply); <b>large breadboard</b> (2 × 63 columns, 8 power rails, 1660 holes); the oscilloscope's input jacks are spaced out like the function generator's.</li>
        <li>About 30 new parts: DC motor, hobby gearmotor, vibration motor, light bulb, relay; 7-segment display, LED bar graph, LCD 16×2 (parallel or I2C), NeoPixel (strip, rings, jewel); 4×4 keypad, DIP switch, IR remote and receiver; 3-pin ultrasonic sensor, photodiode, ambient light sensor (phototransistor), flex sensor, force sensor, gas sensor; NPN/PNP transistors, TIP120, N/P-channel MOSFETs, voltage regulators, optocoupler; 555 timer, op-amps, 74HC logic gates, 74HC595, CD4511, L293D; coin cell, and 1.5 V / 6 V battery options. New part categories: <b>Displays</b>, <b>Semiconductors</b> and <b>ICs</b>.</li>
        <li>New libraries: LiquidCrystal, LiquidCrystal_I2C, Adafruit_NeoPixel, Keypad, IRremote; <code>shiftOut</code> / <code>shiftIn</code> now really clock the pins.</li>
        <li>Themes: <b>File → Theme</b> switches between <b>Default</b> (slate panels, light canvas), <b>Light</b> and <b>Dark</b>. ◐ on the zoom bar still flips just the canvas.</li>
        <li>New examples: LCD, 74HC595, NeoPixel ring, keypad, IR remote, transistor motor driver, 555 blinker.</li>
      </ul>
      <h3>What's new in 0.4</h3>
      <ul>
        <li>New parts: <b>inductor</b> and <b>zener diode</b>, simulated by both the Rust and JavaScript solvers. New examples: zener voltage regulator, RL circuit with a square wave.</li>
        <li>Hide any part of the window: the <b>◧ Parts</b> button (${k('Ctrl+Shift+B')}) hides the whole left panel, and the ▾ button in each header collapses the Parts list, Inspector, Sketch or Serial Monitor on its own. JumperCraft remembers the layout.</li>
        <li>Multimeter: click a mode on the dial to select it directly — also while simulating and while editing.</li>
        <li>0.4.1: click a category name in the parts list (Boards, Passive, Sensors…) to hide or show its parts; ⇕ next to the search box collapses or expands them all. Searching still finds parts in hidden categories.</li>
      </ul>
      <h3>What's new in 0.3.1 and 0.3.2</h3>
      <ul>
        <li>Show or hide the code panel with the <b>&lt;/&gt; Code</b> button or ${k('Ctrl+B')}, for more room on the canvas when you don't need a sketch. A dot on the button means new Serial Monitor output; sketch errors open the panel automatically.</li>
        <li>Bigger oscilloscope with a clickable front panel: DC/AC coupling, separate volts/div and position for each channel, time/div buttons, and <b>AUTO</b>.</li>
        <li>Function generator front panel: waveform keys, frequency, amplitude and offset buttons, and an <b>OUTPUT ON/OFF</b> key.</li>
      </ul>
      <h3>What's new in 0.3</h3>
      <ul>
        <li><b>Function generator</b> (sine, square, triangle, sawtooth), <b>DC power supply</b> with current limit, <b>capacitors</b> and <b>diodes</b>: build analog circuits without a microcontroller.</li>
        <li>A <b>time-domain solver</b>: circuits with capacitors or a function generator are simulated step by step, so filters, RC charging and rectifiers work, and PWM into a capacitor shows real ripple.</li>
        <li>Oscilloscope: time bases down to 10 µs/div, edge trigger, peak-to-peak and frequency readouts. Multimeter: AC volts and amps (rms).</li>
        <li>New examples: RC low-pass filter, half-wave rectifier, capacitor charging, PWM + RC filter.</li>
      </ul>
      <h3>What's new in 0.2</h3>
      <ul>
        <li>Multimeter and 2-channel oscilloscope, wire auto-routing, Modulino modules, more sensors, live code checking with Arduino-style errors (including <code>#include</code>), copy/paste, touchpad zoom, and a Help menu.</li>
      </ul>
      <h3>How it works</h3>
      <p>Circuits are solved with nodal analysis (the Rust <code>wb-core</code> crate), so voltages, currents and LED brightness are calculated, not faked. Circuits with capacitors or a function generator are stepped through time (BDF2 / Gear-2 integration, which keeps LC ringing accurate). Sketches are checked and translated from Arduino C++ and run against a virtual board in real time.</p>
      <h3>Good to know</h3>
      <p>This is a learning and prototyping aid, not the real Arduino compiler or hardware. Always double-check a real circuit before powering it.</p>
      <p class="muted small">Arduino, UNO and Modulino are trademarks of Arduino S.r.l.; JumperCraft is an independent project and is not affiliated with Arduino.</p>`,
  };

  WB.Help = {
    TOPICS,
    render(topic) {
      const page = pages[topic] || pages.guide;
      const nav = `<div class="help-nav">${TOPICS.map(([id, label]) => `<button data-help="${id}"${id === topic ? ' class="on"' : ''}>${esc(label)}</button>`).join('')}</div>`;
      const html = topic === 'about' ? changelogSections(page()) : page();
      return nav + `<div class="help-body${topic === 'about' ? ' about' : ''}">` + html + '</div>';
    },
  };
})(window.WB);

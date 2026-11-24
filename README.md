# Wirebench 0.6

A free, offline breadboard designer and electronics simulator. Inspired by the breadboard view in tools like Fritzing, with built-in simulation for the **Arduino UNO Q** and similar boards, and bench instruments (multimeter, oscilloscope, Bode plotter, logic analyzer, function generator, power supply) for analog circuits with or without a microcontroller.

## Run it

**In a browser, nothing to install:** open **https://isboonto.github.io/wirebench/**. The site is rebuilt from the `web` folder by `.github/workflows/pages.yml` on every push to `main` that changes it.

**Windows installer:** download `Wirebench_<version>_x64-setup.exe` (or the `.msi`) from the [Releases page](https://github.com/isboonto/wirebench/releases).

**Desktop app (Windows, native Rust):** run `target\release\wirebench.exe`. To build it yourself:

```powershell
.\build.ps1
```

This needs Rust (rustup) and the Microsoft Edge WebView2 runtime, which comes with Windows 11. Add `-Installer` to also produce `.msi`/`.exe` installers (that requires `cargo install tauri-cli --version "^2"` first).

**In a browser:** run `node serve.js`, then open http://localhost:8080. You can also open `web/index.html` directly, but then the JavaScript fallback solver is used, because browsers block loading the WebAssembly module from `file://`.

Your work is autosaved. **Save** / **Open** keep projects as **Wirebench project files (`.wbproj`)**, named after your project. In the desktop app these use native Windows file dialogs, and the installer registers `.wbproj` with Windows, so double-clicking a project file opens it in Wirebench. Older `.json` projects still open.

A `.wbproj` file is readable JSON with a header (`"format": "wirebench-project"`, `formatVersion`, the Wirebench version that saved it, the save date, title and board), then one line per part and per wire, and the sketch — so projects work well in Git.

## Architecture

| Layer | Language | Where |
|---|---|---|
| Desktop shell: window, native Open/Save dialogs | Rust (Tauri 2) | `src-tauri/` |
| Circuit solver (nodal analysis, LEDs, PWM, floating-pin detection, time-domain simulation of capacitors, inductors and AC sources, zener diodes) | Rust, compiled to WebAssembly for the UI and linked natively in the app | `crates/wb-core/` |
| Editor UI, part graphics, Arduino sketch runner | JavaScript/HTML | `web/` |

The solver runs as WebAssembly because the sketch runner needs answers *synchronously* (for example, `digitalRead()` must return immediately), and calls from the UI to the Rust process are asynchronous. If the WebAssembly module can't load, a JavaScript copy of the solver is used. Both give identical results on all examples. Run `cargo test -p wb-core` for the solver tests.

New to Wirebench? Open **Help → Getting started** (or press **F1**) in the app. The Help menu also covers shortcuts, the parts and boards list, supported Arduino functions and libraries, and troubleshooting.

## What it does

**Breadboard editor**
- Drag parts from the left panel onto the canvas, or click a part to add it.
- Click a pin or hole to start a wire, then click another pin to finish it. Clicking empty space adds bend points. You can also drag from pin to pin.
- Part legs that sit in breadboard holes connect automatically. Connected holes turn green.
- Hover any pin to highlight everything on the same net. While simulating, hovering also shows the voltage, like a multimeter probe.
- Rotate (**R**), delete (**Del**), duplicate (**Ctrl+D**), undo/redo (**Ctrl+Z/Y**), and box-select (**Shift+drag**).
- Double-click a wire to add a bend. Drag the handles to move bends or re-attach wire ends.
- Export the breadboard as PNG or SVG, the sketch as `.ino`, a **schematic diagram** (A4/A3 sheet with standard symbols and routed wires — or net labels — plus parts list and title block, as SVG or PNG), a **SPICE netlist for LTspice** (`.cir`, same component models as the simulator plus BJT / MOSFET / op-amp models), or a **netlist and parts list**.
- Three themes from **File → Theme**: Default (slate panels, light canvas), Light and Dark.
- Hide the code panel with the **&lt;/&gt; Code** button (**Ctrl+B**) and the parts panel with **◧ Parts** (**Ctrl+Shift+B**), or collapse single sections (Parts, Inspector, Sketch, Serial Monitor) with the ▾ in their headers. Click a category name in the parts list (e.g. Passive) to hide or show its parts; ⇕ collapses or expands them all.

**Boards**

| Board | Logic | Extras simulated |
|---|---|---|
| Arduino UNO Q | 3.3 V | 13×8 LED matrix, `Monitor`, `Bridge` (stub) |
| Arduino UNO R4 WiFi | 5 V | 12×8 LED matrix |
| Arduino UNO R4 Minima | 5 V | |
| Arduino UNO R3 | 5 V | |
| Arduino Nano | 5 V | plugs straight into the breadboard |
| Arduino Mega 2560 | 5 V | 54 digital pins (D0–D53, 15 PWM), A0–A15 (= pins 54–69), `Serial1`–`Serial3`, interrupts 0–5 on pins 2, 3, 21, 20, 19, 18 |

**Instruments**
- **Multimeter:** click a mode on the dial to select it; DC and AC (rms) voltage and current, and resistance.
- **2-channel oscilloscope:** clickable front panel with time/div (10 µs to 1 s), per-channel volts/div (10 mV to 20 V), DC/AC coupling, position and INV, AUTO (autoset), and X-Y mode; edge trigger; average or AC rms / peak-to-peak / frequency readouts.
- **Bode plotter:** OUT drives the circuit with a small sine, IN measures the output; SWEEP measures gain (dB) and phase from 1 Hz to 1 MHz (stepped-sine through the full simulator, so op-amps and transistors work too) and marks the −3 dB points. SPICE export turns it into a `.ac` analysis.
- **8-channel logic analyzer:** timing diagrams of digital signals with an edge trigger; records every edge of fast sequences such as `shiftOut()` (about 4 µs per Arduino call, as on a real UNO), shows PWM, and reads out frequencies.
- **Function generator** (new in 0.3): sine, square, triangle or sawtooth, 0.1 Hz–1 MHz, amplitude and DC offset, 50 Ω output; clickable front panel (waveform keys, frequency ÷10/−/+/×10, amplitude, offset, OUTPUT ON/OFF).
- **Dual power supply** (new in 0.5.1): two independent 0–30 V channels with current limits, or tracking mode for a ± supply.
- **DC power supply** (new in 0.3): 0–30 V with an adjustable current limit (CV/CC), set with front-panel buttons.

The function generator's COM and the scope's GND are earthed like real bench instruments, so they are always connected together (and to the board's GND).

**Parts** (about 70, grouped in collapsible categories):
- *Output:* LED (6 colors), RGB LED, piezo buzzer (with sound), micro servo, DC motor, hobby gearmotor, vibration motor, light bulb, 5 V relay (SPDT).
- *Displays:* 7-segment display (common cathode/anode), 10-LED bar graph, LCD 16×2 (parallel or I2C backpack), NeoPixel strip / ring (12, 16, 24) / jewel / single.
- *Input:* pushbutton, slide switch, potentiometer, slide potentiometer, 4×4 keypad, DIP switch (4/6/8), IR remote.
- *Sensors:* photoresistor, TMP36, PIR, HC-SR04 and 3-pin ultrasonic, soil moisture, tilt switch, IR receiver, photodiode, ambient light sensor (phototransistor), flex sensor, force sensor (FSR), gas sensor.
- *Passive:* resistor (color bands), trimmer potentiometer, ceramic and electrolytic capacitors, diodes (1N4148, 1N4001, Schottky), zener diodes (3.3–12 V), inductors (10 µH – 1 H).
- *Semiconductors:* NPN (2N2222, BC547) and PNP (2N3906, BC557) transistors, TIP120 Darlington, N-channel (IRLZ44N, IRF520) and P-channel (IRF9540N, IRF4905) MOSFETs, voltage regulators (7805, 7809, 7812, LM1117-3.3), 4N35 optocoupler.
- *ICs:* 555 timer, op-amps (LM741 and the dual LM358), 74HC00/02/04/08/32/86 logic gates, 74HC595 shift register, CD4511 BCD-to-7-segment decoder, L293D H-bridge.
- *Controlled sources:* ideal VCVS, VCCS, CCVS and CCCS (SPICE E, G, H, F) for textbook models such as active filters and transistor small-signal models. Current-controlled sources sense the current between their two sense pins; outputs push current out of O+.
- *Notes:* sticky notes with your own text on the canvas (toolbar **📝 Note** or the **N** key); saved with the project, ignored by the circuit.
- *Quick add:* point at the workspace and type a part name (e.g. `led`, `res`, `555`); a search box opens and Enter drops the part at the mouse. Tap **Space** to fit the whole circuit in view (hold Space and drag to pan).
- *Power:* battery (1.5–9 V), CR2032 coin cell; half, full and large (1660-hole) breadboards; Modulino modules.

**Simulation**
- An electrical solver (nodal analysis) computes real voltages and currents. Transistors, MOSFETs, op-amps and chips are piecewise-linear behavioural models (off / active / saturated, output high / low / off) that the solver iterates until they agree with the circuit; clocked chips (74HC595) react to every edge. LED brightness depends on current, PWM is averaged, and pull-ups, pull-downs and voltage dividers work.
- Safety warnings: an LED without a resistor **burns out**, pins over their current limit are flagged, short circuits are detected, and reading a floating input gives random values with a hint.
- While the simulation runs you can press buttons, flip switches, and drag knobs (potentiometer, light level, temperature) directly on the breadboard.
- Circuits without a board (for example battery + switch + LED, or an RC filter driven by the function generator) also simulate.
- **Time-domain simulation (new in 0.3):** circuits with capacitors, inductors or a function generator are stepped through time (BDF2 / Gear-2 integration, as in SPICE, with the step size chosen from the signal frequencies and the scope's time base). RC charging, RL and LC circuits, filters, rectifiers and smoothing behave as in real life, and PWM into a capacitor shows real ripple. When a signal is too fast to calculate in real time, the analog part runs in labelled slow motion.

**Sketch (Arduino code)**
- Supported: `pinMode`, `digitalWrite/Read`, `analogRead/Write`, `analogReadResolution`, `delay`, `millis`, `micros`, `tone/noTone`, `map`, `constrain`, `random`, the bit helpers, `attachInterrupt`, `Serial` (print, println, printf, read, parseInt…), `String`, arrays, `#define`, `static` locals, `switch`, and range-for.
- Libraries: `LiquidCrystal`, `LiquidCrystal_I2C`, `Adafruit_NeoPixel`, `Keypad`, `IRremote`, `Servo`, `Arduino_LED_Matrix` / `ArduinoLEDMatrix` (`begin`, `loadFrame`, `renderBitmap`, `draw`, `loadSequence`/`play`, plus a `setPixel(x, y)` helper).
- UNO Q: `Monitor` works like `Serial`. `Bridge.provide("name", fn)` functions can be called from the Serial Monitor by typing `@name arg1 arg2`.
- Errors point to the right line of your sketch, as you type and before running. The checks cover missing `;` and unbalanced brackets, misspelled or undeclared names (with a "did you mean" suggestion), and `#include` problems: a library that isn't available, wrong capitalization, a library that doesn't suit the selected board, or a library class used without its `#include`.
- Supported `#include`s: `Servo.h`, `LiquidCrystal.h`, `LiquidCrystal_I2C.h`, `Wire.h`, `Adafruit_NeoPixel.h`, `Keypad.h`, `IRremote.h`, `Arduino_LED_Matrix.h` (UNO Q, UNO R4 WiFi), `Modulino.h`, `Arduino_RouterBridge.h` (UNO Q), and standard headers such as `math.h`.

## How it works (and its limits)

Your sketch is **translated from Arduino C++ into JavaScript** and runs in the browser against a virtual board. It is not compiled by the real Arduino toolchain, which has these consequences:

- Only the common Arduino subset is supported. User-defined `class`/`struct`, pointers, templates and libraries not listed above won't work, and you get a clear error when you use one.
- Integer division truncates like C (`7 / 2` is 3, `millis() / 1000` gives whole seconds; `7.0 / 2` or a `float` operand gives 3.5), and integer variables truncate when assigned, but integer overflow and unsigned wrap-around are not emulated.
- Timing runs in real time with millisecond accuracy, not cycle accuracy.
- On the UNO Q only the microcontroller (STM32) side runs. The Linux/Python side of App Lab isn't simulated, so `Bridge` calls are logged instead.
- The editor is a breadboard view; the schematic is generated from it as an export (File → Export → Schematic diagram), not edited directly. No PCB view.

Always check a real circuit before powering it. The simulator is a learning and prototyping aid.

## Project layout

```
build.ps1             builds the WebAssembly solver + desktop app
crates/wb-core/       Rust circuit solver (+ tests, C ABI for WebAssembly)
src-tauri/            Rust desktop app (Tauri): window, file dialogs, icons
tools/make-icons.js   generates the app icons
serve.js              optional local web server for the browser version
web/index.html        app shell
web/wasm/             compiled solver (wb_core.wasm)
web/css/app.css       styles
web/js/util.js        helpers
web/js/parts.js       part library (graphics, pins, electrical models)
web/js/parts-more.js  motors, displays, keypad, IR, transistors, regulators, chips
web/js/boards.js      microcontroller boards
web/js/circuit.js     netlist builder + JavaScript fallback solver
web/js/native.js      loads the Rust solver; desktop bridge
web/js/sketch.js      Arduino C++ → JavaScript translator
web/js/runtime.js     Arduino API (pins, Serial, Servo, LED matrix, …)
web/js/editor.js      canvas editor (drag, wire, zoom, select)
web/js/schematic.js   schematic sheet for Export → Schematic diagram (symbols, placement, wire routing)
web/js/spice.js       SPICE netlist for LTspice (Export → SPICE netlist)
web/js/examples.js    example projects
web/js/app.js         UI glue, code editor, simulation loop
```

**Your own examples (desktop app, no rebuild):** choose *Examples… → Open examples folder…* and save any project (`.json` or `.wbproj`) into it. That folder is `%APPDATA%\Wirebench\examples`; an `examples` folder next to `wirebench.exe` is read too, which is useful for a classroom install. Each file shows up under **My examples**, named after the file or after a `"name"` field in the JSON. The list is read again whenever the window regains focus, so you don't need to restart the app. Built-in examples live in `web/js/examples.js` and are compiled into the app.

To add a part, copy one of the `WB.defPart(...)` blocks in `web/js/parts.js`. Each part declares its pins, its SVG drawing, and its electrical elements (resistors, sources, diodes).

## Author

Sudchai Boonto

## License

Wirebench is released under the [MIT License](LICENSE). Copyright (c) 2026 Sudchai Boonto.

Arduino, UNO and Modulino are trademarks of Arduino S.r.l.; Wirebench is an independent project and is not affiliated with Arduino.

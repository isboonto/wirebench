'use strict';
(function (WB) {
  // Layout helpers. Board at (20,20); half breadboard at (BBX,BBY).
  const BX = 20, BY = 20, BBX = 340, BBY = 60;
  const ROWY = { a: 40, b: 50, c: 60, d: 70, e: 80, f: 110, g: 120, h: 130, i: 140, j: 150 };
  const RAILY = { TP: 10, TN: 20, BN: 170, BP: 180 };

  const hole = (id) => { const r = id[0], c = +id.slice(1); return [BBX + 10 + c * 10, BBY + ROWY[r]]; };
  const rail = (r, col) => { const g = Math.floor((col - 1) / 6), i = (col - 1) % 6; if (i > 4) throw new Error('no rail hole at col ' + col); return r + (g * 5 + i + 1); };
  const railPos = (r, col) => { const g = Math.floor((col - 1) / 6), i = (col - 1) % 6; return [BBX + 20 + (g * 6 + i) * 10, BBY + RAILY[r]]; };
  const unoPinX = { GND3: 110, D13: 120, D12: 130, D11: 140, D10: 150, D9: 160, D8: 170, D7: 190, D6: 200, D5: 210, D4: 220, D3: 230, D2: 240, '3V3': 120, '5V': 130, GND: 140, GND2: 150, VIN: 160, A0: 180, A1: 190, A2: 200 };
  const bpin = (id) => [BX + unoPinX[id], BY + (/^(3V3|5V|GND|GND2|VIN|A\d)$/.test(id) ? 200 : 10)];

  function P(board, code) {
    const p = { parts: [], wires: [], code };
    if (board) p.parts.push({ id: 'board', type: board, x: BX, y: BY, rot: 0, props: {}, name: 'U1' });
    return p;
  }
  function add(p, id, type, pos, rot, props, name) { p.parts.push({ id, type, x: pos[0], y: pos[1], rot: rot || 0, props: props || {}, name }); }
  // Catch typos in examples: a wire to a pin that doesn't exist (e.g. a rail hole past the end
  // of the rail) would silently connect to nothing.
  function checkPins(p, a, b) {
    for (const [part, pin] of [a, b]) {
      const q = p.parts.find((x) => x.id === part);
      if (q && WB.PARTS[q.type] && !WB.worldPin(q, pin)) console.warn(`JumperCraft example: ${q.name || part} has no pin "${pin}"`);
    }
  }
  function wire(p, a, b, color, pts) {
    const w = { id: 'w' + p.wires.length, a: { part: a[0], pin: a[1] }, b: { part: b[0], pin: b[1] }, color, pts: pts || [] };
    checkPins(p, a, b);
    // A jumper without joints whose ends don't line up (e.g. a row hole to the power rail,
    // whose holes sit in groups of five) would be drawn slanted: let the auto-router lay it
    // out at right angles when the example loads, and again when its parts move.
    if (!w.pts.length) {
      const pa = p.parts.find((q) => q.id === a[0]), pb = p.parts.find((q) => q.id === b[0]);
      const A = pa && WB.worldPin(pa, a[1]), B = pb && WB.worldPin(pb, b[1]);
      if (A && B && Math.abs(A.x - B.x) > 0.5 && Math.abs(A.y - B.y) > 0.5) { w.route = true; w.auto = true; }
    }
    p.wires.push(w);
  }
  function breadboard(p) { add(p, 'bb', 'breadboard-half', [BBX, BBY], 0, {}, 'BB1'); }
  // LED + series resistor on the top half. Signal enters at hole a{c}; cathode goes to the top − rail.
  function ledUnit(p, n, c, color, ohms) {
    add(p, 'r' + n, 'resistor', hole('b' + c), 0, { ohms: ohms || 220 }, 'R' + n);
    add(p, 'led' + n, 'led', hole('e' + (c + 4)), 0, { color }, 'LED' + n);
    wire(p, ['bb', 'a' + (c + 5)], ['bb', rail('TN', c + 5)], '#1f1f1f');
  }
  function boardGndToTopRail(p, lane) {
    const [x, y] = bpin('GND3');
    const [rx] = railPos('TN', 1);
    wire(p, ['board', 'GND3'], ['bb', 'TN1'], '#1f1f1f', [[x, lane], [rx, lane]]);
  }
  function signal(p, pin, holeId, color, lane) {
    const [x] = bpin(pin), [hx] = hole(holeId);
    wire(p, ['board', pin], ['bb', holeId], color, [[x, lane], [hx, lane]]);
  }

  // Qwiic wiring from a Modulino at (mx,my) to the board's Qwiic connector (x=280, y=140..170).
  function qwiic(p, id) {
    const m = p.parts.find((q) => q.id === id);
    const pins = ['GND', '3V3', 'SDA', 'SCL'], targets = ['QGND', 'Q3V3', 'QSDA', 'QSCL'], colors = ['#1f1f1f', '#d62828', '#2f7de1', '#f2c200'];
    pins.forEach((pin, i) => {
      const px = m.x + i * 10, lane = m.y + 12 + i * 5, bx = 300 + i * 6, by = BY + 120 + i * 10;
      wire(p, [id, pin], ['board', targets[i]], colors[i], [[px, lane], [bx, lane], [bx, by]]);
    });
  }

  const EX = [];

  EX.push({ name: 'UNO Q · Blink (built-in LED)', build: () => P('board-uno-q', `// Blink the on-board LED (marked "L").
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);   // LED on
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);    // LED off
  delay(500);
}
`) });

  function blinkLed(board) {
    const p = P(board, `// Blink an LED on pin 9 through a 220 ohm resistor.
const int ledPin = 9;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
  Serial.println("Blink started");
}

void loop() {
  digitalWrite(ledPin, HIGH);
  delay(400);
  digitalWrite(ledPin, LOW);
  delay(400);
}
`);
    breadboard(p);
    ledUnit(p, 1, 8, 'red');
    boardGndToTopRail(p, 0);
    signal(p, 'D9', 'a8', '#2f7de1', 10);
    return p;
  }
  EX.push({ name: 'UNO Q · Blink an external LED', build: () => blinkLed('board-uno-q') });

  EX.push({
    name: 'UNO Q · Button controls LED', build: () => {
      const p = P('board-uno-q', `// Hold the button to light the LED.
// The button uses the internal pull-up, so pressed = LOW.
const int buttonPin = 2;
const int ledPin = 9;
int lastState = HIGH;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int state = digitalRead(buttonPin);
  digitalWrite(ledPin, state == LOW ? HIGH : LOW);
  if (state != lastState) {
    Serial.println(state == LOW ? "Button pressed" : "Button released");
    lastState = state;
  }
  delay(10);
}
`);
      breadboard(p);
      ledUnit(p, 1, 8, 'green');
      boardGndToTopRail(p, 0);
      signal(p, 'D9', 'a8', '#2f7de1', 10);
      add(p, 'sw1', 'button', hole('e20'), 0, { cap: 'red' }, 'SW1');
      signal(p, 'D2', 'a20', '#f2c200', 16);
      wire(p, ['bb', 'j22'], ['bb', rail('BN', 22)], '#1f1f1f');
      const [gx, gy] = bpin('GND');
      wire(p, ['board', 'GND'], ['bb', 'BN1'], '#1f1f1f', [[gx, 250], [railPos('BN', 1)[0], 250]]);
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · Fade an LED (PWM)', build: () => {
      const p = blinkLed('board-uno-q');
      p.code = `// Fade an LED in and out with analogWrite() on PWM pin ~9.
int brightness = 0;
int step = 5;

void setup() {
  pinMode(9, OUTPUT);
}

void loop() {
  analogWrite(9, brightness);
  brightness = brightness + step;
  if (brightness <= 0 || brightness >= 255) {
    step = -step;
  }
  delay(30);
}
`;
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · Potentiometer dimmer + Serial', build: () => {
      const p = P('board-uno-q', `// Turn the knob (drag it while the simulation runs)
// to change the LED brightness. Values appear in the Serial Monitor.
void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int raw = analogRead(A0);            // 0..1023
  int level = map(raw, 0, 1023, 0, 255);
  analogWrite(9, level);
  Serial.print("A0 = ");
  Serial.print(raw);
  Serial.print("   PWM = ");
  Serial.println(level);
  delay(250);
}
`);
      breadboard(p);
      ledUnit(p, 1, 8, 'yellow');
      boardGndToTopRail(p, 0);
      signal(p, 'D9', 'a8', '#2f7de1', 10);
      add(p, 'pot1', 'pot', hole('f26'), 0, { ohms: 10000, pos: 0.5 }, 'POT1');
      wire(p, ['bb', 'j26'], ['bb', rail('BN', 26)], '#1f1f1f');
      wire(p, ['bb', 'j28'], ['bb', rail('BP', 28)], '#d62828');
      const [ax] = bpin('A0');
      wire(p, ['bb', 'j27'], ['board', 'A0'], '#22a34a', [[hole('j27')[0], 262], [ax, 262]]);
      const [gx] = bpin('GND'), [vx] = bpin('3V3');
      wire(p, ['board', 'GND'], ['bb', 'BN1'], '#1f1f1f', [[gx, 250], [railPos('BN', 1)[0], 250]]);
      wire(p, ['board', '3V3'], ['bb', 'BP2'], '#d62828', [[vx, 256], [railPos('BP', 2)[0], 256]]);
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · Measuring: multimeter & oscilloscope (v0.2)', build: () => {
      const p = blinkLed('board-uno-q');
      p.code = `// Fades an LED with PWM on pin ~9 and blinks the built-in LED (pin 13).
// While the simulation runs:
//  - the oscilloscope shows the PWM square wave on pin 9 (CH1, yellow)
//    and the blinking pin 13 (CH2, cyan) — change the time base in its settings
//  - the multimeter shows the average voltage across the LED; click its dial
//    to switch between V, A and Ω
int brightness = 0;
int step = 15;
unsigned long lastBlink = 0;
bool led13 = false;

void setup() {
  pinMode(9, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  analogWrite(9, brightness);
  brightness = brightness + step;
  if (brightness <= 0 || brightness >= 255) step = -step;
  if (millis() - lastBlink > 400) {
    lastBlink = millis();
    led13 = !led13;
    digitalWrite(LED_BUILTIN, led13 ? HIGH : LOW);
  }
  delay(60);
}
`;
      add(p, 'dmm', 'multimeter', [380, 450], 0, { mode: 'V' }, 'DMM1');
      add(p, 'osc', 'scope', [600, 540], 0, { tdiv: 5, vdiv: 1, pos1: -2, pos2: -2 }, 'OSC1');
      const rw = (a, b, color) => p.wires.push({ id: 'w' + p.wires.length, a: { part: a[0], pin: a[1] }, b: { part: b[0], pin: b[1] }, color, pts: [], route: true, auto: true });
      rw(['dmm', 'V'], ['bb', 'd12'], '#d62828');          // LED anode
      rw(['dmm', 'COM'], ['bb', rail('TN', 3)], '#1f1f1f'); // ground rail
      rw(['osc', 'CH1'], ['bb', 'd8'], '#f2c200');          // pin 9 (PWM)
      rw(['osc', 'CH2'], ['board', 'D13'], '#00b3b3');      // pin 13
      rw(['osc', 'GND'], ['bb', rail('TN', 4)], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · Traffic light', build: () => {
      const p = P('board-uno-r3', `// A simple traffic light on pins 10 (red), 9 (yellow), 8 (green).
const int RED = 10;
const int YELLOW = 9;
const int GREEN = 8;

void setLights(int r, int y, int g) {
  digitalWrite(RED, r);
  digitalWrite(YELLOW, y);
  digitalWrite(GREEN, g);
}

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
}

void loop() {
  setLights(HIGH, LOW, LOW);   delay(2000);
  setLights(HIGH, HIGH, LOW);  delay(700);
  setLights(LOW, LOW, HIGH);   delay(2000);
  setLights(LOW, HIGH, LOW);   delay(900);
}
`);
      breadboard(p);
      ledUnit(p, 1, 8, 'red');
      ledUnit(p, 2, 16, 'yellow');
      ledUnit(p, 3, 24, 'green');
      boardGndToTopRail(p, -6);
      signal(p, 'D10', 'a8', '#d6336c', 14);
      signal(p, 'D9', 'a16', '#f2c200', 8);
      signal(p, 'D8', 'a24', '#22a34a', 2);
      return p;
    },
  });

  EX.push({
    name: 'UNO R4 WiFi · Servo sweep', build: () => {
      const p = P('board-uno-r4-wifi', `#include <Servo.h>

Servo myServo;

void setup() {
  myServo.attach(9);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 2) {
    myServo.write(angle);
    delay(15);
  }
  for (int angle = 180; angle >= 0; angle -= 2) {
    myServo.write(angle);
    delay(15);
  }
}
`);
      add(p, 'm1', 'servo', [400, 300], 0, {}, 'M1');
      const [gx] = bpin('GND'), [vx] = bpin('5V'), [sx] = bpin('D9');
      wire(p, ['m1', 'GND'], ['board', 'GND'], '#6b3e1f', [[400, 320], [gx, 320]]);
      wire(p, ['m1', 'V+'], ['board', '5V'], '#d62828', [[410, 328], [vx, 328]]);
      wire(p, ['m1', 'SIG'], ['board', 'D9'], '#f08c00', [[470, 300], [470, 6], [sx, 6]]);
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · LED matrix bouncing dot', build: () => P('board-uno-q', `// The UNO Q has a 13 x 8 LED matrix driven by the microcontroller.
#include <Arduino_LED_Matrix.h>

Arduino_LED_Matrix matrix;
uint8_t frame[8][13];
int x = 0, y = 0;
int dx = 1, dy = 1;

void setup() {
  matrix.begin();
}

void loop() {
  for (int r = 0; r < 8; r++)
    for (int c = 0; c < 13; c++)
      frame[r][c] = 0;
  frame[y][x] = 1;
  matrix.renderBitmap(frame, 8, 13);

  x += dx;
  y += dy;
  if (x <= 0 || x >= 12) dx = -dx;
  if (y <= 0 || y >= 7) dy = -dy;
  delay(80);
}
`) });

  EX.push({
    name: 'UNO R4 WiFi · LED matrix heartbeat', build: () => P('board-uno-r4-wifi', `#include "Arduino_LED_Matrix.h"

ArduinoLEDMatrix matrix;

// 12 x 8 = 96 pixels packed into three 32-bit words, row by row
const uint32_t heart[] = { 0x3184a444, 0x44042081, 0x100a0040 };
const uint32_t blank[] = { 0, 0, 0 };

void setup() {
  matrix.begin();
}

void loop() {
  matrix.loadFrame(heart);
  delay(350);
  matrix.loadFrame(blank);
  delay(150);
  matrix.loadFrame(heart);
  delay(350);
  matrix.loadFrame(blank);
  delay(700);
}
`) });

  EX.push({
    name: 'UNO R3 · Melody on a piezo buzzer', build: () => {
      const p = P('board-uno-r3', `// Plays "Twinkle Twinkle Little Star" on pin 8 (turn your sound on).
int notes[] = { 262, 262, 392, 392, 440, 440, 392, 0,
                349, 349, 330, 330, 294, 294, 262, 0 };

void setup() {
}

void loop() {
  for (int i = 0; i < 16; i++) {
    if (notes[i] > 0) {
      tone(8, notes[i], 300);
    }
    delay(400);
  }
  noTone(8);
  delay(1500);
}
`);
      add(p, 'bz1', 'buzzer', [360, 120], 0, { kind: 'passive' }, 'BZ1');
      const [sx] = bpin('D8'), [gx] = bpin('GND');
      wire(p, ['bz1', '+'], ['board', 'D8'], '#2f7de1', [[360, 140], [320, 140], [320, 6], [sx, 6]]);
      wire(p, ['bz1', '-'], ['board', 'GND'], '#1f1f1f', [[380, 240], [gx, 240]]);
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · TMP36 thermometer', build: () => {
      const p = P('board-uno-q', `// Read a TMP36 sensor on A0. Drag the sensor up/down while
// the simulation runs to change the temperature.
void setup() {
  Serial.begin(115200);
}

void loop() {
  int raw = analogRead(A0);
  float volts = raw * (3.3 / 1023.0);   // UNO Q analog reference is 3.3 V
  float tempC = (volts - 0.5) * 100.0;
  Serial.print("Temperature: ");
  Serial.print(tempC, 1);
  Serial.println(" C");
  delay(500);
}
`);
      add(p, 'u2', 'tmp36', [360, 140], 0, { temp: 25 }, 'U2');
      const [vx] = bpin('3V3'), [ax] = bpin('A0'), [gx] = bpin('GND3');
      wire(p, ['u2', 'VS'], ['board', '3V3'], '#d62828', [[360, 240], [vx, 240]]);
      wire(p, ['u2', 'VOUT'], ['board', 'A0'], '#22a34a', [[370, 250], [ax, 250]]);
      wire(p, ['u2', 'GND'], ['board', 'GND3'], '#1f1f1f', [[392, 140], [392, 6], [gx, 6]]);
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · Ultrasonic distance (HC-SR04)', build: () => {
      const p = P('board-uno-r3', `// Measures distance with an HC-SR04. While the simulation runs,
// drag the sensor up/down to move the "object" closer or farther.
const int trigPin = 9;
const int echoPin = 8;

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);      // 10 µs trigger pulse
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH);   // echo time in µs
  float cm = duration * 0.0343 / 2;
  Serial.print("Distance: ");
  Serial.print(cm, 1);
  Serial.println(" cm");
  delay(300);
}
`);
      add(p, 'us1', 'hcsr04', [420, 300], 0, { cm: 50 }, 'US1');
      const [vx] = bpin('5V'), [gx] = bpin('GND'), [tx] = bpin('D9'), [ex] = bpin('D8');
      wire(p, ['us1', 'VCC'], ['board', '5V'], '#d62828', [[420, 330], [vx, 330]]);
      wire(p, ['us1', 'GND'], ['board', 'GND'], '#1f1f1f', [[450, 340], [gx, 340]]);
      wire(p, ['us1', 'TRIG'], ['board', 'D9'], '#2f7de1', [[430, 322], [520, 322], [520, 4], [tx, 4]]);
      wire(p, ['us1', 'ECHO'], ['board', 'D8'], '#f2c200', [[440, 312], [510, 312], [510, 10], [ex, 10]]);
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · PIR motion detector', build: () => {
      const p = P('board-uno-q', `// A PIR sensor on pin 2 lights the on-board LED when it sees motion.
// While the simulation runs, click the sensor to toggle "motion".
const int pirPin = 2;
int lastState = LOW;

void setup() {
  pinMode(pirPin, INPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("Click the PIR sensor to simulate motion");
}

void loop() {
  int motion = digitalRead(pirPin);
  digitalWrite(LED_BUILTIN, motion);
  if (motion != lastState) {
    Serial.println(motion == HIGH ? "Motion detected!" : "All quiet");
    lastState = motion;
  }
  delay(50);
}
`);
      add(p, 'pir1', 'pir', [420, 300], 0, { motion: false }, 'PIR1');
      const [vx] = bpin('5V'), [gx] = bpin('GND'), [sx] = bpin('D2');
      wire(p, ['pir1', 'VCC'], ['board', '5V'], '#d62828', [[420, 330], [vx, 330]]);
      wire(p, ['pir1', 'GND'], ['board', 'GND'], '#1f1f1f', [[440, 340], [gx, 340]]);
      wire(p, ['pir1', 'OUT'], ['board', 'D2'], '#f2c200', [[430, 316], [500, 316], [500, 6], [sx, 6]]);
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · Modulino Buttons, Pixels & Buzzer', build: () => {
      const p = P('board-uno-q', `// Modulino modules on the Qwiic connector.
// While the simulation runs, click button A, B or C on the Modulino Buttons.
#include <Modulino.h>

ModulinoButtons buttons;
ModulinoPixels leds;
ModulinoBuzzer buzzer;

void setup() {
  Serial.begin(115200);
  Modulino.begin();
  buttons.begin();
  leds.begin();
  buzzer.begin();
  Serial.println("Press A, B or C on the Modulino Buttons");
}

void loop() {
  if (buttons.update()) {
    bool a = buttons.isPressed(0), b = buttons.isPressed(1), c = buttons.isPressed(2);
    buttons.setLeds(a, b, c);
    for (int i = 0; i < 8; i++) {
      if (a) leds.set(i, RED, 25);
      else if (b) leds.set(i, GREEN, 25);
      else if (c) leds.set(i, BLUE, 25);
      else leds.clear(i);
    }
    leds.show();
    if (a) buzzer.tone(440, 150);
    if (b) buzzer.tone(660, 150);
    if (c) buzzer.tone(880, 150);
    Serial.println(a ? "A" : b ? "B" : c ? "C" : "released");
  }
  delay(10);
}
`);
      add(p, 'mbtn', 'mod-buttons', [380, 130], 0, {}, 'MOD1');
      add(p, 'mpix', 'mod-pixels', [540, 130], 0, {}, 'MOD2');
      add(p, 'mbuz', 'mod-buzzer', [380, 290], 0, {}, 'MOD3');
      qwiic(p, 'mbtn'); qwiic(p, 'mpix'); qwiic(p, 'mbuz');
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · Modulino sensors (Knob, Distance, Thermo, Movement)', build: () => {
      const p = P('board-uno-q', `// Reads four Modulino sensors and prints them to the Serial Monitor.
// While the simulation runs: drag the Knob to turn it (click to press),
// drag Distance / Thermo / Movement to change what they sense.
#include <Modulino.h>

ModulinoKnob knob;
ModulinoDistance distance;
ModulinoThermo thermo;
ModulinoMovement imu;

void setup() {
  Serial.begin(115200);
  Modulino.begin();
  knob.begin();
  distance.begin();
  thermo.begin();
  imu.begin();
}

void loop() {
  int k = knob.get();
  int mm = distance.available() ? distance.get() : -1;
  imu.update();
  Serial.print("knob=");
  Serial.print(k);
  Serial.print(knob.isPressed() ? " (pressed)" : "");
  Serial.print("  distance=");
  Serial.print(mm);
  Serial.print("mm  temp=");
  Serial.print(thermo.getTemperature(), 1);
  Serial.print("C  hum=");
  Serial.print(thermo.getHumidity(), 0);
  Serial.print("%  accel x=");
  Serial.print(imu.getX(), 2);
  Serial.print(" y=");
  Serial.print(imu.getY(), 2);
  Serial.print(" z=");
  Serial.println(imu.getZ(), 2);
  delay(500);
}
`);
      add(p, 'mknob', 'mod-knob', [380, 130], 0, { value: 0 }, 'MOD1');
      add(p, 'mdist', 'mod-distance', [540, 130], 0, { mm: 250 }, 'MOD2');
      add(p, 'mthermo', 'mod-thermo', [380, 290], 0, { temp: 24, humidity: 45 }, 'MOD3');
      add(p, 'mimu', 'mod-movement', [540, 290], 0, { pitch: 0, roll: 0 }, 'MOD4');
      for (const id of ['mknob', 'mdist', 'mthermo', 'mimu']) qwiic(p, id);
      return p;
    },
  });

  EX.push({
    name: 'Nano · on a breadboard', build: () => {
      const p = { parts: [], wires: [], code: `// Arduino Nano plugged across the breadboard gap.
// Pin 2 blinks the external LED, pin 13 the on-board LED.
void setup() {
  pinMode(2, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(2, HIGH);
  digitalWrite(LED_BUILTIN, LOW);
  delay(300);
  digitalWrite(2, LOW);
  digitalWrite(LED_BUILTIN, HIGH);
  delay(300);
}
` };
      breadboard(p);
      add(p, 'board', 'board-nano', [BBX, BBY + 50], 0, {}, 'U1');
      ledUnit(p, 1, 20, 'blue', 100);
      wire(p, ['bb', 'a14'], ['bb', rail('TN', 14)], '#1f1f1f');
      wire(p, ['bb', 'j11'], ['bb', 'a20'], '#f07a1a', [[hole('j11')[0], 252], [hole('a20')[0], 252]]);
      return p;
    },
  });

  EX.push({
    name: 'No code · Battery, switch and LED', build: () => {
      const p = { parts: [], wires: [], code: '// This circuit has no microcontroller.\n// Press "Start simulation" and click the slide switch.\n' };
      breadboard(p);
      add(p, 'bat1', 'battery', [250, 260], 0, { volts: 9 }, 'BAT1');
      add(p, 'r1', 'resistor', railPos('BP', 8), 270, { ohms: 470 }, 'R1');
      add(p, 'led1', 'led', hole('f8'), 0, { color: 'red' }, 'LED1');
      add(p, 'sw1', 'switch', hole('h9'), 0, { on: false }, 'SW1');
      wire(p, ['bb', 'j10'], ['bb', rail('BN', 10)], '#1f1f1f');
      wire(p, ['bat1', '+'], ['bb', 'BP1'], '#d62828', [[250, 280], [railPos('BP', 1)[0], 280]]);
      wire(p, ['bat1', '-'], ['bb', 'BN2'], '#1f1f1f', [[270, 272], [railPos('BN', 2)[0], 272]]);
      return p;
    },
  });

  // ---------------------------------------------------------------- Analog electronics (v0.3)
  // Wires to instruments are laid out by the auto-router.
  const rw = (p, a, b, color) => { checkPins(p, a, b); p.wires.push({ id: 'w' + p.wires.length, a: { part: a[0], pin: a[1] }, b: { part: b[0], pin: b[1] }, color, pts: [], route: true, auto: true }); };
  const NOCODE = (what) => `// This circuit has no microcontroller — press "Start simulation".\n${what}\n`;

  EX.push({
    name: 'Electronics · RC low-pass filter (function generator + scope)', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// A 1 kΩ resistor and a 1 µF capacitor make a low-pass filter with a cut-off
// frequency of 1 / (2π·R·C) ≈ 159 Hz. The function generator feeds a 160 Hz sine:
//  - scope CH1 (yellow) = input, CH2 (cyan) = output across the capacitor.
//    At the cut-off frequency the output is about 70 % of the input and lags behind it.
//  - the multimeter (AC volts) shows the output's RMS value, about 1 V.
// Try it: double-click the function generator and change the frequency
// (16 Hz passes almost unchanged, 1.6 kHz is strongly reduced), or pick a square wave.`) };
      breadboard(p);
      add(p, 'r1', 'resistor', hole('b10'), 0, { ohms: 1000 }, 'R1');
      add(p, 'c1', 'capacitor', hole('c14'), 0, { farads: 1e-6 }, 'C1');
      wire(p, ['bb', 'a15'], ['bb', rail('TN', 15)], '#1f1f1f');
      add(p, 'fg', 'fgen', [120, 210], 0, { shape: 'sine', freq: 160, vpp: 4, offset: 0 }, 'FG1');
      add(p, 'osc', 'scope', [570, 550], 0, { tdiv: 2, vdiv: 1, pos1: -2, pos2: -2 }, 'OSC1');
      add(p, 'dmm', 'multimeter', [300, 470], 0, { mode: 'V~' }, 'DMM1');
      rw(p, ['fg', '+'], ['bb', 'a10'], '#d62828');
      rw(p, ['fg', 'COM'], ['bb', rail('TN', 2)], '#1f1f1f');
      rw(p, ['osc', 'CH1'], ['bb', 'd10'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['bb', 'd14'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['bb', rail('TN', 20)], '#1f1f1f');
      rw(p, ['dmm', 'V'], ['bb', 'e14'], '#d62828');
      rw(p, ['dmm', 'COM'], ['bb', rail('TN', 8)], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'Electronics · Half-wave rectifier with smoothing capacitor', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// A diode lets only the positive half of a 50 Hz sine (12 V peak-to-peak) through.
// The 100 µF capacitor charges on each peak and feeds the 1 kΩ load in between,
// so the output (CH2, cyan) is a DC voltage with a small ripple.
//  - scope CH1 (yellow) = AC input, CH2 = output
//  - the multimeter shows the DC output, about 3.9 V: the 6 V peak minus the diode
//    drop, minus the drop across the generator's 50 Ω output while the capacitor
//    recharges, minus the ripple
// Try it: change the capacitor to 10 µF (bigger ripple) or 470 µF (smoother),
// or turn the capacitor around to see the polarity warning.`) };
      breadboard(p);
      add(p, 'd1', 'diode', hole('b10'), 0, { model: '1N4001' }, 'D1');
      add(p, 'c1', 'ecap', hole('c14'), 0, { farads: 100e-6 }, 'C1');
      add(p, 'r1', 'resistor', hole('d14'), 0, { ohms: 1000 }, 'R1');
      wire(p, ['bb', 'a15'], ['bb', rail('TN', 15)], '#1f1f1f');
      wire(p, ['bb', 'a18'], ['bb', rail('TN', 19)], '#1f1f1f');
      add(p, 'fg', 'fgen', [120, 210], 0, { shape: 'sine', freq: 50, vpp: 12, offset: 0 }, 'FG1');
      add(p, 'osc', 'scope', [570, 550], 0, { tdiv: 10, vdiv: 2, vdiv2: 2, pos1: -2, pos2: -2 }, 'OSC1');
      add(p, 'dmm', 'multimeter', [300, 470], 0, { mode: 'V' }, 'DMM1');
      rw(p, ['fg', '+'], ['bb', 'a10'], '#d62828');
      rw(p, ['fg', 'COM'], ['bb', rail('TN', 2)], '#1f1f1f');
      rw(p, ['osc', 'CH1'], ['bb', 'e10'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['bb', 'e14'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['bb', rail('TN', 22)], '#1f1f1f');
      rw(p, ['dmm', 'V'], ['bb', 'a14'], '#d62828');
      rw(p, ['dmm', 'COM'], ['bb', rail('TN', 8)], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'Electronics · Capacitor charging (power supply + switch)', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// Click the slide switch to connect the 5 V power supply. The 100 µF capacitor
// charges through 10 kΩ (time constant R·C = 1 s): after 1 s it reaches 63 %,
// after 5 s it is practically full. Switch off and it discharges slowly through
// the 100 kΩ resistor (about 10 s).
//  - scope (500 ms/div): CH1 (yellow) = capacitor, CH2 (cyan) = after the switch
//  - the multimeter shows the capacitor voltage
// Try it: change the voltage with the power supply's −1 / −.1 / +.1 / +1 buttons.`) };
      breadboard(p);
      add(p, 'sw1', 'switch', hole('e5'), 0, { on: false }, 'SW1');
      add(p, 'r1', 'resistor', hole('b7'), 0, { ohms: 10000 }, 'R1');
      add(p, 'c1', 'ecap', hole('c11'), 0, { farads: 100e-6 }, 'C1');
      add(p, 'r2', 'resistor', hole('d11'), 0, { ohms: 100000 }, 'R2');
      // column 12 has no rail hole above it; the short jumper tucks under the capacitor
      // (the auto-router would detour around the capacitor's body, over the + rail)
      wire(p, ['bb', 'a12'], ['bb', rail('TN', 11)], '#1f1f1f', [[hole('a12')[0], 90], [railPos('TN', 11)[0], 90]]);
      wire(p, ['bb', 'a15'], ['bb', rail('TN', 16)], '#1f1f1f');
      add(p, 'ps', 'psu', [130, 220], 0, { volts: 5, ilimit: 0.5 }, 'PS1');
      add(p, 'osc', 'scope', [570, 550], 0, { tdiv: 500, vdiv: 1, pos1: -2, pos2: -2 }, 'OSC1');
      add(p, 'dmm', 'multimeter', [300, 470], 0, { mode: 'V' }, 'DMM1');
      rw(p, ['ps', '+'], ['bb', 'a6'], '#d62828');
      rw(p, ['ps', '-'], ['bb', rail('TN', 1)], '#1f1f1f');
      rw(p, ['osc', 'CH1'], ['bb', 'e11'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['bb', 'd7'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['bb', rail('TN', 22)], '#1f1f1f');
      rw(p, ['dmm', 'V'], ['bb', 'a11'], '#d62828');
      rw(p, ['dmm', 'COM'], ['bb', rail('TN', 8)], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'UNO Q · PWM + RC filter = analog voltage', build: () => {
      const p = P('board-uno-q', `// PWM + RC low-pass filter = a smooth analog voltage.
// Pin 9 outputs a 490 Hz square wave (scope CH1, yellow). The 1 kΩ resistor
// and the 10 µF capacitor average it into a nearly steady voltage (CH2, cyan)
// with a small ripple. The multimeter shows the DC level: 3.3 V × duty cycle.
int levels[] = {64, 128, 192};

void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  for (int i = 0; i < 3; i++) {
    analogWrite(9, levels[i]);
    Serial.print("duty ");
    Serial.print(levels[i] * 100 / 255);
    Serial.print(" %, expected ");
    Serial.print(3.3 * levels[i] / 255.0);
    Serial.println(" V");
    delay(3000);
  }
}
`);
      breadboard(p);
      boardGndToTopRail(p, 0);
      signal(p, 'D9', 'a8', '#2f7de1', 10);
      add(p, 'r1', 'resistor', hole('b8'), 0, { ohms: 1000 }, 'R1');
      add(p, 'c1', 'ecap', hole('c12'), 0, { farads: 10e-6 }, 'C1');
      wire(p, ['bb', 'a13'], ['bb', rail('TN', 14)], '#1f1f1f');
      add(p, 'osc', 'scope', [570, 550], 0, { tdiv: 2, vdiv: 1, pos1: -2, pos2: -2 }, 'OSC1');
      add(p, 'dmm', 'multimeter', [300, 470], 0, { mode: 'V' }, 'DMM1');
      rw(p, ['osc', 'CH1'], ['bb', 'd8'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['bb', 'd12'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['bb', rail('TN', 22)], '#1f1f1f');
      rw(p, ['dmm', 'V'], ['bb', 'e12'], '#d62828');
      rw(p, ['dmm', 'COM'], ['bb', rail('TN', 16)], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'Electronics · Zener voltage regulator', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// A 5.1 V zener diode and a 470 Ω series resistor make a simple voltage regulator.
// The zener is connected in reverse (band / cathode to the output): once the voltage
// tries to rise above 5.1 V it conducts and takes the extra current, so the output
// stays at about 5.1 V. The 1 kΩ resistor is the load.
//  - the multimeter shows the regulated output
// Try it: use the power supply's +1 / −1 buttons to go between 8 V and 20 V — the output hardly moves.
// Below about 7.5 V the zener stops conducting and the output follows the input
// (470 Ω and 1 kΩ are then just a voltage divider). Try the 3.3 V or 9.1 V zener too.`) };
      breadboard(p);
      add(p, 'r1', 'resistor', hole('b6'), 0, { ohms: 470 }, 'R1');
      add(p, 'z1', 'zener', hole('c14'), 180, { model: '5V1' }, 'D1');
      add(p, 'r2', 'resistor', hole('d10'), 0, { ohms: 1000 }, 'R2');
      wire(p, ['bb', 'a14'], ['bb', rail('TN', 15)], '#1f1f1f');
      add(p, 'ps', 'psu', [130, 220], 0, { volts: 12, ilimit: 0.2 }, 'PS1');
      add(p, 'dmm', 'multimeter', [300, 470], 0, { mode: 'V' }, 'DMM1');
      rw(p, ['ps', '+'], ['bb', 'a6'], '#d62828');
      rw(p, ['ps', '-'], ['bb', rail('TN', 1)], '#1f1f1f');
      rw(p, ['dmm', 'V'], ['bb', 'e10'], '#d62828');
      rw(p, ['dmm', 'COM'], ['bb', rail('TN', 8)], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'Electronics · RL circuit: inductor with a square wave', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// A 100 Ω resistor and a 10 mH inductor, driven by a 2 kHz square wave (0 to 5 V).
// An inductor resists changes in current: at each edge of the square wave the whole
// voltage appears across the coil (CH2, cyan), then it dies away as the current
// builds up. The time constant is L / R = 10 mH / (100 Ω + 50 Ω generator + 12 Ω
// winding) ≈ 62 µs. On the falling edge the coil pushes back: CH2 goes negative.
//  - scope CH1 (yellow) = generator, CH2 = voltage across the inductor
// Try it: change the inductor to 1 mH (faster) or 100 mH (slower), or press AUTO.`) };
      breadboard(p);
      add(p, 'r1', 'resistor', hole('b10'), 0, { ohms: 100 }, 'R1');
      add(p, 'l1', 'inductor', hole('c14'), 0, { henries: 10e-3 }, 'L1');
      wire(p, ['bb', 'a18'], ['bb', rail('TN', 19)], '#1f1f1f');
      add(p, 'fg', 'fgen', [120, 210], 0, { shape: 'square', freq: 2000, vpp: 5, offset: 2.5 }, 'FG1');
      add(p, 'osc', 'scope', [570, 550], 0, { tdiv: 0.1, vdiv: 2, vdiv2: 2, pos1: -2, pos2: 0 }, 'OSC1');
      rw(p, ['fg', '+'], ['bb', 'a10'], '#d62828');
      rw(p, ['fg', 'COM'], ['bb', rail('TN', 2)], '#1f1f1f');
      rw(p, ['osc', 'CH1'], ['bb', 'd10'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['bb', 'd14'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['bb', rail('TN', 22)], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'Electronics · RLC circuit: underdamped ringing', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// A series RLC circuit: 10 Ω resistor, 10 mH inductor and 100 nF capacitor,
// driven by a 250 Hz square wave (0 to 5 V). The voltage across the capacitor
// (CH2, cyan) overshoots and rings after every edge before it settles.
//  - natural frequency f0 = 1 / (2π·√(L·C)) ≈ 5.0 kHz  -> one ring every ≈ 200 µs
//  - total resistance R = 10 Ω + 50 Ω generator + 12 Ω winding = 72 Ω
//  - critical resistance 2·√(L / C) ≈ 632 Ω. R is far below it, so the circuit
//    is underdamped: damping ratio ζ = R / 632 Ω ≈ 0.11, Q ≈ 4.4
//  - the ringing dies away with time constant 2L / R ≈ 280 µs; the first peak
//    overshoots by about 70 % (≈ 8.5 V across the capacitor from a 5 V step,
//    so CH2 shows about 12 Vpp: −3.5 V undershoot on the falling edge)
//  - scope CH1 (yellow) = generator, CH2 = voltage across the capacitor
// Try it: change R1 to 220 Ω (less ringing), 560 Ω (close to critically damped)
// or 1 kΩ (overdamped, no overshoot); or change C1 to 1 µF (slower rings, f0 ≈ 1.6 kHz).`) };
      breadboard(p);
      add(p, 'r1', 'resistor', hole('b10'), 0, { ohms: 10 }, 'R1');
      add(p, 'l1', 'inductor', hole('c14'), 0, { henries: 10e-3 }, 'L1');
      add(p, 'c1', 'capacitor', hole('d18'), 0, { farads: 100e-9 }, 'C1');
      wire(p, ['bb', 'a19'], ['bb', rail('TN', 19)], '#1f1f1f');
      add(p, 'fg', 'fgen', [120, 210], 0, { shape: 'square', freq: 250, vpp: 5, offset: 2.5 }, 'FG1');
      add(p, 'osc', 'scope', [570, 550], 0, { tdiv: 0.2, vdiv: 2, vdiv2: 2, pos1: -3, pos2: -3 }, 'OSC1');
      rw(p, ['fg', '+'], ['bb', 'a10'], '#d62828');
      rw(p, ['fg', 'COM'], ['bb', rail('TN', 2)], '#1f1f1f');
      rw(p, ['osc', 'CH1'], ['bb', 'd10'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['bb', 'e18'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['bb', rail('TN', 22)], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'Controlled sources · Sallen-Key low-pass filter (VCVS)', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// A second-order active low-pass filter. The amplifier is an ideal voltage-controlled
// voltage source (VCVS, Parts → Controlled sources) with gain 1, i.e. a perfect buffer.
//   R1 = R2 = 10 kΩ, C1 = 22 nF (feedback), C2 = 10 nF
//   f0 = 1 / (2π·√(R1·R2·C1·C2)) ≈ 1.07 kHz,  Q = √(R1·R2·C1·C2) / (C2·(R1 + R2)) ≈ 0.74
// The generator runs at f0 (2 Vpp): the output (CH2, cyan) is Q × 2 ≈ 1.5 Vpp and lags 90°.
// Try it:
//  - generator at 100 Hz: passes unchanged; at 10 kHz: about 100× smaller (−40 dB/decade)
//  - VCVS gain 1.5: Q rises to ≈ 1.7 and the response peaks near f0
//  - VCVS gain 1.95: Q is negative — the filter becomes an oscillator and the ideal source
//    (which has no supply rails) runs away. Real op-amps would clip at their supply.`) };
      const G = '#1f1f1f';
      add(p, 'fg', 'fgen', [130, 300], 0, { shape: 'sine', freq: 1073, vpp: 2, offset: 0 }, 'FG1');
      add(p, 'r1', 'resistor', [260, 150], 0, { ohms: 10000 }, 'R1');
      add(p, 'r2', 'resistor', [340, 150], 0, { ohms: 10000 }, 'R2');
      add(p, 'c1', 'capacitor', [420, 60], 0, { farads: 22e-9 }, 'C1');
      add(p, 'c2', 'capacitor', [400, 260], 0, { farads: 10e-9 }, 'C2');
      add(p, 'e1', 'vcvs', [480, 200], 0, { gain: 1 }, 'E1');
      add(p, 'osc', 'scope', [720, 620], 0, { tdiv: 0.2, vdiv: 0.5, vdiv2: 0.5, pos1: 0, pos2: 0 }, 'OSC1');
      rw(p, ['fg', '+'], ['r1', '1'], '#d62828');
      rw(p, ['r1', '2'], ['r2', '1'], '#7f8c8d');
      rw(p, ['r1', '2'], ['c1', '1'], '#7f8c8d');
      rw(p, ['r2', '2'], ['c2', '1'], '#2f7de1');
      rw(p, ['r2', '2'], ['e1', 'C+'], '#2f7de1');
      rw(p, ['c1', '2'], ['e1', 'O+'], '#00b3b3');
      rw(p, ['c2', '2'], ['fg', 'COM'], G);
      rw(p, ['e1', 'C-'], ['fg', 'COM'], G);
      rw(p, ['e1', 'O-'], ['fg', 'COM'], G);
      rw(p, ['osc', 'CH1'], ['fg', '+'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['e1', 'O+'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['fg', 'COM'], G);
      return p;
    },
  });

  EX.push({
    name: 'Controlled sources · Sallen-Key high-pass filter (VCVS)', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// A second-order active high-pass filter: the low-pass Sallen-Key with the resistors and
// capacitors swapped. The amplifier is an ideal VCVS with gain 1 (a perfect buffer).
//   C1 = C2 = 10 nF, R1 = 10 kΩ (feedback, to the output), R2 = 22 kΩ (to ground)
//   f0 = 1 / (2π·√(R1·R2·C1·C2)) ≈ 1.07 kHz,  Q = √(R1·R2·C1·C2) / (R1·(C1 + C2)) ≈ 0.74
// Same f0 and Q as the low-pass example, so the two can be compared directly.
// The generator runs at f0 (2 Vpp): the output (CH2, cyan) is Q × 2 ≈ 1.5 Vpp and leads 90°.
// Try it:
//  - generator at 10 kHz: passes unchanged; at 100 Hz: about 100× smaller (−40 dB/decade)
//  - swap R1 and R2 (R1 = 22 kΩ, R2 = 10 kΩ): Q drops to ≈ 0.34, a softer corner
//  - VCVS gain 1.5: Q rises and the response peaks near f0; much higher and it oscillates`) };
      const G = '#1f1f1f';
      add(p, 'fg', 'fgen', [130, 300], 0, { shape: 'sine', freq: 1073, vpp: 2, offset: 0 }, 'FG1');
      add(p, 'c1', 'capacitor', [270, 150], 0, { farads: 10e-9 }, 'C1');
      add(p, 'c2', 'capacitor', [340, 150], 0, { farads: 10e-9 }, 'C2');
      add(p, 'r1', 'resistor', [400, 60], 0, { ohms: 10000 }, 'R1');
      add(p, 'r2', 'resistor', [420, 240], 90, { ohms: 22000 }, 'R2');
      add(p, 'e1', 'vcvs', [480, 200], 0, { gain: 1 }, 'E1');
      add(p, 'osc', 'scope', [720, 620], 0, { tdiv: 0.2, vdiv: 0.5, vdiv2: 0.5, pos1: 0, pos2: 0 }, 'OSC1');
      rw(p, ['fg', '+'], ['c1', '1'], '#d62828');
      rw(p, ['c1', '2'], ['c2', '1'], '#7f8c8d');
      rw(p, ['c1', '2'], ['r1', '1'], '#7f8c8d');
      rw(p, ['c2', '2'], ['r2', '1'], '#2f7de1');
      rw(p, ['c2', '2'], ['e1', 'C+'], '#2f7de1');
      rw(p, ['r1', '2'], ['e1', 'O+'], '#00b3b3');
      rw(p, ['r2', '2'], ['fg', 'COM'], G);
      rw(p, ['e1', 'C-'], ['fg', 'COM'], G);
      rw(p, ['e1', 'O-'], ['fg', 'COM'], G);
      rw(p, ['osc', 'CH1'], ['fg', '+'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['e1', 'O+'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['fg', 'COM'], G);
      return p;
    },
  });

  EX.push({
    name: 'Controlled sources · Transistor small-signal model (CCCS)', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// The textbook small-signal model of a common-emitter amplifier, built from ideal parts:
//  - base current i_b flows through RB = 1 kΩ and r_π = 2.5 kΩ (base–emitter resistance,
//    r_π = β·V_T / I_C = 100 · 25 mV / 1 mA)
//  - a current-controlled current source (CCCS, β = 100) senses i_b and pulls β·i_b out
//    of the collector node through RC = 2.2 kΩ
// Voltage gain = −β·RC / (R_gen + RB + r_π) = −100 · 2.2k / 3.55k ≈ −62:
// a 0.2 Vpp input (CH1, yellow, 50 mV/div) becomes ≈ 12.4 Vpp, inverted (CH2, cyan, 5 V/div).
// Try it: change β to 200 (double gain) or RC to 1 kΩ, or replace the CCCS with a VCCS
// (g_m = β / r_π = 40 mA/V, control across r_π) — the hybrid-π model gives the same result.`) };
      const G = '#1f1f1f';
      add(p, 'fg', 'fgen', [130, 300], 0, { shape: 'sine', freq: 1000, vpp: 0.2, offset: 0 }, 'FG1');
      add(p, 'rb', 'resistor', [270, 150], 0, { ohms: 1000 }, 'RB');
      add(p, 'f1', 'cccs', [360, 200], 0, { beta: 100 }, 'F1');
      add(p, 'rpi', 'resistor', [370, 290], 90, { ohms: 2500 }, 'Rπ');
      add(p, 'rc', 'resistor', [470, 100], 90, { ohms: 2200 }, 'RC');
      add(p, 'osc', 'scope', [720, 620], 0, { tdiv: 0.5, vdiv: 0.05, vdiv2: 5, pos1: 0, pos2: 0 }, 'OSC1');
      rw(p, ['fg', '+'], ['rb', '1'], '#d62828');
      rw(p, ['rb', '2'], ['f1', 'S+'], '#7f8c8d');
      rw(p, ['f1', 'S-'], ['rpi', '1'], '#7f8c8d');
      rw(p, ['rpi', '2'], ['fg', 'COM'], G);
      rw(p, ['f1', 'O-'], ['rc', '1'], '#00b3b3');
      rw(p, ['rc', '2'], ['fg', 'COM'], G);
      rw(p, ['f1', 'O+'], ['fg', 'COM'], G);
      rw(p, ['osc', 'CH1'], ['fg', '+'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['f1', 'O-'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['fg', 'COM'], G);
      return p;
    },
  });


  // ---------------------------------------------------------------- v0.5 parts
  EX.push({
    name: 'UNO R3 · LCD 16×2: hello + seconds counter', build: () => {
      const p = P('board-uno-r3', `#include <LiquidCrystal.h>

// LiquidCrystal(rs, en, d4, d5, d6, d7) — 4-bit mode, the usual Arduino wiring.
// RW and V0 (contrast) go to GND, the backlight (A) gets 5 V through 220 Ω.
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

byte heart[8] = { 0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000 };

void setup() {
  lcd.begin(16, 2);
  lcd.createChar(0, heart);
  lcd.print("Hi, JumperCraft!");   // 16 characters: one full line
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.write(byte(0));
  unsigned long secs = millis() / 1000;
  lcd.print(" up ");
  lcd.print(secs);
  lcd.print(" s   ");
  delay(200);
}
`);
      add(p, 'lcd', 'lcd', [420, 400], 0, { iface: 'parallel', color: 'green' }, 'LCD1');
      add(p, 'rbl', 'resistor', [600, 470], 0, { ohms: 220 }, 'R1');
      const G = '#1f1f1f', R = '#d62828';
      rw(p, ['lcd', 'VSS'], ['board', 'GND'], G);
      rw(p, ['lcd', 'VDD'], ['board', '5V'], R);
      rw(p, ['lcd', 'V0'], ['board', 'GND2'], G);
      rw(p, ['lcd', 'RW'], ['lcd', 'VSS'], G);
      rw(p, ['lcd', 'RS'], ['board', 'D12'], '#2f7de1');
      rw(p, ['lcd', 'E'], ['board', 'D11'], '#f08c00');
      rw(p, ['lcd', 'D4'], ['board', 'D5'], '#1f9e3a');
      rw(p, ['lcd', 'D5'], ['board', 'D4'], '#1f9e3a');
      rw(p, ['lcd', 'D6'], ['board', 'D3'], '#1f9e3a');
      rw(p, ['lcd', 'D7'], ['board', 'D2'], '#1f9e3a');
      rw(p, ['lcd', 'A'], ['rbl', '1'], R);
      rw(p, ['rbl', '2'], ['lcd', 'VDD'], R);
      rw(p, ['lcd', 'K'], ['lcd', 'VSS'], G);
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · Nextion 7" touch display: knob, bar, gauge and LED buttons', build: () => {
      const p = P('board-uno-r3', `#include <SoftwareSerial.h>

// A Nextion touch display on SoftwareSerial: its TX goes to pin 10, its RX to pin 11.
// The screen design is the display's "Screen layout" setting (select the display
// to see it): t0 t1 text, n0 number, j0 progress bar, b0 b1 buttons, z0 gauge.
// Run the simulation, turn the knob, and touch LED ON / LED OFF on the screen.
SoftwareSerial nex(10, 11);   // RX, TX

const int LED = 7;

// Every Nextion instruction ends with three 0xFF bytes.
void sendCmd(String cmd) {
  nex.print(cmd);
  nex.write(0xFF);
  nex.write(0xFF);
  nex.write(0xFF);
}

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  nex.begin(9600);   // the Nextion's factory setting
}

byte msg[7];
int len = 0;

void loop() {
  // 1. Show the potentiometer as a number, a bar (0-100) and a gauge (0-180 degrees).
  int v = analogRead(A0);
  sendCmd("n0.val=" + String(v));
  sendCmd("j0.val=" + String(map(v, 0, 1023, 0, 100)));
  sendCmd("z0.val=" + String(map(v, 0, 1023, 0, 180)));

  // 2. Touch events arrive as 7 bytes: 0x65, page, component id, event, FF FF FF.
  while (nex.available()) {
    byte b = nex.read();
    if (len == 0 && b != 0x65) continue;   // skip anything until a touch event starts
    msg[len++] = b;
    if (len == 7) {
      len = 0;
      Serial.print("touch: page ");
      Serial.print(msg[1]);
      Serial.print(", component ");
      Serial.println(msg[2]);
      if (msg[2] == 5) digitalWrite(LED, HIGH);   // b0 "LED ON" is component 5
      if (msg[2] == 6) digitalWrite(LED, LOW);    // b1 "LED OFF" is component 6
    }
  }
  delay(100);
}
`);
      add(p, 'hmi', 'nextion', [600, 470], 0, {}, 'HMI1');
      add(p, 'pot', 'pot', [70, 330], 0, { ohms: 10000, pos: 0.5 }, 'POT1');
      add(p, 'r1', 'resistor', [190, 330], 0, { ohms: 220 }, 'R1');
      add(p, 'led', 'led', [270, 330], 0, { color: 'red' }, 'LED1');
      const G = '#1f1f1f', R = '#d62828';
      rw(p, ['hmi', '5V'], ['board', '5V'], R);
      rw(p, ['hmi', 'GND'], ['board', 'GND'], G);
      rw(p, ['hmi', 'TX'], ['board', 'D10'], '#2f7de1');
      rw(p, ['hmi', 'RX'], ['board', 'D11'], '#f2c200');
      rw(p, ['pot', '1'], ['board', 'GND2'], G);
      rw(p, ['pot', '2'], ['board', '5V'], R);
      rw(p, ['pot', 'W'], ['board', 'A0'], '#1f9e3a');
      rw(p, ['board', 'D7'], ['r1', '1'], '#f08c00');
      rw(p, ['r1', '2'], ['led', 'A'], '#f08c00');
      rw(p, ['led', 'K'], ['board', 'GND2'], G);
      return p;
    },
  });

  EX.push({
    name: 'CYD · touch screen: draw, RGB LED buttons, light sensor', build: () => {
      const p = P('board-cyd', `#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>

// The CYD (ESP32 "Cheap Yellow Display") has the screen, the touch panel, an RGB LED
// and a light sensor on the board — no wiring needed.
// Run the simulation, then draw in the box and touch RED / GREEN / BLUE.
// Drag the light sensor (LDR, top right) up or down to change the light.

// Touch controller pins on the CYD
#define XPT2046_IRQ  36
#define XPT2046_MOSI 32
#define XPT2046_MISO 39
#define XPT2046_CLK  25
#define XPT2046_CS   33

SPIClass touchSpi = SPIClass(VSPI);
XPT2046_Touchscreen ts(XPT2046_CS, XPT2046_IRQ);
TFT_eSPI tft = TFT_eSPI();

const int LED_R = 4, LED_G = 16, LED_B = 17;   // RGB LED: LOW = on
const int LDR = 34;                             // light sensor: more light = lower reading

void drawButtons() {
  tft.fillRoundRect(10, 190, 92, 40, 8, TFT_RED);
  tft.fillRoundRect(114, 190, 92, 40, 8, TFT_DARKGREEN);
  tft.fillRoundRect(218, 190, 92, 40, 8, TFT_BLUE);
  tft.setTextColor(TFT_WHITE);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("RED", 56, 210, 2);
  tft.drawString("GREEN", 160, 210, 2);
  tft.drawString("BLUE", 264, 210, 2);
}

void setLed(int r, int g, int b) {
  digitalWrite(LED_R, r ? LOW : HIGH);
  digitalWrite(LED_G, g ? LOW : HIGH);
  digitalWrite(LED_B, b ? LOW : HIGH);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  setLed(0, 0, 0);

  touchSpi.begin(XPT2046_CLK, XPT2046_MISO, XPT2046_MOSI, XPT2046_CS);
  ts.begin(touchSpi);
  ts.setRotation(1);

  tft.init();            // also switches the backlight (GPIO21) on
  tft.setRotation(1);    // landscape, 320 x 240
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.setTextDatum(TL_DATUM);
  tft.drawString("Hello, CYD!", 10, 8, 4);
  tft.drawRect(10, 40, 300, 140, TFT_DARKGREY);
  tft.setTextColor(TFT_DARKGREY);
  tft.drawString("draw here", 16, 46, 2);
  drawButtons();
}

unsigned long lastLight = 0;

void loop() {
  if (ts.touched()) {
    TS_Point p = ts.getPoint();
    // raw touch readings -> screen pixels (the usual CYD calibration)
    int x = map(p.x, 200, 3700, 0, 320);
    int y = map(p.y, 240, 3800, 0, 240);
    if (x > 13 && x < 307 && y > 43 && y < 177) tft.fillCircle(x, y, 3, TFT_CYAN);
    if (y >= 190) {
      if (x < 107) setLed(1, 0, 0);
      else if (x < 213) setLed(0, 1, 0);
      else setLed(0, 0, 1);
      Serial.printf("button at %d, %d\\n", x, y);
    }
  }
  if (millis() - lastLight > 500) {
    lastLight = millis();
    int light = analogRead(LDR);      // 12-bit: 0..4095
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.setTextDatum(TR_DATUM);
    tft.setTextPadding(120);
    tft.drawString("LDR " + String(light), 310, 12, 2);
    tft.setTextPadding(0);
  }
  delay(10);
}
`);
      return p;
    },
  });

  EX.push({
    name: 'CYD · potentiometer gauge on IO35 + LED dimmer on IO27', build: () => {
      const p = P('board-cyd', `#include <TFT_eSPI.h>

// A potentiometer on the P3 connector (IO35, analog input) is shown as an arc gauge,
// and sets the brightness of an LED on the CN1 connector (IO27) with ESP32 PWM.
// Turn the knob while the simulation runs.
TFT_eSPI tft = TFT_eSPI();

const int POT = 35;   // input only, 12-bit analog: 0..4095
const int LED = 27;

void setup() {
  tft.init();
  tft.setRotation(1);
  tft.fillScreen(TFT_NAVY);
  tft.setTextColor(TFT_WHITE, TFT_NAVY);
  tft.drawCentreString("Potentiometer on IO35", 160, 8, 4);
  ledcAttach(LED, 5000, 8);   // ESP32 core 3: PWM on the LED pin, 5 kHz, 8-bit
}

int last = -1;

void loop() {
  int v = analogRead(POT);
  int pct = map(v, 0, 4095, 0, 100);
  ledcWrite(LED, map(v, 0, 4095, 0, 255));
  if (pct != last) {
    last = pct;
    // arc angles: 0 = straight down, clockwise
    tft.drawArc(160, 140, 85, 65, 30, 330, TFT_DARKGREY, TFT_NAVY);
    if (pct > 0) tft.drawArc(160, 140, 85, 65, 30, 30 + pct * 3, TFT_GREEN, TFT_NAVY);
    tft.setTextDatum(MC_DATUM);
    tft.setTextPadding(120);
    tft.drawNumber(pct, 160, 132, 6);
    tft.setTextPadding(0);
    tft.drawString("%", 160, 176, 4);
  }
  delay(50);
}
`);
      add(p, 'pot', 'pot', [120, 320], 0, { ohms: 10000, pos: 0.5 }, 'POT1');
      add(p, 'r1', 'resistor', [250, 320], 0, { ohms: 220 }, 'R1');
      add(p, 'led', 'led', [330, 320], 0, { color: 'green' }, 'LED1');
      const G = '#1f1f1f', R = '#d62828';
      rw(p, ['pot', '1'], ['board', 'GND2'], G);
      rw(p, ['pot', '2'], ['board', '3V3'], R);
      rw(p, ['pot', 'W'], ['board', 'D35'], '#1f9e3a');
      rw(p, ['board', 'D27'], ['r1', '1'], '#f08c00');
      rw(p, ['r1', '2'], ['led', 'A'], '#f08c00');
      rw(p, ['led', 'K'], ['board', 'GND3'], G);
      return p;
    },
  });

  EX.push({
    name: 'CYD 7" · touch screen: draw, LED buttons, backlight brightness', build: () => {
      const p = P('board-cyd7', `#include <Arduino_GFX_Library.h>
#include <TAMC_GT911.h>
#include <Wire.h>

// 7-inch CYD (ESP32-8048S070C): 800 x 480 RGB panel + GT911 capacitive touch.
// Run the simulation, then draw in the box, touch LED ON / LED OFF / CLEAR,
// and touch the bar on the right to change the screen brightness.

#define GFX_BL 2   // backlight

Arduino_ESP32RGBPanel *rgbpanel = new Arduino_ESP32RGBPanel(
  41 /* DE */, 40 /* VSYNC */, 39 /* HSYNC */, 42 /* PCLK */,
  14 /* R0 */, 21 /* R1 */, 47 /* R2 */, 48 /* R3 */, 45 /* R4 */,
  9 /* G0 */, 46 /* G1 */, 3 /* G2 */, 8 /* G3 */, 16 /* G4 */, 1 /* G5 */,
  15 /* B0 */, 7 /* B1 */, 6 /* B2 */, 5 /* B3 */, 4 /* B4 */,
  0 /* hsync_polarity */, 210 /* hsync_front_porch */, 30 /* hsync_pulse_width */, 16 /* hsync_back_porch */,
  0 /* vsync_polarity */, 22 /* vsync_front_porch */, 13 /* vsync_pulse_width */, 10 /* vsync_back_porch */,
  1 /* pclk_active_neg */, 16000000 /* prefer_speed */);
Arduino_RGB_Display *gfx = new Arduino_RGB_Display(800, 480, rgbpanel, 0 /* rotation */, true /* auto_flush */);

// GT911 touch controller: I2C on 19 / 20, INT 18, RST 38
#define TOUCH_SDA 19
#define TOUCH_SCL 20
#define TOUCH_INT 18
#define TOUCH_RST 38
TAMC_GT911 ts = TAMC_GT911(TOUCH_SDA, TOUCH_SCL, TOUCH_INT, TOUCH_RST, 800, 480);

const int LED = 17;     // on the P3 connector
int brightness = 200;   // backlight PWM, 0..255

void drawButton(int x, String label, uint16_t color) {
  gfx->fillRoundRect(x, 400, 170, 64, 12, color);
  gfx->setTextColor(WHITE);
  gfx->setTextSize(3);
  gfx->setCursor(x + 85 - label.length() * 9, 421);
  gfx->print(label);
}

void drawBrightness() {
  gfx->fillRect(596, 400, 190, 64, BLACK);
  gfx->drawRoundRect(600, 410, 184, 44, 8, WHITE);
  gfx->fillRoundRect(604, 414, map(brightness, 0, 255, 0, 176), 36, 6, YELLOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  Wire.begin(TOUCH_SDA, TOUCH_SCL);
  ts.begin();
  ts.setRotation(ROTATION_NORMAL);

  gfx->begin();
  ledcAttach(GFX_BL, 5000, 8);   // backlight on, with PWM so it can be dimmed
  ledcWrite(GFX_BL, brightness);

  gfx->fillScreen(BLACK);
  gfx->setTextColor(CYAN);
  gfx->setTextSize(4);
  gfx->setCursor(20, 18);
  gfx->println("JumperCraft + 7-inch CYD");
  gfx->drawRect(16, 70, 768, 316, DARKGREY);
  drawButton(16, "LED ON", DARKGREEN);
  drawButton(204, "LED OFF", MAROON);
  drawButton(392, "CLEAR", NAVY);
  drawBrightness();
}

void loop() {
  ts.read();
  if (ts.isTouched) {
    // with ROTATION_NORMAL the GT911 point comes mirrored: map it back to screen pixels
    int x = map(ts.points[0].x, 800, 0, 0, 799);
    int y = map(ts.points[0].y, 480, 0, 0, 479);
    if (x > 20 && x < 780 && y > 74 && y < 382) {
      gfx->fillCircle(x, y, 5, YELLOW);
    } else if (y >= 400) {
      if (x < 186) digitalWrite(LED, HIGH);
      else if (x < 374) digitalWrite(LED, LOW);
      else if (x < 562) gfx->fillRect(17, 71, 766, 314, BLACK);
      else {
        brightness = constrain(map(x, 604, 780, 20, 255), 20, 255);
        ledcWrite(GFX_BL, brightness);
        drawBrightness();
      }
    }
  }
  delay(10);
}
`);
      add(p, 'r1', 'resistor', [470, 540], 0, { ohms: 220 }, 'R1');
      add(p, 'led', 'led', [550, 540], 0, { color: 'red' }, 'LED1');
      rw(p, ['board', 'D17'], ['r1', '1'], '#f08c00');
      rw(p, ['r1', '2'], ['led', 'A'], '#f08c00');
      rw(p, ['led', 'K'], ['board', 'GND2'], '#1f1f1f');
      return p;
    },
  });

  EX.push({
    name: 'Mega 2560 · LED chaser on pins 22–29 + speed knob on A8', build: () => {
      const p = { parts: [], wires: [], code: `// The Arduino Mega 2560 has 54 digital pins and 16 analog inputs.
// Eight LEDs on pins 22..29 (the double header at the right end of the board)
// light up one after another. The potentiometer on A8 sets the speed —
// turn its knob while the simulation runs.
//
// On the Mega, A0..A15 are pins 54..69, so A8 is pin 62.
const int firstLed = 22;

void setup() {
  for (int i = 0; i < 8; i++) pinMode(firstLed + i, OUTPUT);
  Serial.begin(9600);
  Serial.print("A8 is pin ");
  Serial.println(A8);
}

void loop() {
  int knob = analogRead(A8);              // 0..1023
  int wait = map(knob, 0, 1023, 40, 400);  // ms per LED
  Serial.print("knob = ");
  Serial.print(knob);
  Serial.print("  ->  ");
  Serial.print(wait);
  Serial.println(" ms per step");
  for (int i = 0; i < 8; i++) {
    digitalWrite(firstLed + i, HIGH);
    delay(wait);
    digitalWrite(firstLed + i, LOW);
  }
}
` };
      p.parts.push({ id: 'board', type: 'board-mega', x: 20, y: 330, rot: 0, props: {}, name: 'U1' });
      add(p, 'bb', 'breadboard-full', [BBX, BBY], 0, {}, 'BB1');
      const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'red', 'green'];
      for (let i = 0; i < 8; i++) ledUnit(p, i + 1, 2 + i * 6, colors[i], 330);
      add(p, 'pot', 'pot', hole('f50'), 0, { ohms: 10000, pos: 0.5 }, 'POT1');
      const G = '#1f1f1f', R = '#d62828';
      const sig = ['#9b59b6', '#2f7de1', '#f08c00', '#00a86b', '#9b59b6', '#2f7de1', '#f08c00', '#00a86b'];
      for (let i = 0; i < 8; i++) rw(p, ['board', 'D' + (22 + i)], ['bb', 'a' + (2 + i * 6)], sig[i]);
      wire(p, ['bb', 'j50'], ['bb', rail('BN', 50)], G);   // pot end 1 → GND
      wire(p, ['bb', 'j52'], ['bb', rail('BP', 52)], R);   // pot end 2 → 5 V
      rw(p, ['bb', 'j51'], ['board', 'A8'], '#f2c200');      // wiper → A8
      rw(p, ['board', '5V_1'], ['bb', rail('BP', 59)], R);
      rw(p, ['board', 'GND4'], ['bb', rail('BN', 56)], G);
      rw(p, ['board', 'GND3'], ['bb', rail('TN', 1)], G);   // LED cathodes are on the top − rail
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · 74HC595 shift register: 8 LEDs', build: () => {
      const p = P('board-uno-r3', `// A 74HC595 turns 3 Arduino pins into 8 outputs.
// shiftOut() sends 8 bits on DS (data) clocked by SHCP; a pulse on STCP (latch)
// copies them to the outputs Q0..Q7 all at once.
// The oscilloscope (500 ms/div, one whole loop on screen) shows two outputs:
//  - CH1 (yellow) = Q0 (pin 15), CH2 (cyan) = Q1 (pin 1)
//  - running light: each output is high for one 120 ms step in turn
//  - binary counter: Q0 toggles every step (150 ms), Q1 every second step —
//    each output runs at half the rate of the one before it.
// (The data and clock pulses of shiftOut() last only microseconds, far too short
//  to see at this time base; the outputs show what the chip did with them.)
const int dataPin = 11;   // DS   (pin 14)
const int latchPin = 8;   // STCP (pin 12)
const int clockPin = 12;  // SHCP (pin 11)

void show(byte bits) {
  digitalWrite(latchPin, LOW);
  shiftOut(dataPin, clockPin, MSBFIRST, bits);
  digitalWrite(latchPin, HIGH);
}

void setup() {
  pinMode(dataPin, OUTPUT);
  pinMode(latchPin, OUTPUT);
  pinMode(clockPin, OUTPUT);
}

void loop() {
  for (int i = 0; i < 8; i++) { show(1 << i); delay(120); }      // running light
  for (int i = 6; i > 0; i--) { show(1 << i); delay(120); }
  for (int n = 0; n < 16; n++) { show(n); delay(150); }          // binary counter
}
`);
      add(p, 'bb', 'breadboard-full', [BBX, BBY], 0, {}, 'BB1');
      const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'red', 'green'];
      for (let i = 0; i < 8; i++) ledUnit(p, i + 1, 2 + i * 6, colors[i], 330);
      add(p, 'u', 'sr595', hole('f52'), 0, {}, 'U2');
      const G = '#1f1f1f', R = '#d62828';
      // outputs: Q0 = pin 15 (top row, col 53); Q1..Q7 = pins 1..7 (bottom row, cols 52..58)
      rw(p, ['bb', 'a53'], ['bb', 'a2'], '#9b59b6');
      for (let i = 1; i < 8; i++) rw(p, ['bb', 'j' + (51 + i)], ['bb', 'a' + (2 + i * 6)], '#9b59b6');
      wire(p, ['bb', 'a52'], ['bb', rail('TP', 52)], R);  // VCC (16)
      wire(p, ['bb', 'a58'], ['bb', rail('TP', 58)], R);  // MR (10) high
      wire(p, ['bb', 'a55'], ['bb', rail('TN', 55)], G);  // OE (13) low
      wire(p, ['bb', 'j59'], ['bb', rail('BN', 59)], G);  // GND (8)
      rw(p, ['bb', 'b54'], ['board', 'D11'], '#2f7de1'); // DS
      rw(p, ['bb', 'b56'], ['board', 'D8'], '#f08c00');  // STCP
      rw(p, ['bb', 'b57'], ['board', 'D12'], '#f2c200'); // SHCP
      rw(p, ['board', '5V'], ['bb', rail('TP', 45)], R);
      boardGndToTopRail(p, 4);
      rw(p, ['board', 'GND2'], ['bb', rail('BN', 50)], G);
      add(p, 'osc', 'scope', [900, 560], 0, { tdiv: 500, vdiv: 2, vdiv2: 2, pos1: 0, pos2: -4 }, 'OSC1');
      rw(p, ['osc', 'CH1'], ['bb', 'c53'], '#f2c200');   // Q0 (pin 15)
      rw(p, ['osc', 'CH2'], ['bb', 'h52'], '#00b3b3');   // Q1 (pin 1)
      rw(p, ['osc', 'GND'], ['bb', rail('BN', 55)], G);
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · Logic analyzer: watch shiftOut() and a 74HC595', build: () => {
      const p = EX.find((e) => e.name === 'UNO R3 · 74HC595 shift register: 8 LEDs').build();
      p.code = `// The logic analyzer records digital signals against time - here every bit that
// shiftOut() sends to the 74HC595, which is far too fast for the oscilloscope.
//   CH1 = DS (data, pin 11)   CH2 = SHCP (clock, pin 12)   CH3 = STCP (latch, pin 8)
//   CH4..CH7 = outputs Q0..Q3
// It triggers on the falling edge of the latch (CH3) at 20 us/div, so each screen shows
// one complete show() call: the latch goes LOW, eight clock pulses each shift one data bit
// in (MSB first: read CH1 at every rising edge of CH2), then the latch goes HIGH and the
// outputs CH4..CH7 change all at once.
// Each digitalWrite takes about 4 us, as on a real UNO - so one byte takes ~100 us.
// Try it: TIME/DIV + to see more, or set TRIG to OFF for a rolling display of the outputs
// at 50 ms/div.
const int dataPin = 11;   // DS   (pin 14)
const int latchPin = 8;   // STCP (pin 12)
const int clockPin = 12;  // SHCP (pin 11)

void show(byte bits) {
  digitalWrite(latchPin, LOW);
  shiftOut(dataPin, clockPin, MSBFIRST, bits);
  digitalWrite(latchPin, HIGH);
}

void setup() {
  pinMode(dataPin, OUTPUT);
  pinMode(latchPin, OUTPUT);
  pinMode(clockPin, OUTPUT);
}

void loop() {
  for (int n = 0; n < 16; n++) { show(n); delay(300); }   // binary counter on Q0..Q3
}
`;
      p.parts = p.parts.filter((q) => q.id !== 'osc');
      p.wires = p.wires.filter((w) => w.a.part !== 'osc' && w.b.part !== 'osc');
      add(p, 'la', 'logicanalyzer', [880, 600], 0, { tdiv: 0.02, trig: 3, edge: 'fall', thr: 1.4 }, 'LA1');
      const holes = ['c54', 'c57', 'c56', 'c53', 'h52', 'h53', 'h54'];
      const cols = ['#f2c200', '#00b3b3', '#e84393', '#2ecc71', '#f08c00', '#9b59b6', '#e74c3c'];
      holes.forEach((hl, i) => rw(p, ['la', 'CH' + (i + 1)], ['bb', hl], cols[i]));
      rw(p, ['la', 'GND'], ['bb', rail('BN', 56)], '#1f1f1f');
      p.wires.forEach((w, i) => { w.id = 'w' + i; }); // unique ids after removing the scope's wires
      return p;
    },
  });

  EX.push({
    name: 'Electronics · Bode plot: RC low-pass and Sallen-Key filters', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// The Bode plotter measures a circuit's frequency response: its OUT drives the
// circuit with a small sine, IN measures the output, and SWEEP steps the frequency
// from START to STOP. Yellow = gain in dB, cyan dashed = phase in degrees.
// Two filters, one plotter each - press SWEEP on both:
//  - top: RC low-pass, R = 1 kΩ, C = 100 nF. Cut-off f = 1 / (2π·R·C) ≈ 1.59 kHz:
//    -3 dB and -45° there, then -20 dB per decade (-90° phase).
//  - bottom: Sallen-Key low-pass (VCVS gain 1), f0 ≈ 1.07 kHz, Q ≈ 0.74:
//    -40 dB per decade and -180° phase - twice as steep as the RC filter.
// Try it: change C1 or the resistors and sweep again; set the VCVS gain to 1.5 and
// watch a peak appear near f0.`) };
      const G = '#1f1f1f';
      add(p, 'bp1', 'bode', [140, 330], 0, { fstart: 10, fstop: 1e5, ppd: 10, amp: 0.1 }, 'BP1');
      add(p, 'rA', 'resistor', [150, 40], 0, { ohms: 1000 }, 'R1');
      add(p, 'cA', 'capacitor', [250, 70], 0, { farads: 100e-9 }, 'C1');
      rw(p, ['bp1', 'OUT'], ['rA', '1'], '#d62828');
      rw(p, ['rA', '2'], ['cA', '1'], '#2f7de1');
      rw(p, ['cA', '2'], ['bp1', 'COM'], G);
      rw(p, ['bp1', 'IN'], ['cA', '1'], '#f2c200');
      add(p, 'bp2', 'bode', [560, 330], 0, { fstart: 10, fstop: 1e5, ppd: 10, amp: 0.1 }, 'BP2');
      add(p, 'r1', 'resistor', [560, 40], 0, { ohms: 10000 }, 'R2');
      add(p, 'r2', 'resistor', [640, 40], 0, { ohms: 10000 }, 'R3');
      add(p, 'c1', 'capacitor', [720, -40], 0, { farads: 22e-9 }, 'C2');
      add(p, 'c2', 'capacitor', [700, 70], 0, { farads: 10e-9 }, 'C3');
      add(p, 'e1', 'vcvs', [780, 40], 0, { gain: 1 }, 'E1');
      rw(p, ['bp2', 'OUT'], ['r1', '1'], '#d62828');
      rw(p, ['r1', '2'], ['r2', '1'], '#7f8c8d');
      rw(p, ['r1', '2'], ['c1', '1'], '#7f8c8d');
      rw(p, ['r2', '2'], ['c2', '1'], '#2f7de1');
      rw(p, ['r2', '2'], ['e1', 'C+'], '#2f7de1');
      rw(p, ['c1', '2'], ['e1', 'O+'], '#00b3b3');
      rw(p, ['c2', '2'], ['bp2', 'COM'], G);
      rw(p, ['e1', 'C-'], ['bp2', 'COM'], G);
      rw(p, ['e1', 'O-'], ['bp2', 'COM'], G);
      rw(p, ['bp2', 'IN'], ['e1', 'O+'], '#f2c200');
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · NeoPixel ring rainbow', build: () => {
      const p = P('board-uno-r3', `#include <Adafruit_NeoPixel.h>

#define PIN 6
#define NUM 12
Adafruit_NeoPixel ring(NUM, PIN, NEO_GRB + NEO_KHZ800);

void setup() {
  ring.begin();
  ring.setBrightness(80);
}

long hue = 0;
void loop() {
  for (int i = 0; i < NUM; i++) {
    ring.setPixelColor(i, ring.ColorHSV(hue + i * 65536L / NUM));
  }
  ring.show();
  hue += 1024;
  delay(30);
}
`);
      add(p, 'np', 'neopixel', [470, 330], 0, { model: 'ring12' }, 'NP1');
      rw(p, ['np', 'GND'], ['board', 'GND'], '#1f1f1f');
      rw(p, ['np', '5V'], ['board', '5V'], '#d62828');
      rw(p, ['np', 'DIN'], ['board', 'D6'], '#2f7de1');
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · Keypad 4×4 to the Serial Monitor', build: () => {
      const p = P('board-uno-r3', `#include <Keypad.h>

// Click (and hold) the keys of the keypad while the simulation runs.
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

String code = "";

void setup() {
  Serial.begin(9600);
  Serial.println("Type a code and press #");
}

void loop() {
  char key = keypad.getKey();
  if (key) {
    if (key == '#') {
      Serial.println(code == "1234" ? " -> open!" : " -> wrong code");
      code = "";
    } else {
      code += key;
      Serial.print(key);
    }
  }
}
`);
      add(p, 'kp', 'keypad', [440, 420], 0, {}, 'KP1');
      const cols = ['#d62828', '#f08c00', '#f2c200', '#1f9e3a', '#2f7de1', '#6f42c1', '#7f8c8d', '#1f1f1f'];
      ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'].forEach((k, i) => rw(p, ['kp', k], ['board', ['D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2'][i]], cols[i]));
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · IR remote control', build: () => {
      const p = P('board-uno-r3', `#include <IRremote.h>

// Start the simulation, then click the buttons of the IR remote.
// 1 = LED on, 2 = LED off, anything else is printed.
const int RECV_PIN = 11;

void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
  IrReceiver.begin(RECV_PIN, ENABLE_LED_FEEDBACK);
  Serial.println("Press a button on the remote");
}

void loop() {
  if (IrReceiver.decode()) {
    int cmd = IrReceiver.decodedIRData.command;
    Serial.print("Command 0x");
    Serial.println(cmd, HEX);
    if (cmd == 0x0C) digitalWrite(LED_BUILTIN, HIGH);  // button 1
    if (cmd == 0x18) digitalWrite(LED_BUILTIN, LOW);   // button 2
    IrReceiver.resume();
  }
}
`);
      add(p, 'ir', 'irrecv', [430, 300], 0, {}, 'IR1');
      add(p, 'rc', 'irremote', [560, 120], 0, {}, 'RC1');
      rw(p, ['ir', 'OUT'], ['board', 'D11'], '#2f7de1');
      rw(p, ['ir', 'GND'], ['board', 'GND'], '#1f1f1f');
      rw(p, ['ir', 'VCC'], ['board', '5V'], '#d62828');
      return p;
    },
  });

  EX.push({
    name: 'UNO R3 · Transistor motor driver (PWM speed)', build: () => {
      const p = P('board-uno-r3', `// A small motor needs far more current than an Arduino pin can give (about 20 mA).
// The TIP120 power transistor (an NPN Darlington) switches the motor's current
// from the 9 V battery; the pin only feeds the base through 1 kΩ (about 4 mA). The diode across the motor (flyback diode)
// protects the transistor when the motor is switched off.
const int motorPin = 9;

void setup() {
  Serial.begin(9600);
}

void loop() {
  for (int speed = 0; speed <= 255; speed += 51) {
    analogWrite(motorPin, speed);
    Serial.print("speed ");
    Serial.println(speed);
    delay(1500);
  }
}
`);
      breadboard(p);
      add(p, 'q', 'darlington', hole('f10'), 0, {}, 'Q1');
      add(p, 'rb', 'resistor', hole('i5'), 0, { ohms: 1000 }, 'R1');
      add(p, 'd', 'diode', hole('j11'), 0, { model: '1N4001' }, 'D1');
      add(p, 'm', 'motor', [560, 340], 0, { model: 'dc' }, 'M1');
      add(p, 'bat', 'battery', [430, 380], 0, { volts: 9 }, 'BAT1');
      const G = '#1f1f1f', R = '#d62828';
      rw(p, ['board', 'D9'], ['bb', 'j5'], '#2f7de1');
      wire(p, ['bb', 'g9'], ['bb', 'g10'], '#f08c00');             // resistor → base (B C E = cols 10 11 12)
      wire(p, ['bb', 'h12'], ['bb', rail('BN', 13)], G);           // emitter → GND
      rw(p, ['m', '-'], ['bb', 'h11'], '#7f8c8d');                 // motor → collector
      rw(p, ['m', '+'], ['bat', '+'], R);
      rw(p, ['bb', 'h15'], ['bat', '+'], R);                       // diode cathode → +9 V
      rw(p, ['bat', '-'], ['bb', rail('BN', 20)], G);
      rw(p, ['board', 'GND2'], ['bb', rail('BN', 2)], G);
      return p;
    },
  });

  EX.push({
    name: 'Electronics · 555 timer LED blinker', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// A 555 timer in astable mode blinks an LED with no microcontroller.
// The 10 µF capacitor charges through R1 + R2 and discharges through R2:
//   f = 1.44 / ((R1 + 2·R2) · C) = 1.44 / ((1 kΩ + 94 kΩ) · 10 µF) ≈ 1.5 Hz
// The oscilloscope (200 ms/div) shows how it works:
//  - CH1 (yellow) = output, pin 3: high while C charges, low while it discharges
//  - CH2 (cyan) = capacitor voltage (pins 2 and 6): a sawtooth between 1/3 and 2/3 of
//    the 9 V supply (3 V and 6 V). At 6 V the 555 switches off and pin 7 discharges C;
//    at 3 V it switches on again. Charging (through R1 + R2) is slightly slower than
//    discharging (through R2 only), so the output is high a little longer than low.
// Try it: change R2 to 10 kΩ (faster) or C to 47 µF (slower).`) };
      breadboard(p);
      add(p, 'u', 'timer555', hole('f10'), 0, {}, 'U1');
      add(p, 'r1', 'resistor', hole('b16'), 0, { ohms: 1000 }, 'R1');
      add(p, 'r2', 'resistor', hole('d20'), 0, { ohms: 47000 }, 'R2');
      add(p, 'c', 'ecap', hole('c24'), 0, { farads: 10e-6 }, 'C1');
      add(p, 'r3', 'resistor', hole('i12'), 0, { ohms: 330 }, 'R3');
      add(p, 'led', 'led', hole('h16'), 0, { color: 'red' }, 'LED1');
      add(p, 'bat', 'battery', [170, 140], 0, { volts: 9 }, 'BAT1');
      const G = '#1f1f1f', R = '#d62828';
      rw(p, ['bat', '+'], ['bb', rail('TP', 1)], R);
      rw(p, ['bat', '-'], ['bb', rail('TN', 1)], G);
      wire(p, ['bb', rail('TP', 28)], ['bb', rail('BP', 28)], R);
      wire(p, ['bb', rail('TN', 29)], ['bb', rail('BN', 29)], G);
      wire(p, ['bb', 'a10'], ['bb', rail('TP', 10)], R);   // pin 8 VCC
      wire(p, ['bb', 'j10'], ['bb', rail('BN', 10)], G);   // pin 1 GND
      wire(p, ['bb', 'j13'], ['bb', rail('BP', 13)], R);   // pin 4 RESET
      wire(p, ['bb', 'a16'], ['bb', rail('TP', 16)], R);   // R1 to VCC
      wire(p, ['bb', 'c20'], ['bb', 'c11'], '#f08c00');    // R1/R2 → pin 7 DIS
      wire(p, ['bb', 'a24'], ['bb', 'a12'], '#2f7de1');    // R2/C → pin 6 THR
      wire(p, ['bb', 'b12'], ['bb', 'g11'], '#2f7de1');    // THR → pin 2 TRIG
      wire(p, ['bb', 'a25'], ['bb', rail('TN', 25)], G);   // C − → GND
      wire(p, ['bb', 'j17'], ['bb', rail('BN', 17)], G);   // LED cathode → GND
      add(p, 'osc', 'scope', [570, 550], 0, { tdiv: 200, vdiv: 2, vdiv2: 2, pos1: 0, pos2: -4 }, 'OSC1');
      rw(p, ['osc', 'CH1'], ['bb', 'h12'], '#f2c200');     // pin 3 OUT
      rw(p, ['osc', 'CH2'], ['bb', 'e24'], '#00b3b3');     // capacitor + (pins 2 / 6)
      rw(p, ['osc', 'GND'], ['bb', rail('BN', 26)], G);
      return p;
    },
  });


  EX.push({
    name: 'Electronics · LM358 op-amp: amplifier + comparator', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// Both halves of an LM358 dual op-amp on one 9 V battery.
// Op-amp A is a non-inverting amplifier: gain = 1 + Rf / Rg = 1 + 20k / 10k = 3.
//   input: 1 Hz sine, 1 V peak-to-peak around 1.5 V  ->  output: 3 Vpp around 4.5 V
//   scope CH1 (yellow) = input (pin 3), CH2 (cyan) = output (pin 1)
// Op-amp B is a comparator: its output goes high (LED on) whenever the amplified
// signal on pin 5 is above the threshold set by the trimmer on pin 6.
// Try it: drag the trimmer to move the threshold (the LED's on-time changes),
// or change Rf to 47 kΩ for a gain of 5.7 — the output then clips near 7.5 V,
// because an LM358 can't swing closer than about 1.5 V to its positive supply.`) };
      add(p, 'u', 'lm358', [430, 300], 0, {}, 'U1');
      add(p, 'bat', 'battery', [640, 240], 0, { volts: 9 }, 'BAT1');
      add(p, 'fg', 'fgen', [110, 400], 0, { shape: 'sine', freq: 1, vpp: 1, offset: 1.5 }, 'FG1');
      add(p, 'rg', 'resistor', [330, 430], 0, { ohms: 10000 }, 'Rg');
      add(p, 'rf', 'resistor', [360, 200], 0, { ohms: 20000 }, 'Rf');
      add(p, 'tp', 'trimpot', [520, 430], 0, { ohms: 10000, pos: 0.5 }, 'RV1');
      add(p, 'rl', 'resistor', [560, 360], 0, { ohms: 1000 }, 'R1');
      add(p, 'led', 'led', [640, 400], 0, { color: 'green' }, 'LED1');
      add(p, 'osc', 'scope', [820, 700], 0, { tdiv: 200, vdiv: 2, vdiv2: 2, pos1: -2, pos2: -2 }, 'OSC1');
      const G = '#1f1f1f', R = '#d62828';
      rw(p, ['bat', '+'], ['u', '8'], R);
      rw(p, ['bat', '-'], ['u', '4'], G);
      rw(p, ['bat', '-'], ['fg', 'COM'], G);
      rw(p, ['fg', '+'], ['u', '3'], '#2f7de1');
      rw(p, ['u', '2'], ['rg', '2'], '#f08c00');
      rw(p, ['rg', '1'], ['u', '4'], G);
      rw(p, ['u', '1'], ['rf', '2'], '#9b59b6');
      rw(p, ['rf', '1'], ['u', '2'], '#f08c00');
      rw(p, ['u', '1'], ['u', '5'], '#9b59b6');
      rw(p, ['tp', 'W'], ['u', '6'], '#1f9e3a');
      rw(p, ['tp', '1'], ['bat', '+'], R);
      rw(p, ['tp', '2'], ['bat', '-'], G);
      rw(p, ['u', '7'], ['rl', '1'], '#f2c200');
      rw(p, ['rl', '2'], ['led', 'A'], '#f2c200');
      rw(p, ['led', 'K'], ['bat', '-'], G);
      rw(p, ['osc', 'CH1'], ['u', '3'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['u', '1'], '#00b3b3');
      rw(p, ['osc', 'GND'], ['bat', '-'], G);
      return p;
    },
  });

  EX.push({
    name: 'Electronics · Diode V-I curve (scope in X-Y mode)', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// Draw a diode's current–voltage characteristic on the oscilloscope.
// The function generator sweeps a 20 Vpp triangle wave through the diode and a 100 Ω
// resistor. Its output is set to FLOATING so that the scope ground can sit between
// the diode and the resistor:
//  - CH1 = voltage across the diode (anode)                -> X axis
//  - CH2 = voltage across the resistor = current × 100 Ω   -> Y axis
//    CH2 is measured "backwards" across the resistor, so it is set to INV.
// With the scope in X-Y mode the dot traces the curve: flat (no current) for
// negative voltages, then a steep rise once the diode conducts at about 0.7 V.
// 1 V on the Y axis = 10 mA.
// Try it: set CH1 to 0.5 V/div to zoom in on the knee, swap in a Schottky diode
// (knee at about 0.3 V), an LED, or a 5.1 V zener — the zener also conducts
// in reverse, below −5.1 V. Press X-Y again to see both signals against time.`) };
      add(p, 'fg', 'fgen', [130, 260], 0, { shape: 'triangle', freq: 50, vpp: 20, offset: 0, floating: true }, 'FG1');
      add(p, 'd', 'diode', [360, 110], 0, { model: '1N4001' }, 'D1');
      add(p, 'r', 'resistor', [360, 300], 0, { ohms: 100 }, 'R1');
      add(p, 'osc', 'scope', [700, 600], 0, { tdiv: 2, vdiv: 2, vdiv2: 2, pos1: 2, pos2: -2, inv2: true, xy: true }, 'OSC1');
      const G = '#1f1f1f';
      rw(p, ['fg', '+'], ['d', 'A'], '#d62828');
      rw(p, ['d', 'K'], ['r', '2'], '#7f8c8d');
      rw(p, ['r', '1'], ['fg', 'COM'], G);
      rw(p, ['osc', 'GND'], ['d', 'K'], G);
      rw(p, ['osc', 'CH1'], ['d', 'A'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['fg', 'COM'], '#00b3b3');
      return p;
    },
  });

  EX.push({
    name: 'Electronics · LED I–V curve: DC sweep on the dual power supply (scope X-Y)', build: () => {
      const p = { parts: [], wires: [], code: NOCODE(`// Measure an LED's current–voltage curve with a swept DC supply.
// CH1 of the dual power supply is set to SWEEP: every 40 ms it ramps from 0 V up to
// 5 V and back down (the SWP button cycles off → ramp → up and down; the start voltage
// and sweep time are in its settings). The LED and a 100 Ω current-sense resistor are
// in series across CH1. The scope ground sits between them:
//  - scope CH1 = voltage across the LED                     -> X axis
//  - scope CH2 = voltage across the resistor = I × 100 Ω    -> Y axis (INV, as it is
//    measured backwards across the resistor)
// In X-Y mode the trace is the LED's I–V curve: nothing flows below about 1.8 V,
// then the current rises steeply. 1 V on the Y axis = 10 mA.
// Try it: change the LED's colour (blue and white start near 2.7 V), raise the sweep's
// set voltage, or press X-Y on the scope to see the sweep against time.`) };
      add(p, 'ps', 'psu2', [120, 300], 0, { mode: 'indep', v1: 5, i1: 0.1, v2: 0, i2: 0.1, sw1: 'tri', lo1: 0, per1: 0.04, sw2: 'off', lo2: 0, per2: 1 }, 'PS1');
      add(p, 'led', 'led', [470, 120], 0, { color: 'red' }, 'LED1');
      add(p, 'r', 'resistor', [470, 300], 0, { ohms: 100 }, 'R1');
      add(p, 'osc', 'scope', [760, 640], 0, { tdiv: 5, vdiv: 0.5, vdiv2: 0.5, pos1: -3, pos2: -3, inv2: true, xy: true }, 'OSC1');
      const G = '#1f1f1f';
      rw(p, ['ps', '1+'], ['led', 'A'], '#d62828');
      rw(p, ['led', 'K'], ['r', '2'], '#7f8c8d');
      rw(p, ['r', '1'], ['ps', '1-'], G);
      rw(p, ['osc', 'GND'], ['led', 'K'], G);
      rw(p, ['osc', 'CH1'], ['led', 'A'], '#f2c200');
      rw(p, ['osc', 'CH2'], ['ps', '1-'], '#00b3b3');
      return p;
    },
  });

  // ---------------------------------------------------------------- menu categories
  // The Examples menu groups examples under these headings, in this order. Each example
  // name must appear exactly once; anything missing lands in "Other".
  const CATS = [
    ['DC circuits', ['No code · Battery, switch and LED', 'Electronics · Zener voltage regulator']],
    ['Transients (RC, RL, RLC)', ['Electronics · Capacitor charging (power supply + switch)', 'Electronics · RL circuit: inductor with a square wave', 'Electronics · RLC circuit: underdamped ringing']],
    ['AC circuits & filters', ['Electronics · RC low-pass filter (function generator + scope)', 'Electronics · Bode plot: RC low-pass and Sallen-Key filters', 'Electronics · Half-wave rectifier with smoothing capacitor']],
    ['Semiconductors & ICs', ['Electronics · Diode V-I curve (scope in X-Y mode)', 'Electronics · LED I–V curve: DC sweep on the dual power supply (scope X-Y)', 'Electronics · 555 timer LED blinker', 'Electronics · LM358 op-amp: amplifier + comparator']],
    ['Controlled sources', ['Controlled sources · Sallen-Key low-pass filter (VCVS)', 'Controlled sources · Sallen-Key high-pass filter (VCVS)', 'Controlled sources · Transistor small-signal model (CCCS)']],
    ['Arduino basics', ['Mega 2560 · LED chaser on pins 22–29 + speed knob on A8', 'UNO Q · Blink (built-in LED)', 'UNO Q · Blink an external LED', 'UNO Q · Button controls LED', 'UNO Q · Fade an LED (PWM)', 'UNO Q · Potentiometer dimmer + Serial', 'UNO R3 · Traffic light', 'Nano · on a breadboard']],
    ['Arduino + measuring & analog', ['UNO Q · Measuring: multimeter & oscilloscope (v0.2)', 'UNO Q · PWM + RC filter = analog voltage', 'UNO R3 · Transistor motor driver (PWM speed)']],
    ['Arduino output: displays, sound & motion', ['UNO Q · LED matrix bouncing dot', 'UNO R4 WiFi · LED matrix heartbeat', 'UNO R3 · LCD 16×2: hello + seconds counter', 'UNO R3 · 74HC595 shift register: 8 LEDs', 'UNO R3 · Logic analyzer: watch shiftOut() and a 74HC595', 'UNO R3 · NeoPixel ring rainbow', 'UNO R3 · Melody on a piezo buzzer', 'UNO R4 WiFi · Servo sweep']],
    ['Touch screens: Nextion & CYD', ['UNO R3 · Nextion 7" touch display: knob, bar, gauge and LED buttons', 'CYD · touch screen: draw, RGB LED buttons, light sensor', 'CYD · potentiometer gauge on IO35 + LED dimmer on IO27', 'CYD 7" · touch screen: draw, LED buttons, backlight brightness']],
    ['Arduino input & sensors', ['UNO Q · TMP36 thermometer', 'UNO R3 · Ultrasonic distance (HC-SR04)', 'UNO Q · PIR motion detector', 'UNO R3 · Keypad 4×4 to the Serial Monitor', 'UNO R3 · IR remote control', 'UNO Q · Modulino Buttons, Pixels & Buzzer', 'UNO Q · Modulino sensors (Knob, Distance, Thermo, Movement)']],
  ];
  const catOf = new Map();
  CATS.forEach(([cat, names]) => names.forEach((n) => catOf.set(n, cat)));
  for (const ex of EX) {
    ex.category = catOf.get(ex.name) || 'Other';
    // the heading already says what kind of circuit it is
    ex.label = ex.name.replace(/^(Electronics|No code|Controlled sources) · /, '');
    if (ex.category === 'Other') console.warn('JumperCraft: example without a menu category:', ex.name);
  }
  WB.EXAMPLE_CATEGORIES = CATS.map(([c]) => c).concat(EX.some((e) => e.category === 'Other') ? ['Other'] : []);

  WB.EXAMPLES = EX;
})(window.WB);

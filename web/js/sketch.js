'use strict';
(function (WB) {
  // ------------------------------------------------------------------
  // Arduino C++ (common subset) -> JavaScript transpiler.
  // Line numbers are preserved so errors point at the right sketch line.
  // ------------------------------------------------------------------
  const BASE_TYPES = ['bool', 'boolean', 'char', 'short', 'int', 'long', 'float', 'double', 'byte', 'word', 'String', 'size_t',
    'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'unsigned', 'signed', 'auto'];
  const CLASSES = ['Servo', 'Arduino_LED_Matrix', 'ArduinoLEDMatrix', 'ModulinoButtons', 'ModulinoBuzzer', 'ModulinoPixels', 'ModulinoKnob',
    'ModulinoDistance', 'ModulinoMovement', 'ModulinoThermo', 'ModulinoColor', 'LiquidCrystal', 'LiquidCrystal_I2C', 'Adafruit_NeoPixel', 'Keypad', 'IRrecv', 'decode_results', 'SoftwareSerial', 'TFT_eSPI', 'XPT2046_Touchscreen', 'TS_Point', 'SPIClass'];
  const QUAL = '(?:(?:const|static|volatile|unsigned|signed|inline|constexpr)\\s+)*';
  const TYPE_ALT = '(?:' + ['void'].concat(BASE_TYPES, CLASSES).join('|') + ')\\b';
  const VTYPE = '(' + BASE_TYPES.concat(CLASSES).join('|') + ')\\b';
  const NUMTYPE = '(?:' + BASE_TYPES.filter((t) => t !== 'String' && t !== 'auto').join('|') + ')\\b';
  const MORE = '(?:\\s+(?:long|int|char|short|double)\\b)*';
  const KEYWORDS = new Set(['if', 'else', 'while', 'for', 'do', 'switch', 'case', 'return', 'break', 'continue', 'sizeof', 'new', 'delete', 'default', 'goto']);
  const SIZES = { char: 1, byte: 1, bool: 1, boolean: 1, int8_t: 1, uint8_t: 1, short: 2, int: 2, word: 2, int16_t: 2, uint16_t: 2, long: 4, float: 4, double: 4, int32_t: 4, uint32_t: 4, size_t: 2, int64_t: 8, uint64_t: 8 };

  const countNL = WB.countNL;

  function protect(src) {
    const lits = [];
    let out = '', i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
        i += 2; out += ' '; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        let lit = src.slice(i, j + (src[j] === c ? 1 : 0));
        if (src[j] !== c) lit += c;
        lits.push(lit);
        out += '\u0003' + (lits.length - 1) + '\u0003';
        i = src[j] === c ? j + 1 : j;
        continue;
      }
      out += c; i++;
    }
    return { code: out, lits };
  }

  // Names declared by the sketch (variables, parameters, functions, #defines), collected while translating.
  let DECLARED = new Set();
  let FLOATS = new Set(); // float / double variables and parameters (for integer division)

  class CompileError {
    constructor(line, message, hint) { this.line = line; this.message = message; this.hint = hint || ''; }
  }

  // ------------------------------------------------------------------
  // Arduino-style checks on the sketch (comments and strings already removed,
  // line structure preserved): bracket balance and missing semicolons.
  // ------------------------------------------------------------------
  const OPEN = { '(': ')', '[': ']', '{': '}' };
  const CLOSE = { ')': '(', ']': '[', '}': '{' };
  function checkStructure(code) {
    const lines = code.split('\n');
    const stack = []; // {ch, line, init}
    const info = []; // per line: paren depth at end, inside initializer at end
    let lastSig = '', lastWord = '';
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      for (let k = 0; k < L.length; k++) {
        const ch = L[k];
        if (/[A-Za-z_]/.test(ch)) { const w = L.slice(k).match(/^[A-Za-z_]\w*/)[0]; lastWord = w; lastSig = w[w.length - 1]; k += w.length - 1; continue; }
        if (OPEN[ch]) {
          const init = ch === '{' && (lastSig === '=' || ((lastSig === ',' || lastSig === '{') && stack.length && stack[stack.length - 1].init));
          stack.push({ ch, line: li + 1, init, isFor: ch === '(' && lastWord === 'for' && /[A-Za-z_]/.test(lastSig) });
        } else if (ch === ';' && stack.length && stack[stack.length - 1].ch === '(' && !stack[stack.length - 1].isFor) {
          const ol = stack[stack.length - 1].line;
          return new CompileError(li + 1, "expected ')' before ';'", ol !== li + 1 ? `The '(' opened on line ${ol} is never closed.` : `A '(' on this line is never closed.`);
        } else if (CLOSE[ch]) {
          const top = stack.pop();
          if (!top) return new CompileError(li + 1, `expected ';' or an expression before '${ch}' — there is an extra '${ch}' here`, 'Remove it, or add the missing opening bracket.');
          if (top.ch !== CLOSE[ch]) {
            return new CompileError(li + 1, `expected '${OPEN[top.ch]}' before '${ch}'`, `The '${top.ch}' opened on line ${top.line} is closed with '${ch}'.`);
          }
        }
        if (!/\s/.test(ch)) lastSig = ch;
      }
      const parens = stack.filter((s) => s.ch !== '{').length;
      const top = stack[stack.length - 1];
      info.push({ parens, init: !!(top && top.init) });
    }
    if (stack.length) {
      const s = stack[stack.length - 1];
      const missing = OPEN[s.ch];
      return new CompileError(s.line, `expected '${missing}' at end of input — the '${s.ch}' on this line is never closed`, `Add a matching '${missing}'.`);
    }
    // Missing semicolons
    const nextLine = (i) => { for (let j = i + 1; j < lines.length; j++) { const t = lines[j].trim(); if (t) return t; } return ''; };
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || t.startsWith('#')) continue;
      if (info[i].parens > 0 || info[i].init) continue; // statement continues on the next line
      const c = t[t.length - 1];
      if (';{},:'.includes(c)) continue;
      if ('([=+-*/%<>&|!?^~.'.includes(c)) continue;
      const n = nextLine(i);
      if (n.startsWith('{') || /^([.)?:+\-*/%&|=<>^,\]]|&&|\|\|)/.test(n)) continue;
      if (/^(\}\s*)?(else|do)$/.test(t)) continue;
      if (/^(\}\s*)?(else\s+)?(if|for|while|switch)\s*\(.*\)$/.test(t)) continue;
      const nextTok = (n.match(/^[A-Za-z_]\w*|^\S/) || [''])[0];
      return new CompileError(i + 1, `expected ';' at end of line${nextTok && nextTok !== '}' ? ` (before '${nextTok}')` : ''}`, 'Every statement must end with a semicolon.');
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Undeclared names, checked on the translated code (strings are placeholders).
  // ------------------------------------------------------------------
  const JS_WORDS = new Set('let const var async function await return if else for while do switch case default break continue new typeof instanceof true false null undefined of in this void delete try catch throw class NaN Infinity Math Number Array Object'.split(' '));
  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
    return d[a.length][b.length];
  }
  // ------------------------------------------------------------------
  // #include checks: library exists in the simulator, is spelled right,
  // suits the selected board, and is included when its classes are used.
  // ------------------------------------------------------------------
  const MODULINO_CLASSES = ['ModulinoButtons', 'ModulinoBuzzer', 'ModulinoPixels', 'ModulinoKnob', 'ModulinoDistance', 'ModulinoMovement', 'ModulinoThermo', 'ModulinoColor', 'Modulino'];
  const LIBRARIES = {
    'Servo.h': { provides: ['Servo'] },
    'Arduino_LED_Matrix.h': { provides: ['Arduino_LED_Matrix', 'ArduinoLEDMatrix'], needs: 'matrix', boards: 'UNO Q and UNO R4 WiFi (boards with a built-in LED matrix)' },
    'Modulino.h': { provides: MODULINO_CLASSES },
    'Arduino_RouterBridge.h': { provides: ['Bridge', 'Monitor'], needs: 'bridge', boards: 'UNO Q' },
    'Arduino.h': { provides: [] },
    'LiquidCrystal.h': { provides: ['LiquidCrystal'] },
    'LiquidCrystal_I2C.h': { provides: ['LiquidCrystal_I2C'] },
    'Wire.h': { provides: [] },
    'Adafruit_NeoPixel.h': { provides: ['Adafruit_NeoPixel'] },
    'Keypad.h': { provides: ['Keypad', 'makeKeymap'] },
    'IRremote.h': { provides: ['IrReceiver', 'IRrecv', 'decode_results'], alias: 'IRremote.hpp' },
    'IRremote.hpp': { provides: ['IrReceiver', 'IRrecv', 'decode_results'], alias: 'IRremote.h' },
    'SoftwareSerial.h': { provides: ['SoftwareSerial'] },
    'SPI.h': { provides: ['SPIClass', 'SPISettings'] },
    'TFT_eSPI.h': { provides: ['TFT_eSPI'], needs: 'cyd', boards: 'CYD (ESP32 Cheap Yellow Display) — the simulator draws on its built-in screen' },
    'XPT2046_Touchscreen.h': { provides: ['XPT2046_Touchscreen', 'TS_Point'], needs: 'cyd', boards: 'CYD (ESP32 Cheap Yellow Display) — its built-in touch screen' },
  };
  // Standard headers that need nothing extra in the simulator
  const STD_HEADERS = ['math.h', 'stdlib.h', 'string.h', 'stdint.h', 'stdbool.h', 'stdio.h', 'ctype.h', 'limits.h', 'avr/pgmspace.h', 'avr/io.h', 'avr/interrupt.h', 'cmath', 'cstdint'];
  const LIB_LIST = 'Servo.h, LiquidCrystal.h, LiquidCrystal_I2C.h, Wire.h, Adafruit_NeoPixel.h, Keypad.h, IRremote.h, SoftwareSerial.h, SPI.h, TFT_eSPI.h + XPT2046_Touchscreen.h (CYD), Arduino_LED_Matrix.h, Modulino.h, Arduino_RouterBridge.h (UNO Q)';

  function checkIncludes(code, lits, board) {
    const lines = code.split('\n');
    const included = new Set();
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!/^#\s*include\b/.test(t)) continue;
      const raw = t.replace(/\u0003(\d+)\u0003/g, (m, k) => lits[+k]);
      const m = raw.match(/^#\s*include\s*(?:<\s*([^>]+?)\s*>|"\s*([^"]+?)\s*")\s*$/);
      if (!m) return new CompileError(i + 1, '#include expects "FILENAME" or <FILENAME>', 'Example: #include <Servo.h>');
      const name = m[1] || m[2];
      if (STD_HEADERS.includes(name)) continue;
      if (LIBRARIES[name]) {
        const lib = LIBRARIES[name];
        if (board && lib.needs === 'matrix' && !board.matrix) return new CompileError(i + 1, `${name} can't be used with the ${board.label}`, `This library is only for the ${lib.boards}. Change the board or remove the include.`);
        if (board && lib.needs === 'bridge' && board.short !== 'UNO Q') return new CompileError(i + 1, `${name} can't be used with the ${board.label}`, `The Bridge library is only for the ${lib.boards}.`);
        if (board && lib.needs === 'cyd' && !board.cyd) return new CompileError(i + 1, `${name} can't be used with the ${board.label} in the simulator`, `It works with the ${lib.boards}. Change the board, or remove the include.`);
        included.add(name);
        continue;
      }
      // Not available: suggest the closest supported name (case / typo / missing .h)
      let best = null, bd = 4;
      for (const k of Object.keys(LIBRARIES)) {
        const d = editDistance(name.toLowerCase(), k.toLowerCase());
        if (d < bd) { bd = d; best = k; }
      }
      return new CompileError(i + 1, `fatal error: ${name}: No such file or directory`,
        best ? `Did you mean <${best}>? (Library names are case-sensitive.)` : `This library isn't supported by the simulator. Supported libraries: ${LIB_LIST}.`);
    }
    // Library classes used without their #include
    for (const [hdr, lib] of Object.entries(LIBRARIES)) {
      if (included.has(hdr) || !lib.provides.length) continue;
      if (lib.alias && included.has(lib.alias)) continue;
      const re = new RegExp('(?<![\\w.$])(' + lib.provides.join('|') + ')\\b', 'g');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('#')) continue;
        const mm = re.exec(lines[i]);
        re.lastIndex = 0;
        if (mm) {
          if (board && lib.needs === 'matrix' && !board.matrix) return new CompileError(i + 1, `'${mm[1]}' was not declared in this scope`, `The ${board.label} has no built-in LED matrix (only the ${lib.boards} do).`);
          if (board && lib.needs === 'bridge' && board.short !== 'UNO Q') return new CompileError(i + 1, `'${mm[1]}' was not declared in this scope`, `${mm[1]} is part of the UNO Q Bridge library. On this board use Serial instead.`);
          return new CompileError(i + 1, `'${mm[1]}' was not declared in this scope`, `Add #include <${hdr}> at the top of the sketch.`);
        }
      }
    }
    return null;
  }

  const SUPPORTED_LIBS = ['Servo', 'Arduino_LED_Matrix', 'Modulino', 'Arduino_RouterBridge', 'Arduino', 'LiquidCrystal', 'LiquidCrystal_I2C', 'Wire', 'Adafruit_NeoPixel', 'Keypad', 'IRremote', 'SoftwareSerial', 'SPI', 'TFT_eSPI', 'XPT2046_Touchscreen'];
  // The sketch runs as JavaScript in the page, so a sketch from a shared project must not reach
  // anything outside the simulator. Names starting with "__" are the simulator's own (and reserved
  // in C++ too), and the JavaScript object internals below lead out of the sandbox — none of them
  // exist in Arduino C++. Checked on the user's own code: comments and strings already removed.
  const FORBIDDEN_MEMBERS = /\.\s*(constructor|prototype|__proto__|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__|caller|callee)\b/;
  function checkSafety(code) {
    const lineOf = (i) => WB.countNL(code.slice(0, i)) + 1;
    let m = /(?<![\w$])(__\w*|this|globalThis|window|self|document|eval|Function|Object|Reflect|Proxy|import)\b/.exec(code);
    if (m && !/^(this)$/.test(m[1])) return new CompileError(lineOf(m.index), `'${m[1]}' is not allowed in a sketch`, m[1].startsWith('__') ? 'Names starting with two underscores are reserved — rename it.' : 'This name is reserved by the simulator — rename it.');
    if (m) return new CompileError(lineOf(m.index), "'this' is not supported in the simulator", 'Use the variable or object name directly.');
    m = FORBIDDEN_MEMBERS.exec(code);
    if (m) return new CompileError(lineOf(m.index), `'.${m[1]}' is not allowed in a sketch`, 'This is not part of Arduino C++.');
    return null;
  }

  function checkIdentifiers(code, known, libs) {
    const unsupported = (libs || []).map((l) => (l.match(/[<\u0003"]\s*([\w./-]+?)(?:\.h)?\s*[>"\u0003]?$/) || [])[1]).filter((n) => n && !SUPPORTED_LIBS.includes(n));
    const re = /(?<![\w.$\u0003])[A-Za-z_]\w*/g;
    let m;
    while ((m = re.exec(code))) {
      const name = m[0];
      if (known.has(name) || JS_WORDS.has(name) || name.startsWith('__')) continue;
      const line = WB.countNL(code.slice(0, m.index)) + 1;
      let best = null, bd = 3;
      for (const k of known) {
        if (k.startsWith('__') || Math.abs(k.length - name.length) > 2) continue;
        const dd = editDistance(name, k);
        if (dd < bd) { bd = dd; best = k; }
      }
      const isCall = /^\s*\(/.test(code.slice(re.lastIndex));
      const isType = /^\s+[A-Za-z_]/.test(code.slice(re.lastIndex));
      let hint;
      if (unsupported.length) hint = `The library ${unsupported.map((u) => '<' + u + '.h>').join(', ')} isn't supported by the simulator. Supported: ${LIB_LIST}.`;
      else if (best) hint = `Did you mean '${best}'?`;
      else if (isType) hint = `'${name}' is not a known type. Supported libraries: ${LIB_LIST}.`;
      else if (isCall) hint = 'This function does not exist (or its library is not supported).';
      else hint = 'Declare the variable first, e.g. int ' + name + ' = 0;';
      return new CompileError(line, `'${name}' was not declared in this scope`, hint);
    }
    return null;
  }

  function splitTop(s, sep) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === sep && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts;
  }

  function convParams(p) {
    p = p.trim();
    if (!p || p === 'void') return '';
    return splitTop(p, ',').map((x) => {
      let def = '';
      const eq = x.indexOf('=');
      if (eq >= 0) { def = ' = ' + x.slice(eq + 1).trim(); x = x.slice(0, eq); }
      x = x.replace(/\[[^\]]*\]/g, '');
      const m = x.match(/([A-Za-z_]\w*)\s*$/);
      if (m) DECLARED.add(m[1]);
      if (m && /\b(float|double)\b/.test(x)) FLOATS.add(m[1]);
      return (m ? m[1] : '_') + def;
    }).join(', ');
  }

  const INT_TYPES = new Set(['short', 'int', 'long', 'byte', 'word', 'size_t', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'unsigned', 'signed']);

  function convertDeclarators(body, type, vars) {
    const isClass = CLASSES.includes(type);
    const isInt = INT_TYPES.has(type);
    return splitTop(body, ',').map((raw) => {
      const m = raw.match(/^\s*([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)(?:\(([\s\S]*)\))?\s*(?:=\s*([\s\S]*))?$/);
      if (!m) return raw.trim();
      const name = m[1], dimsRaw = m[2], ctor = m[3], init = m[4];
      DECLARED.add(name);
      if (type === 'float' || type === 'double') FLOATS.add(name);
      const dims = [...dimsRaw.matchAll(/\[([^\]]*)\]/g)].map((x) => x[1].trim() || '0');
      if (vars && !dims.length) (isInt ? vars.ints : vars.others).add(name);
      let val;
      if (init !== undefined) {
        let v = init.trim();
        if (v.startsWith('{')) v = v.replace(/\{/g, '[').replace(/\}/g, ']');
        val = dims.length && v.startsWith('[') ? `__arr([${dims.join(',')}], ${v})` : isInt && !dims.length ? `__i(${v})` : v;
      } else if (ctor !== undefined) val = isClass ? `new ${type}(${ctor})` : `(${ctor})`;
      else if (dims.length) val = `__arr([${dims.join(',')}], null)`;
      else if (isClass) val = `new ${type}()`;
      else if (type === 'String') val = '""';
      else val = '0';
      return `${name} = ${val}`;
    }).join(', ');
  }

  // Wrap assignments to integer variables so they truncate like C (x = a / b; x += 0.5; ...).
  function intAssignments(code, ints) {
    if (!ints.size) return code;
    const re = new RegExp('(?<![\\w.$])(' + [...ints].join('|') + ')\\s*([-+*/%]?=)(?!=)', 'g');
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      const before = prevNonSpace(code, m.index);
      if (!/[;{}()\n]/.test(before) && !/\belse\s*$/.test(code.slice(Math.max(0, m.index - 8), m.index))) continue;
      let j = re.lastIndex, d = 0;
      for (; j < code.length; j++) {
        const c = code[j];
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; }
        else if ((c === ';' || c === ',') && d === 0) break;
      }
      const expr = code.slice(re.lastIndex, j);
      const name = m[1], op = m[2];
      out += code.slice(last, m.index) + name + ' = __i(' + (op === '=' ? expr : name + ' ' + op[0] + ' (' + expr + ')') + ')';
      last = j;
      re.lastIndex = j;
    }
    return out + code.slice(last);
  }

  function processDecls(code) {
    let out = '', i = 0, depth = 0;
    const hoisted = [];
    const vars = { ints: new Set(), others: new Set() };
    while (i < code.length) {
      const ch = code[i];
      if (ch === '\u0001') {
        const end = code.indexOf('\u0001', i + 1);
        const tag = code.slice(i + 1, end);
        const kind = tag[0] === 'C' ? 'const' : 'let';
        const isStatic = tag[1] === 'S';
        const type = tag.slice(3);
        let j = end + 1, d = 0;
        for (; j < code.length; j++) {
          const c = code[j];
          if (c === '(' || c === '[' || c === '{') d++;
          else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; }
          else if (c === ';' && d === 0) break;
        }
        const body = code.slice(end + 1, j);
        let decl;
        const colon = splitTop(body, ':');
        if (code[j] === ')' && colon.length === 2) {
          decl = 'let ' + colon[0].trim() + ' of ' + colon[1].trim(); // range-based for
          DECLARED.add(colon[0].trim());
        } else decl = kind + ' ' + convertDeclarators(body, type, vars);
        const pad = '\n'.repeat(Math.max(0, countNL(body) - countNL(decl)));
        if (isStatic && depth > 0) {
          hoisted.push(decl.replace(/\n/g, ' ') + ';');
          out += '\n'.repeat(countNL(body));
          i = code[j] === ';' ? j + 1 : j;
          continue;
        }
        out += decl + pad;
        i = j;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      out += ch; i++;
    }
    for (const n of vars.others) vars.ints.delete(n);
    return { code: out, hoisted, ints: vars.ints };
  }

  function matchClose(s, k) {
    let d = 0;
    for (; k < s.length; k++) {
      const c = s[k];
      if (c === '(' || c === '[') d++;
      else if (c === ')' || c === ']') { d--; if (d === 0) return k + 1; }
    }
    return k;
  }

  function convertCasts(code) {
    const re = new RegExp('\\(\\s*' + QUAL + '(' + NUMTYPE.slice(3, -3) + ')\\b' + MORE + '\\s*(\\**)\\s*\\)(?=\\s*[\\w(\\u0003.!~-])', 'g');
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += code.slice(last, m.index);
      let j = re.lastIndex;
      while (/\s/.test(code[j])) j++;
      const t = m[1];
      if (m[2]) { last = re.lastIndex; continue; }
      let k = j;
      if (code[k] === '(') k = matchClose(code, k);
      else {
        if ('-!~'.includes(code[k])) k++;
        while (k < code.length && /[\w.\u0003]/.test(code[k])) k++;
        while (code[k] === '(' || code[k] === '[') k = matchClose(code, k);
      }
      const fn = /^(float|double)$/.test(t) ? 'float' : t === 'char' ? 'char' : /^(byte|uint8_t)$/.test(t) ? 'byte' : /^(bool|boolean)$/.test(t) ? 'bool' : 'int';
      out += fn + '(' + code.slice(j, k) + ')';
      last = k;
      re.lastIndex = k;
    }
    return out + code.slice(last);
  }


  // ------------------------------------------------------------------
  // Integer division like C: a / b becomes __div(a, b) unless an operand is clearly a float
  // (a float literal, a float/double variable or parameter, a float cast or a maths function).
  // __div truncates when both values are whole numbers at run time.
  // ------------------------------------------------------------------
  const FLOAT_FNS = ['sqrt', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'log10', 'fmod', 'fabs', 'float', 'double', 'toFloat', 'toDouble', 'parseFloat'];
  const FLOAT_CONSTS = ['PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG', 'EULER'];
  function isFloatOperand(s) {
    if (/(^|[^\w.$])(\d+\.\d*|\.\d+|\d+[eE][-+]?\d+)/.test(s)) return true;
    if (new RegExp('(?<![\\w.$])(' + FLOAT_FNS.join('|') + ')\\s*\\(').test(s)) return true;
    if (new RegExp('(?<![\\w.$])(' + FLOAT_CONSTS.join('|') + ')\\b').test(s)) return true;
    for (const n of FLOATS) if (new RegExp('(?<![\\w.$])' + n + '\\b').test(s)) return true;
    return false;
  }
  function matchOpen(s, k) { // k at ')' or ']' -> index of the matching opener
    let d = 0;
    for (; k >= 0; k--) {
      const c = s[k];
      if (c === ')' || c === ']') d++;
      else if (c === '(' || c === '[') { d--; if (d === 0) return k; }
    }
    return 0;
  }
  const isWord = (c) => c !== undefined && /[\w.$\u0003]/.test(c);
  function intDivisions(code) {
    let i = 0;
    for (let guard = 0; guard < 100000; guard++) {
      let k = code.indexOf('/', i);
      if (k < 0) break;
      if (code[k + 1] === '=' || code[k + 1] === '/' || code[k + 1] === '*' || code[k - 1] === '*') { i = k + 1; continue; }
      // left operand: the whole * / % chain before the operator (C evaluates left to right)
      let j = k - 1;
      for (;;) {
        while (j >= 0 && /[ \t]/.test(code[j])) j--;
        const end = j;
        for (;;) {
          if (code[j] === ')' || code[j] === ']') { j = matchOpen(code, j) - 1; continue; }
          if (isWord(code[j])) { j--; continue; }
          break;
        }
        if (j === end) break; // no term
        while (j >= 0 && /[!~]/.test(code[j])) j--;
        let q = j;
        while (q >= 0 && /[ \t]/.test(code[q])) q--;
        if ((code[q] === '*' || code[q] === '%' || code[q] === '/') && code[q - 1] !== '*' && code[q - 1] !== '/') { j = q - 1; continue; }
        break;
      }
      let L = j + 1;
      while (L < k && /\s/.test(code[L])) L++;
      // right operand: one unary / postfix expression
      let r = k + 1;
      while (/[ \t]/.test(code[r])) r++;
      const rs = r;
      while (/[-+!~ \t]/.test(code[r])) r++;
      if (code[r] === '(') r = matchClose(code, r);
      else {
        const t0 = r;
        while (r < code.length) {
          if (isWord(code[r])) { r++; continue; }
          if ((code[r] === '+' || code[r] === '-') && /^\d[\d.]*[eE]$/.test(code.slice(t0, r))) { r++; continue; }
          break;
        }
      }
      while (code[r] === '(' || code[r] === '[') { r = matchClose(code, r); while (isWord(code[r])) r++; }
      const left = code.slice(L, k), right = code.slice(rs, r);
      if (!left.trim() || !right.trim() || isFloatOperand(left) || isFloatOperand(right)) { i = k + 1; continue; }
      code = code.slice(0, L) + '__div(' + left.replace(/\s+$/, '') + ', ' + right + ')' + code.slice(r);
      i = L + 6;
    }
    return code;
  }

  function prevNonSpace(s, i) { i--; while (i >= 0 && /\s/.test(s[i])) i--; return i >= 0 ? s[i] : ''; }

  function injectTicks(s) {
    const ins = [];
    const re = /\b(while|for)\s*\(|\bdo\s*\{/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[0].startsWith('do')) { ins.push({ pos: m.index + m[0].length, text: ' await __tick();' }); continue; }
      let j = m.index + m[0].length, depth = 1;
      while (j < s.length && depth > 0) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; }
      let k = j;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] === '{') ins.push({ pos: k + 1, text: ' await __tick();' });
      else if (s[k] === ';') {
        if (!(m[1] === 'while' && prevNonSpace(s, m.index) === '}')) ins.push({ pos: k, text: '{ await __tick(); }', del: 1 });
      } else {
        let d = 0, e = k;
        while (e < s.length) {
          const ch = s[e];
          if (ch === '(' || ch === '[' || ch === '{') d++;
          else if (ch === ')' || ch === ']' || ch === '}') d--;
          else if (ch === ';' && d === 0) break;
          e++;
        }
        ins.push({ pos: k, text: '{ await __tick(); ' });
        ins.push({ pos: e + 1, text: ' }' });
      }
    }
    ins.sort((a, b) => b.pos - a.pos);
    for (const it of ins) s = s.slice(0, it.pos) + it.text + s.slice(it.pos + (it.del || 0));
    return s;
  }

  function transpile(src, apiNames, opts) {
    opts = opts || {};
    const libs = [];
    DECLARED = new Set();
    FLOATS = new Set();
    let { code, lits } = protect(src.replace(/\r\n?/g, '\n'));

    // #include lines, then Arduino-style structure checks (brackets, semicolons)
    const incErr = checkIncludes(code, lits, opts.board);
    if (incErr) return { error: incErr };
    const structErr = checkStructure(code);
    if (structErr) return { error: structErr };
    const safeErr = checkSafety(code);
    if (safeErr) return { error: safeErr };

    // Preprocessor
    code = code.split('\n').map((line) => {
      const t = line.trim();
      if (!t.startsWith('#')) return line;
      let m;
      if (/^#\s*include/.test(t)) { libs.push(t); return ''; }
      if ((m = t.match(/^#\s*define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/))) {
        DECLARED.add(m[1]);
        const v = (m[2] || '').trim().replace(/;+\s*$/, '');
        return v ? `const ${m[1]} = (${v});` : '';
      }
      return '';
    }).join('\n');

    // Adjacent string literals "a" "b"
    code = code.replace(/(\u0003\d+\u0003)(\s*)(?=\u0003\d+\u0003)/g, '$1+$2');

    // sizeof(type)
    code = code.replace(new RegExp('sizeof\\s*\\(\\s*' + QUAL + '(' + Object.keys(SIZES).join('|') + ')\\b' + MORE + '\\s*\\)', 'g'), (m, t) => String(SIZES[t] || 2));

    // Function definitions and prototypes
    const userFns = new Set();
    const fnRe = new RegExp('(^|[;{}\\n])([ \\t]*)' + QUAL + TYPE_ALT + MORE + '(?:\\s*[*&]+\\s*|\\s+)([A-Za-z_]\\w*)\\s*\\(([^()]*)\\)(\\s*)([{;])', 'g');
    code = code.replace(fnRe, (m, pre, ind, name, params, ws, end) => {
      if (KEYWORDS.has(name)) return m;
      const nl = countNL(m) - countNL(pre);
      if (end === ';') {
        const p = params.trim();
        const proto = p === '' || p === 'void' || new RegExp('^' + QUAL + TYPE_ALT).test(p);
        return proto ? pre + ind + '\n'.repeat(nl) + ';' : m;
      }
      userFns.add(name);
      return pre + ind + 'async function \u0002' + name + '(' + convParams(params) + ')' + '\n'.repeat(nl) + ' {';
    });

    // Variable declarations -> marked, then converted
    const declRe = new RegExp('(^|[;{}(\\n:])([ \\t]*)((?:(?:const|static|volatile|unsigned|signed|constexpr)\\s+)*)' + VTYPE + MORE + '(\\s*[*&]+\\s*|\\s+)(?=[A-Za-z_])(?!(?:long|int|char|short|double)\\b)', 'g');
    code = code.replace(declRe, (m, pre, ind, quals, type) => {
      const isConst = /\bconst\b|\bconstexpr\b/.test(quals);
      const isStatic = /\bstatic\b/.test(quals);
      return pre + ind + '\u0001' + (isConst ? 'C' : 'L') + (isStatic ? 'S' : '_') + ':' + type + '\u0001';
    });
    const pd = processDecls(code);
    code = intAssignments(pd.code, pd.ints);

    // C-style casts: (int)x, (float)(a+b), (unsigned long)y
    code = convertCasts(code);
    code = intDivisions(code);

    // bitSet(x, n) & friends modify their first argument
    code = code.replace(/\b(bitSet|bitClear|bitWrite)\s*\(\s*([A-Za-z_][\w.]*(?:\[[^\]]*\])*)\s*,/g, (m, f, v) => `${v} = __${f}(${v},`);

    code = code
      .replace(/\.length\s*\(\s*\)/g, '.length')
      .replace(/->/g, '.')
      .replace(/\b(?:NULL|nullptr)\b/g, 'null')
      .replace(/\bPROGMEM\b/g, '')
      .replace(/\b(0[xX][0-9a-fA-F]+|\d+)(?:[uU][lL]{0,2}|[lL]{1,2}[uU]?)\b/g, '$1')
      .replace(/\b(\d+\.\d*|\.\d+)[fF]\b/g, '$1')
      .replace(/\bB([01]{1,8})\b/g, '0b$1')
      .replace(/([(,=]\s*)&(?=[A-Za-z_])/g, '$1');

    code = injectTicks(code);

    // Await sleeping functions and every user function (they are async).
    const asyncNames = [...userFns, 'delay', 'delayMicroseconds'];
    code = code.replace(new RegExp('(?<![\\w.$\\u0002])(' + asyncNames.join('|') + ')\\s*\\(', 'g'), 'await $1(');
    code = code.replace(/\u0002/g, '');

    // Every name used must be declared somewhere (sketch, Arduino API or a supported library).
    const known = new Set([...apiNames, ...DECLARED, ...userFns]);
    const idErr = checkIdentifiers(code, known, libs.map((l) => l.replace(/\u0003(\d+)\u0003/g, (m, k) => lits[+k])));
    if (idErr) return { error: idErr };

    code = code.replace(/\u0003(\d+)\u0003/g, (m, k) => lits[+k]);

    const header = `window.__wbFactory = function(__api){ const {${apiNames.join(',')}} = __api; return (async function(){ ${pd.hoisted.join(' ')}`;
    const js = header + '\n' + code + `\n;return { setup: (typeof setup === 'function') ? setup : null, loop: (typeof loop === 'function') ? loop : null };\n})(); };`;
    return { js, libs, userFns: [...userFns], lineOffset: 1 };
  }

  // Load the generated JS through a blob <script> so syntax errors report a line number.
  function load(js) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
      let failed = false;
      const onErr = (e) => {
        if (e.filename !== url) return;
        e.preventDefault();
        failed = true;
        reject({ message: e.message, line: Math.max(1, (e.lineno || 2) - 1) });
      };
      window.addEventListener('error', onErr);
      const sc = document.createElement('script');
      sc.src = url;
      const done = () => { window.removeEventListener('error', onErr); sc.remove(); };
      sc.onload = () => {
        done();
        if (failed) return;
        const f = window.__wbFactory;
        window.__wbFactory = null;
        if (typeof f === 'function') resolve({ factory: f, url });
        else reject({ message: 'Could not compile the sketch.' });
      };
      sc.onerror = () => { done(); if (!failed) reject({ message: 'Could not load the compiled sketch.' }); };
      document.head.appendChild(sc);
    });
  }

  function errorLine(err, url) {
    if (!err || !err.stack || !url) return null;
    const idx = err.stack.indexOf(url);
    if (idx < 0) return null;
    const m = err.stack.slice(idx + url.length).match(/^:(\d+)/);
    return m ? Math.max(1, +m[1] - 1) : null;
  }

  // Friendlier wording for the few JavaScript syntax errors that can still slip through.
  function friendlyMessage(msg) {
    return String(msg || '')
      .replace(/^Uncaught\s+/, '')
      .replace(/^SyntaxError:\s*Unexpected token '(.+)'$/, "expected an expression before '$1'")
      .replace(/^SyntaxError:\s*Unexpected identifier '(.+)'$/, "unexpected '$1' — check the line above for a missing ';', ')' or operator")
      .replace(/^SyntaxError:\s*Unexpected end of input$/, "expected '}' at end of input")
      .replace(/^SyntaxError:\s*/, '');
  }

  WB.Sketch = { transpile, load, errorLine, friendlyMessage };
})(window.WB);

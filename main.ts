// Tiny stack VM for make.fun's tiny-stack-vm-01 bounty. Implements the kit's
// ISA: 32-bit wrapping ints, 256-value data stack, 64-entry call stack, 256
// words of memory, ten traps, 1,000,000 steps and 65,536 output bytes max.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const enc = new TextEncoder();

// Opcode tables, indexed by opcode byte (0x00..0x53): immediate bytes, pops,
// pushes. 'x' marks an opcode the ISA does not name (trap 5).
const IM = '014' + '0'.repeat(45) + '2222' + '0'.repeat(32);
const PO = '00011223' + 'x'.repeat(8) + '222222212221222x222' + 'x'.repeat(13) + '01100' + 'x'.repeat(11) + '12' + 'x'.repeat(14) + '1101';
const PU = '01102233' + 'x'.repeat(8) + '111111111111111x111' + 'x'.repeat(13) + '00000' + 'x'.repeat(11) + '10' + 'x'.repeat(14) + '0010';

// Runs one program on its input; returns [stdout bytes, exit code].
function run(prog, input) {
  const n = prog.length;
  const D = new Int32Array(256); // data stack
  let sp = 0;
  const C = new Int32Array(64); // call stack
  let cp = 0;
  const M = new Int32Array(256); // memory, all zero
  const out = new Uint8Array(65536);
  let ol = 0, ip = 0, pc = 0, steps = 0;
  const end = (code) => [out.subarray(0, ol), code];
  for (;;) {
    if (steps === 1000000) return end(10); // step limit
    if (pc < 0 || pc >= n) return end(9); // pc outside program
    const op = prog[pc];
    if (op > 83 || PO[op] === 'x') return end(5); // unknown opcode
    const imm = +IM[op], pops = +PO[op], pushes = +PU[op];
    if (pc + imm >= n) return end(9); // immediate cut off
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return end(2); // stack underflow
    if (sp - pops + pushes > 256) return end(3); // stack overflow
    pc = next;
    switch (op) {
      case 0x00: return end(0); // HALT
      case 0x01: D[sp++] = (prog[next - 1] << 24) >> 24; break; // PUSH8 sign-extended
      case 0x02: // PUSH32 little-endian
        D[sp++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24);
        break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const x = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = x; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = D[sp - 1], a = D[sp - 2];
        let r;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b); // low 32 bits, exact
        else if (op === 0x13) { // DIV signed, truncates toward zero
          if (b === 0) return end(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) { // MOD, sign of a
          if (b === 0) return end(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) { // DIVU unsigned
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) { // MODU unsigned
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31); // shift counts: low 5 bits only
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU unsigned
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: { // JMP / JZ / JNZ
        const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = D[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel; // target unchecked; traps 9 next step if outside
        break;
      }
      case 0x33: // CALL: 64 held already traps 7
        if (cp === 64) return end(7);
        C[cp++] = next;
        pc = prog[next - 2] | (prog[next - 1] << 8);
        break;
      case 0x34: // RET on empty call stack traps 8
        if (cp === 0) return end(8);
        pc = C[--cp];
        break;
      case 0x40: { // LOAD
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return end(6);
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: { // STORE ( v addr -- )
        const a = D[sp - 1], v = D[sp - 2];
        if (a < 0 || a >= 256) return end(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 0x50: { // PRINT decimal ASCII; a trapping PRINT writes none of its bytes
        const s = enc.encode(String(D[sp - 1]));
        if (ol + s.length > 65536) return end(11);
        sp--;
        out.set(s, ol);
        ol += s.length;
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return end(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < input.length ? input[ip++] : -1; break;
      case 0x53: return end(D[--sp] & 255);
    }
  }
}

for (const id of readdirSync(I).sort()) {
  let prog;
  try { prog = readFileSync(join(I, id, 'program.bin')); } catch { continue; }
  let input = new Uint8Array(0);
  try { input = readFileSync(join(I, id, 'input.bin')); } catch { /* no input: empty */ }
  const [stdout, exit] = run(prog, input);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), stdout);
  writeFileSync(join(O, id, 'exit.txt'), String(exit) + '\n');
}

# Tiny stack VM

A tiny stack virtual machine for make.fun's [Build a tiny stack virtual machine, 22 November 2026](https://make.fun/bounty/tiny-stack-vm-01-run-20261122) bounty.

Implements the kit ISA: 32-bit wrapping integers, a 256-value data stack, a 64-entry call stack, 256 words of memory, and ten traps with their own exit codes.

Run: `node main.ts` — reads `/input`, writes `/output` (one `stdout.bin` + `exit.txt` per instance).

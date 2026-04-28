#!/usr/bin/env node
// Copies our patched plugin sources into node_modules so Capacitor's
// `cap sync ios` will pick them up. Run automatically via `postinstall`
// and before every build. Keep this idempotent.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const patches = [
  {
    from: resolve(root, 'patches/CapacitorVolumeButtonsPlugin.swift'),
    to:   resolve(root, 'node_modules/capacitor-volume-buttons/ios/Plugin/CapacitorVolumeButtonsPlugin.swift'),
  },
];

let applied = 0;
for (const p of patches) {
  if (!existsSync(p.from)) { console.warn(`skip (missing source): ${p.from}`); continue; }
  if (!existsSync(dirname(p.to))) {
    console.warn(`skip (plugin not installed): ${p.to}`);
    continue;
  }
  copyFileSync(p.from, p.to);
  applied++;
  console.log(`patched: ${p.to}`);
}
console.log(`patch-plugins: ${applied} file(s) applied.`);

// EMBERLINE — a three.js tactical FPS for make.fun's threejs-fps-01 bounty.
// This program is the entrypoint: it hands the game in. It copies this directory's
// game/ (the playable game: static ES modules, three.js 0.187.0 vendored) and
// screenshots/ (3–4 real renders of the game) into /output, then writes
// /output/dossier.json with the kit's buildDossier library, exactly as the kit's
// starter does. Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for
// /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Node 22, standard library only; nothing is installed before it runs.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Guard: the entry is not handable-in without the game and its screenshots.
// Fail loudly here instead of writing a partial /output the gate would refuse.
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');
if (!existsSync(join(gameDir, 'index.html'))) {
  throw new Error('game/index.html is missing — the game was not built');
}
if (!existsSync(shotsDir) || readdirSync(shotsDir).filter((f) => !f.startsWith('.')).length < 3) {
  throw new Error('screenshots/ holds fewer than 3 images — take the screenshots first');
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// The scorer's caps (reference/gate.json): only text_max_bytes shapes the bytes;
// the others refuse an entry the scorer would refuse — more than 4 screenshots or
// one over 256 KiB; more than 993 files in game/ or 48 MiB of game files in all.
// game/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json.
const dossierPath = join(out, 'dossier.json');
writeFileSync(
  dossierPath,
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);

// Guard: the dossier must exist and be non-empty, or the hand-in is void.
const dossierBytes = statSync(dossierPath).size;
if (dossierBytes === 0) throw new Error('dossier.json came out empty');
console.log(`EMBERLINE handed in: dossier.json ${dossierBytes} bytes -> ${out}`);

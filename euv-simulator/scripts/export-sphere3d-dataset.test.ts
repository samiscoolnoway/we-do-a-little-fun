// Export of the browser dataset of the 3D Mach 2 sphere results (milestone M0). Not part of `npm test`.
//
//   cd euv-simulator
//   CKPT_DIR=<directory holding rh48-offsets/off*/rh48.ckpt and rh64-run/rh64.ckpt> OUT=docs/sphere3d-browser-dataset-v1 \
//     npx vitest run --root . --config /dev/null --testTimeout 3600000 scripts/export-sphere3d-dataset.test.ts
//
// Reads the checkpoints and the archived research data without changing them, advances each checkpoint to the step
// at which its archived run met the stopping rule (refusing to continue if the advanced state differs from the
// archived result in any recorded value), and writes the dataset described in scripts/sphere3d-dataset.ts. OUT must
// not exist or be empty; existing archives are refused. Every missing input is an error: nothing is substituted.
import { it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildDataset, defaultSources, DEFAULT_OUT, DOCS } from './sphere3d-dataset';

const ARCHIVES = ['sphere3d-refinement', 'sphere-gap-study', 'axisym-data', 'axi-reference-refinement', 'sphere3d-rh64', 'sphere3d-rh48-offsets', 'sphere3d-uncertainty-audit', 'checkpoint-restart'].map((d) => path.join(DOCS, d));

it('export the 3D sphere browser dataset', () => {
  const ckptDir = process.env.CKPT_DIR;
  if (!ckptDir) throw new Error('CKPT_DIR is required (the directory with rh48-offsets/off*/rh48.ckpt and rh64-run/rh64.ckpt)');
  const out = path.resolve(process.env.OUT ?? DEFAULT_OUT);
  if (ARCHIVES.some((a) => out === a || out.startsWith(a + path.sep))) throw new Error(`refusing to write into an existing archive: ${out}`);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`output directory is not empty: ${out}`);
  const { files, log } = buildDataset(defaultSources(path.resolve(ckptDir)));
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(out, name), bytes);
  for (const l of log) console.log(l);
  console.log(`wrote ${Object.keys(files).length} files to ${out}`);
});

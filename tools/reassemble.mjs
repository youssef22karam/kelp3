// Reassembles whole files from their split parts.
// Some source files exceed the 30,000-byte per-file limit of the repo, so
// they are stored as byte-split parts and rebuilt here before dev/build.
// Run automatically via the predev/prebuild/prepreview npm scripts.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 30000;

const TARGETS = [
  {
    whole: 'src/kelp/fish.tsx',
    parts: ['src/kelp/parts/fish.part01.tsx', 'src/kelp/parts/fish.part02.tsx'],
  },
  {
    whole: 'src/kelp/floor.tsx',
    parts: ['src/kelp/parts/floor.part01.tsx', 'src/kelp/parts/floor.part02.tsx'],
  },
];

for (const { whole, parts } of TARGETS) {
  const chunks = [];
  for (const part of parts) {
    const partPath = join(root, part);
    const size = statSync(partPath).size;
    if (size > LIMIT) {
      console.error(`reassemble: part ${part} is ${size} bytes, over the ${LIMIT}-byte limit — refusing to build ${whole}`);
      process.exit(1);
    }
    chunks.push(readFileSync(partPath));
  }
  const data = Buffer.concat(chunks);
  writeFileSync(join(root, whole), data);
  console.log(`reassemble: wrote ${whole} (${data.length} bytes from ${parts.length} parts)`);
}

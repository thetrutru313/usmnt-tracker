/**
 * Generates PWA icons from the USMNT crest badge.
 * Run once after setup: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CREST = path.join(ROOT, 'artifacts/usmnt-tracker/public/badges/usmnt-crest.png');
const OUT_DIR = path.join(ROOT, 'artifacts/usmnt-tracker/public/icons');
const NAVY = { r: 0, g: 41, b: 102, alpha: 255 }; // #002966 = hsl(213 100% 20%)

fs.mkdirSync(OUT_DIR, { recursive: true });

async function makeIcon(canvasSize, crestSize, filename) {
  const crestBuf = await sharp(CREST)
    .resize(crestSize, crestSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const offset = Math.round((canvasSize - crestSize) / 2);

  await sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: NAVY },
  })
    .composite([{ input: crestBuf, top: offset, left: offset }])
    .png()
    .toFile(path.join(OUT_DIR, filename));

  console.log(`✓ ${filename} (${canvasSize}×${canvasSize}, crest ${crestSize}px)`);
}

// Standard icons: crest at 78% of canvas
await makeIcon(192, 150, 'icon-192.png');
await makeIcon(512, 400, 'icon-512.png');

// Maskable icon: crest within the inner safe zone (≥10% padding = ≤80% of canvas)
// Using 68% (174px padding / 2 = ~15% each side) to stay well inside the safe circle
await makeIcon(512, 348, 'icon-maskable-512.png');

console.log('\nAll icons written to artifacts/usmnt-tracker/public/icons/');

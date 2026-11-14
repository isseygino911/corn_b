// Imports the sold-items gallery: uploads each photo to S3 and creates a sold product with it as the main image.
// Usage: npm run import-sold "<photos dir>"   (details come from scripts/sold-items.json)
// Re-runs are safe: entries whose slug (sold-NNN, from the file number) already has a main image are skipped,
// and a product left without an image by an interrupted run gets its image now.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db.js';
import { createProduct, setProductImages } from '../src/services/catalog.js';
import { putImage } from '../src/services/storage.js';

const dir = process.argv[2];
if (!dir) throw new Error('Usage: npm run import-sold "<photos dir>"');

const items = JSON.parse(await fs.readFile(new URL('sold-items.json', import.meta.url), 'utf8'));

// Check every entry before uploading anything, so a bad entry never stops a run halfway.
const slugOf = (file) => {
  const number = /^corn-(\d+)\.webp$/.exec(file)?.[1];
  if (!number) throw new Error(`Unexpected file name: ${file}`);
  return `sold-${number.padStart(3, '0')}`;
};
for (const { file } of items) {
  slugOf(file);
  await fs.access(path.join(dir, file));
}

const upload = async (file) => putImage({ body: await fs.readFile(path.join(dir, file)), contentType: 'image/webp', kind: 'product' });

const counts = { created: 0, repaired: 0, skipped: 0 };
for (const { file, name, description, collection, colorway } of items) {
  const slug = slugOf(file);
  const [[existing]] = await pool.query(
    'SELECT id, EXISTS (SELECT 1 FROM product_images WHERE product_id = products.id AND is_main) AS has_image FROM products WHERE slug = ?',
    [slug],
  );
  if (existing?.has_image) {
    counts.skipped += 1;
    continue;
  }
  const id = existing?.id ?? (await createProduct({ name, description, collection, colorway, slug, priceCents: 0, stock: 0, active: true, sold: true })).id;
  await setProductImages(id, [{ key: await upload(file), isMain: true }]);
  counts[existing ? 'repaired' : 'created'] += 1;
  console.log(`${slug}  ${name}`);
}

console.log(`Done: ${counts.created} created, ${counts.repaired} repaired, ${counts.skipped} skipped.`);
await pool.end();

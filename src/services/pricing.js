import { pool } from '../db.js';
import { HttpError } from '../lib/http.js';
import { getSettings } from './settings.js';
import { shippingCents } from './shipping.js';
import { assertStock, tally } from './stock.js';

const lockClause = (lock, of = '') => (lock ? ` FOR UPDATE${of}` : '');

const loadProducts = async (connection, slugs, lock) => {
  const [rows] = await connection.query(
    `SELECT * FROM products WHERE slug IN (?) AND active = 1 AND archived_at IS NULL ORDER BY id${lockClause(lock)}`,
    [slugs],
  );
  if (slugs.some((slug) => !rows.some((row) => row.slug === slug))) throw new HttpError(404, 'Product not found');
  return rows;
};

// Live accessories the chosen products allow, as rows tagged with the product they were linked from.
const loadAccessories = async (connection, productIds, publicIds, lock) => {
  if (!publicIds.length) return [];
  const [rows] = await connection.query(
    `SELECT accessories.*, product_accessories.product_id FROM product_accessories
     JOIN accessories ON accessories.id = accessory_id
     WHERE product_id IN (?) AND accessories.public_id IN (?) AND accessories.active = 1 AND accessories.archived_at IS NULL
     ORDER BY accessories.id${lockClause(lock, ' OF accessories')}`,
    [productIds, publicIds],
  );
  return rows;
};

// Subtotal, shipping, tax and total in integer cents. Tax is on the subtotal only, rounded to the nearest cent.
const totals = async (subtotalCents, countryCode, connection) => {
  const { taxRateBps, shippingEnabled } = await getSettings(connection);
  const shipping = shippingEnabled ? await shippingCents(countryCode, connection) : 0;
  const taxCents = Math.floor((subtotalCents * taxRateBps + 5000) / 10000);
  return { subtotalCents, shippingCents: shipping, taxRateBps, taxCents, totalCents: subtotalCents + shipping + taxCents };
};

// The one place totals are computed. Reprices `items` ([{ slug, accessoryIds, quantity }]) from the database;
// a client-sent price is never read. With `lock` the product and accessory rows are locked FOR UPDATE
// (inside the caller's transaction) and stock is checked against the locked rows.
const priceCart = async (items, { countryCode, connection = pool, lock = false } = {}) => {
  const products = await loadProducts(connection, [...new Set(items.map((item) => item.slug))], lock);
  const accessories = await loadAccessories(
    connection,
    products.map((product) => product.id),
    [...new Set(items.flatMap((item) => item.accessoryIds))],
    lock,
  );
  const lines = items.map(({ slug, accessoryIds, quantity }) => {
    const product = products.find((row) => row.slug === slug);
    const chosen = accessoryIds.map((publicId) => {
      const accessory = accessories.find((row) => row.public_id === publicId && row.product_id === product.id);
      if (!accessory || accessory.stock === 0) throw new HttpError(400, 'An accessory is not available for this product');
      return accessory;
    });
    const unitCents = chosen.reduce((sum, accessory) => sum + accessory.price_cents, product.price_cents);
    return { product, accessories: chosen, quantity, unitCents, lineCents: unitCents * quantity };
  });
  assertStock(tally(lines));
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  return { lines, ...(await totals(subtotalCents, countryCode, connection)) };
};

const quote = async (items, countryCode) => {
  const { lines, ...amounts } = await priceCart(items, { countryCode });
  return {
    lines: lines.map((line) => ({
      slug: line.product.slug,
      name: line.product.name,
      quantity: line.quantity,
      accessories: line.accessories.map((accessory) => ({
        publicId: accessory.public_id,
        name: accessory.name,
        priceCents: accessory.price_cents,
      })),
      unitCents: line.product.price_cents,
      lineCents: line.lineCents,
    })),
    ...amounts,
  };
};

export { priceCart, quote };

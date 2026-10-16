import { randomBytes, randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../lib/http.js';
import { nextSku } from '../lib/sku.js';
import { signedReadUrl } from './storage.js';

const snake = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const urlOf = (key) => (key ? signedReadUrl(key) : null);

const notFound = (what) => new HttpError(404, `${what} not found`);

// Turns a duplicate-key error into a 409 naming the clashing field.
// The clashing unique index is named in the message ("for key 'products.sku'"), not the value.
const duplicateField = (err) => (err.code === 'ER_DUP_ENTRY' ? /for key '(?:[^']*\.)?([a-z_]+)'/.exec(err.sqlMessage)?.[1] : undefined);

const rethrowDuplicate = (err) => {
  const field = duplicateField(err);
  if (!['sku', 'slug'].includes(field)) throw err;
  throw new HttpError(409, `${field === 'slug' ? 'Slug' : 'SKU'} is already in use`, { code: `${field}_taken` });
};

const MAX_ATTEMPTS = 5;

// Runs an insert, retrying when a field the server generated (not the admin) clashes. run(attempt) gets the retry count.
const retryGenerated = async (generated, run) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !generated.includes(duplicateField(err))) rethrowDuplicate(err);
    }
  }
};

const slugify = (name) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);

const productView = (row, images, accessoryIds) => ({
  id: row.id,
  publicId: row.public_id,
  sku: row.sku,
  name: row.name,
  slug: row.slug,
  description: row.description,
  collection: row.collection,
  colorway: row.colorway,
  priceCents: row.price_cents,
  stock: row.stock,
  active: Boolean(row.active),
  archivedAt: row.archived_at,
  images: images
    .map((image) => ({ key: image.s3_key, url: signedReadUrl(image.s3_key), isMain: Boolean(image.is_main) }))
    .sort((a, b) => b.isMain - a.isMain),
  accessoryIds,
});

const accessoryView = (row) => ({
  id: row.id,
  publicId: row.public_id,
  sku: row.sku,
  name: row.name,
  description: row.description,
  priceCents: row.price_cents,
  stock: row.stock,
  active: Boolean(row.active),
  imageKey: row.image_key,
  imageUrl: urlOf(row.image_key),
  archivedAt: row.archived_at,
});

const archivedClause = (archived) => (archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL');

const groupBy = (rows, key) =>
  rows.reduce((groups, row) => {
    (groups[row[key]] ??= []).push(row);
    return groups;
  }, {});

// Loads images and linked accessory ids for product rows, in two queries total.
const hydrateProducts = async (rows) => {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [images] = await pool.query('SELECT * FROM product_images WHERE product_id IN (?) ORDER BY position', [ids]);
  const [links] = await pool.query(
    'SELECT product_accessories.product_id, accessories.public_id FROM product_accessories JOIN accessories ON accessories.id = accessory_id WHERE product_id IN (?) AND accessories.archived_at IS NULL ORDER BY accessories.id',
    [ids],
  );
  const imagesByProduct = groupBy(images, 'product_id');
  const linksByProduct = groupBy(links, 'product_id');
  return rows.map((row) =>
    productView(row, imagesByProduct[row.id] ?? [], (linksByProduct[row.id] ?? []).map((link) => link.public_id)),
  );
};

const findProductRow = async (id, connection = pool, { lock = false } = {}) => {
  const [rows] = await connection.query(`SELECT * FROM products WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('Product');
  return rows[0];
};

const findAccessoryRow = async (id) => {
  const [rows] = await pool.query('SELECT * FROM accessories WHERE id = ?', [id]);
  if (!rows[0]) throw notFound('Accessory');
  return rows[0];
};

// Replaces the accessory links of a product. Every id must be a live (non-archived) accessory.
const replaceAccessoryLinks = async (connection, productId, accessoryIds) => {
  await connection.query('DELETE FROM product_accessories WHERE product_id = ?', [productId]);
  if (!accessoryIds.length) return;
  const [rows] = await connection.query('SELECT id FROM accessories WHERE public_id IN (?) AND archived_at IS NULL', [
    accessoryIds,
  ]);
  if (rows.length !== accessoryIds.length) throw new HttpError(400, 'Unknown accessory');
  await connection.query('INSERT INTO product_accessories (product_id, accessory_id) VALUES ?', [
    rows.map((row) => [productId, row.id]),
  ]);
};

const setColumns = (fields) => ({
  sql: Object.keys(fields).map((key) => `${snake(key)} = ?`).join(', '),
  values: Object.values(fields),
});

const createProduct = async ({ accessoryIds = [], ...fields }) => {
  const publicId = randomUUID();
  const baseSlug = slugify(fields.name) || publicId.slice(0, 8);
  const generated = [fields.sku ? null : 'sku', fields.slug ? null : 'slug'];
  const id = await retryGenerated(generated, (attempt) =>
    withTransaction(async (connection) => {
      const row = {
        ...fields,
        sku: fields.sku ?? (await nextSku(connection, 'products', fields.collection)),
        slug: fields.slug ?? (attempt ? `${baseSlug}-${randomBytes(2).toString('hex')}` : baseSlug),
      };
      const [{ insertId }] = await connection.query(
        `INSERT INTO products (public_id, ${Object.keys(row).map(snake).join(', ')}) VALUES (?)`,
        [[publicId, ...Object.values(row)]],
      );
      await replaceAccessoryLinks(connection, insertId, accessoryIds);
      return insertId;
    }),
  );
  return getProduct(id);
};

const updateProduct = async (id, { accessoryIds, ...fields }) => {
  await withTransaction(async (connection) => {
    const product = await findProductRow(id, connection, { lock: true });
    try {
      if (Object.keys(fields).length) {
        const { sql, values } = setColumns(fields);
        await connection.query(`UPDATE products SET ${sql} WHERE id = ?`, [...values, product.id]);
      }
      if (accessoryIds) await replaceAccessoryLinks(connection, product.id, accessoryIds);
    } catch (err) {
      rethrowDuplicate(err);
    }
  });
  return getProduct(id);
};

const listProducts = async ({ archived }) => {
  const [rows] = await pool.query(`SELECT * FROM products WHERE ${archivedClause(archived)} ORDER BY id DESC`);
  return hydrateProducts(rows);
};

const getProduct = async (id) => (await hydrateProducts([await findProductRow(id)]))[0];

// Replaces a product's images in submitted order; responses list the main one first.
const setProductImages = async (id, images) => {
  await withTransaction(async (connection) => {
    const product = await findProductRow(id, connection, { lock: true });
    await connection.query('DELETE FROM product_images WHERE product_id = ?', [product.id]);
    await connection.query('INSERT INTO product_images (product_id, s3_key, is_main, position) VALUES ?', [
      images.map((image, position) => [product.id, image.key, image.isMain, position]),
    ]);
  });
  return getProduct(id);
};

const createAccessory = async (fields) => {
  const id = await retryGenerated([fields.sku ? null : 'sku'], () =>
    withTransaction(async (connection) => {
      const row = { ...fields, sku: fields.sku ?? (await nextSku(connection, 'accessories', 'accessories')) };
      const [{ insertId }] = await connection.query(
        `INSERT INTO accessories (public_id, ${Object.keys(row).map(snake).join(', ')}) VALUES (?)`,
        [[randomUUID(), ...Object.values(row)]],
      );
      return insertId;
    }),
  );
  return getAccessory(id);
};

const updateAccessory = async (id, fields) => {
  const accessory = await findAccessoryRow(id);
  if (Object.keys(fields).length) {
    const { sql, values } = setColumns(fields);
    await pool.query(`UPDATE accessories SET ${sql} WHERE id = ?`, [...values, accessory.id]).catch(rethrowDuplicate);
  }
  return accessoryView(await findAccessoryRow(id));
};

const listAccessories = async ({ archived }) => {
  const [rows] = await pool.query(`SELECT * FROM accessories WHERE ${archivedClause(archived)} ORDER BY id DESC`);
  return rows.map(accessoryView);
};

const getAccessory = async (id) => accessoryView(await findAccessoryRow(id));

const TABLES = { products: findProductRow, accessories: findAccessoryRow };

// Soft delete / restore. Archived rows disappear from lists and the storefront.
const setArchived = async (table, id, archived) => {
  const row = await TABLES[table](id);
  await pool.query(`UPDATE ${table} SET archived_at = ${archived ? 'NOW()' : 'NULL'} WHERE id = ?`, [row.id]);
  return table === 'products' ? getProduct(id) : getAccessory(id);
};

const listPublicProducts = async ({ collection }) => {
  const [rows] = await pool.query(
    `SELECT products.*, (SELECT s3_key FROM product_images WHERE product_id = products.id AND is_main LIMIT 1) AS main_key
     FROM products WHERE active = 1 AND archived_at IS NULL ${collection ? 'AND collection = ?' : ''} ORDER BY id DESC`,
    collection ? [collection] : [],
  );
  return rows.map((row) => ({
    publicId: row.public_id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    collection: row.collection,
    colorway: row.colorway,
    priceCents: row.price_cents,
    soldOut: row.stock === 0,
    mainImageUrl: urlOf(row.main_key),
  }));
};

// Active accessories a storefront product allows (sold out ones included, flagged).
const listProductAccessories = async (productId) => {
  const [rows] = await pool.query(
    `SELECT accessories.* FROM product_accessories JOIN accessories ON accessories.id = accessory_id
     WHERE product_id = ? AND active = 1 AND archived_at IS NULL ORDER BY accessories.id`,
    [productId],
  );
  return rows.map((row) => ({
    publicId: row.public_id,
    name: row.name,
    priceCents: row.price_cents,
    soldOut: row.stock === 0,
    imageUrl: urlOf(row.image_key),
  }));
};

const findPublicProductRow = async (slug) => {
  const [rows] = await pool.query('SELECT * FROM products WHERE slug = ? AND active = 1 AND archived_at IS NULL', [slug]);
  if (!rows[0]) throw notFound('Product');
  return rows[0];
};

const getPublicProduct = async (slug) => {
  const row = await findPublicProductRow(slug);
  const [images] = await pool.query('SELECT * FROM product_images WHERE product_id = ? ORDER BY position', [row.id]);
  return {
    publicId: row.public_id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    description: row.description,
    collection: row.collection,
    colorway: row.colorway,
    priceCents: row.price_cents,
    soldOut: row.stock === 0,
    images: images.map((image) => ({ url: signedReadUrl(image.s3_key), isMain: Boolean(image.is_main) })),
    accessories: await listProductAccessories(row.id),
  };
};

// Storefront product row plus its allowed accessories, for pricing.
const getQuotable = async (slug) => {
  const row = await findPublicProductRow(slug);
  return { priceCents: row.price_cents, accessories: await listProductAccessories(row.id) };
};

export {
  createProduct,
  updateProduct,
  listProducts,
  getProduct,
  setProductImages,
  createAccessory,
  updateAccessory,
  listAccessories,
  getAccessory,
  setArchived,
  listPublicProducts,
  getPublicProduct,
  getQuotable,
};

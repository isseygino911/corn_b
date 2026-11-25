import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../lib/http.js';
import { sendOrderConfirmationEmail } from './mailer.js';
import { createCheckout, expireCheckout } from './payments.js';
import * as addresses from './addresses.js';
import { priceCart } from './pricing.js';
import { applyStock, tally } from './stock.js';
import { signedReadUrl } from './storage.js';

const PAGE_SIZE = 25;
const MY_ORDERS_LIMIT = 100;
const STATUSES = ['pending_payment', 'placed', 'shipped', 'delivered', 'cancelled'];
// placed means paid. A pending order only moves by webhook (paid) or is discarded; cancelled and delivered are final.
const TRANSITIONS = { pending_payment: [], placed: ['shipped', 'cancelled'], shipped: ['delivered', 'cancelled'], delivered: [], cancelled: [] };

const orderNumber = (id) => `GGF-${String(id).padStart(6, '0')}`;

const groupBy = (rows, key) =>
  rows.reduce((groups, row) => {
    (groups[row[key]] ??= []).push(row);
    return groups;
  }, {});

// Order rows to their API shape, with items and accessories loaded in two queries total.
const hydrate = async (rows) => {
  if (!rows.length) return [];
  const [items] = await pool.query('SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id', [rows.map((row) => row.id)]);
  const [extras] = items.length
    ? await pool.query('SELECT * FROM order_item_accessories WHERE order_item_id IN (?) ORDER BY id', [items.map((item) => item.id)])
    : [[]];
  const itemsByOrder = groupBy(items, 'order_id');
  const extrasByItem = groupBy(extras, 'order_item_id');
  return rows.map((row) => ({
    id: row.id,
    publicId: row.public_id,
    orderNumber: row.order_number,
    userId: row.user_id,
    email: row.email,
    status: row.status,
    address: {
      fullName: row.full_name,
      phone: row.phone,
      line1: row.line1,
      line2: row.line2,
      countryCode: row.country_code,
      stateCode: row.state_code,
      city: row.city,
      postalCode: row.postal_code,
    },
    items: (itemsByOrder[row.id] ?? []).map((item) => ({
      sku: item.sku,
      name: item.name,
      unitCents: item.unit_cents,
      quantity: item.quantity,
      imageKey: item.image_key,
      imageUrl: item.image_key ? signedReadUrl(item.image_key) : null,
      lineCents: item.line_cents,
      accessories: (extrasByItem[item.id] ?? []).map((extra) => ({
        sku: extra.sku,
        name: extra.name,
        unitCents: extra.unit_cents,
      })),
    })),
    subtotalCents: row.subtotal_cents,
    shippingCents: row.shipping_cents,
    taxRateBps: row.tax_rate_bps,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    placedAt: row.placed_at,
    statusUpdatedAt: row.status_updated_at,
  }));
};

const findOne = async (where, params) => {
  const [rows] = await pool.query(`SELECT * FROM orders WHERE ${where}`, params);
  if (!rows[0]) throw new HttpError(404, 'Order not found');
  return (await hydrate(rows))[0];
};

const insertItems = async (connection, orderId, lines) => {
  const [images] = await connection.query('SELECT product_id, s3_key FROM product_images WHERE product_id IN (?) AND is_main', [
    lines.map((line) => line.product.id),
  ]);
  for (const { product, accessories, quantity, unitCents, lineCents } of lines) {
    const [{ insertId }] = await connection.query(
      'INSERT INTO order_items (order_id, product_id, sku, name, unit_cents, quantity, image_key, line_cents) VALUES (?)',
      [[orderId, product.id, product.sku, product.name, product.price_cents, quantity, images.find((image) => image.product_id === product.id)?.s3_key ?? null, lineCents]],
    );
    if (accessories.length) {
      await connection.query('INSERT INTO order_item_accessories (order_item_id, accessory_id, sku, name, unit_cents) VALUES ?', [
        accessories.map((accessory) => [insertId, accessory.id, accessory.sku, accessory.name, accessory.price_cents]),
      ]);
    }
  }
};

// Puts the order's products and accessories back into stock (cancelling, or discarding an unpaid order).
const restock = async (connection, orderId) => {
  const [items] = await connection.query('SELECT id, product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
  const [extras] = items.length
    ? await connection.query('SELECT order_item_id, accessory_id FROM order_item_accessories WHERE order_item_id IN (?)', [
        items.map((item) => item.id),
      ])
    : [[]];
  const lines = items.map((item) => ({
    product: { id: item.product_id },
    accessories: extras.filter((extra) => extra.order_item_id === item.id).map((extra) => ({ id: extra.accessory_id })),
    quantity: item.quantity,
  }));
  const demand = tally(lines);
  demand.products.delete(null);
  demand.accessories.delete(null);
  await applyStock(connection, demand, 1);
};

// Deletes an order that was never paid and releases its stock. A no-op once it is paid or gone.
const discard = (id) =>
  withTransaction(async (connection) => {
    const [[order]] = await connection.query('SELECT status FROM orders WHERE id = ? FOR UPDATE', [id]);
    if (order?.status !== 'pending_payment') return;
    await restock(connection, id);
    await connection.query('DELETE FROM orders WHERE id = ?', [id]);
  });

// A new checkout replaces the user's unfinished ones so their held stock comes back at once.
// A session Stripe refuses to expire (already completed) is left for its webhook.
const discardPending = async (userId) => {
  const [rows] = await pool.query("SELECT id, stripe_session_id FROM orders WHERE user_id = ? AND status = 'pending_payment'", [userId]);
  for (const row of rows) {
    try {
      if (row.stripe_session_id) await expireCheckout(row.stripe_session_id);
    } catch {
      continue;
    }
    await discard(row.id);
  }
};

// Reprices from the database under row locks, holds the stock and snapshots everything in one transaction as a
// pending_payment order, then opens a Stripe Checkout Session for it.
const place = async (user, { items, addressId }) => {
  const address = await addresses.get(user.id, addressId);
  await discardPending(user.id);
  const { orderId, priced } = await withTransaction(async (connection) => {
    const priced = await priceCart(items, { countryCode: address.countryCode, connection, lock: true });
    const [{ insertId }] = await connection.query(
      `INSERT INTO orders (public_id, user_id, email, full_name, phone, line1, line2, country_code, state_code, city, postal_code,
         subtotal_cents, shipping_cents, tax_rate_bps, tax_cents, total_cents) VALUES (?)`,
      [[
        randomUUID(), user.id, user.email, address.fullName, address.phone, address.line1, address.line2, address.countryCode,
        address.stateCode, address.city, address.postalCode, priced.subtotalCents, priced.shippingCents, priced.taxRateBps,
        priced.taxCents, priced.totalCents,
      ]],
    );
    await connection.query('UPDATE orders SET order_number = ? WHERE id = ?', [orderNumber(insertId), insertId]);
    await insertItems(connection, insertId, priced.lines);
    await applyStock(connection, tally(priced.lines), -1);
    return { orderId: insertId, priced };
  });
  const order = await findOne('id = ?', [orderId]);
  let session;
  try {
    session = await createCheckout({ user, address, order, priced });
  } catch (err) {
    console.error(`Order ${order.orderNumber}: could not create a Stripe Checkout Session`, err);
    await discard(orderId);
    throw new HttpError(502, 'Payment is unavailable right now. Please try again.');
  }
  await pool.query('UPDATE orders SET stripe_session_id = ? WHERE id = ?', [session.id, orderId]);
  return { order, checkoutUrl: session.url };
};

// Webhook: the session was paid. Sends the confirmation once (redeliveries are no-ops).
const markPaid = async (sessionId) => {
  const [{ affectedRows }] = await pool.query(
    `UPDATE orders SET status = 'placed', placed_at = NOW(), status_updated_at = NOW()
     WHERE stripe_session_id = ? AND status = 'pending_payment'`,
    [sessionId],
  );
  if (!affectedRows) return;
  const order = await findOne('stripe_session_id = ?', [sessionId]);
  sendOrderConfirmationEmail(order).catch((err) => console.error(`Order ${order.orderNumber}: confirmation email failed`, err));
};

// Webhook: the session expired or its payment failed.
const discardSession = async (sessionId) => {
  const [[row]] = await pool.query('SELECT id FROM orders WHERE stripe_session_id = ?', [sessionId]);
  if (row) await discard(row.id);
};

const listForUser = async (userId) => {
  const [rows] = await pool.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, MY_ORDERS_LIMIT]);
  return hydrate(rows);
};

const getForUser = (userId, number) => findOne('user_id = ? AND order_number = ?', [userId, number]);

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

const listAll = async ({ status, q, page }) => {
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (q) {
    conditions.push('(order_number LIKE ? OR email LIKE ? OR full_name LIKE ?)');
    params.push(...Array(3).fill(`%${escapeLike(q)}%`));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM orders ${where}`, params);
  const [rows] = await pool.query(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [
    ...params,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  ]);
  return { orders: await hydrate(rows), page, pageSize: PAGE_SIZE, total };
};

const get = (id) => findOne('id = ?', [id]);

// Moves an order along placed → shipped → delivered; cancelling (from placed or shipped) puts its stock back.
const setStatus = async (id, status) => {
  await withTransaction(async (connection) => {
    const [[order]] = await connection.query('SELECT id, status FROM orders WHERE id = ? FOR UPDATE', [id]);
    if (!order) throw new HttpError(404, 'Order not found');
    if (!TRANSITIONS[order.status].includes(status)) {
      throw new HttpError(409, `An order that is ${order.status} cannot become ${status}`, { code: 'invalid_transition' });
    }
    if (status === 'cancelled') await restock(connection, id);
    await connection.query('UPDATE orders SET status = ?, status_updated_at = NOW() WHERE id = ?', [status, id]);
  });
  return get(id);
};

export { STATUSES, place, markPaid, discardSession, listForUser, getForUser, listAll, get, setStatus };

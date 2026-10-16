import { pool } from '../db.js';
import { HttpError } from '../lib/http.js';
import { assertCountry } from './geo.js';

const view = (row) => ({
  id: row.id,
  countryCode: row.country_code,
  priceCents: row.price_cents,
  active: Boolean(row.active),
});

const COLUMNS = { countryCode: 'country_code', priceCents: 'price_cents', active: 'active' };

const findRow = async (id) => {
  const [rows] = await pool.query('SELECT * FROM shipping_rates WHERE id = ?', [id]);
  if (!rows[0]) throw new HttpError(404, 'Shipping rate not found');
  return rows[0];
};

const rethrowDuplicate = (err) => {
  if (err.code !== 'ER_DUP_ENTRY') throw err;
  throw new HttpError(409, 'A rate for that country already exists', { code: 'rate_exists' });
};

const list = async () => {
  const [rows] = await pool.query('SELECT * FROM shipping_rates ORDER BY country_code IS NOT NULL, country_code');
  return rows.map(view);
};

const create = async (fields) => {
  const keys = Object.keys(fields);
  const [{ insertId }] = await pool
    .query('INSERT INTO shipping_rates (??) VALUES (?)', [keys.map((key) => COLUMNS[key]), keys.map((key) => fields[key])])
    .catch(rethrowDuplicate);
  return view(await findRow(insertId));
};

const update = async (id, fields) => {
  const row = await findRow(id);
  const keys = Object.keys(fields);
  if (keys.length) {
    await pool
      .query(`UPDATE shipping_rates SET ${keys.map((key) => `${COLUMNS[key]} = ?`).join(', ')} WHERE id = ?`, [
        ...keys.map((key) => fields[key]),
        row.id,
      ])
      .catch(rethrowDuplicate);
  }
  return view(await findRow(id));
};

const remove = async (id) => {
  const row = await findRow(id);
  await pool.query('DELETE FROM shipping_rates WHERE id = ?', [row.id]);
};

const noShipping = () => new HttpError(400, "We don't ship there yet", { code: 'no_shipping' });

// Shipping for a destination: its own active rate, else the active default row, else the order is refused.
const shippingCents = async (countryCode, connection = pool) => {
  if (!countryCode) throw noShipping();
  assertCountry(countryCode);
  const [rows] = await connection.query(
    'SELECT price_cents FROM shipping_rates WHERE active = 1 AND (country_code = ? OR country_code IS NULL) ORDER BY country_code IS NULL LIMIT 1',
    [countryCode],
  );
  if (!rows[0]) throw noShipping();
  return rows[0].price_cents;
};

export { list, create, update, remove, shippingCents };

import { pool, withTransaction } from '../db.js';
import { HttpError } from '../lib/http.js';

const MAX_ADDRESSES = 10;

const view = (row) => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  line1: row.line1,
  line2: row.line2,
  countryCode: row.country_code,
  stateCode: row.state_code,
  city: row.city,
  postalCode: row.postal_code,
  isDefault: Boolean(row.is_default),
});

const COLUMNS = {
  fullName: 'full_name',
  phone: 'phone',
  line1: 'line1',
  line2: 'line2',
  countryCode: 'country_code',
  stateCode: 'state_code',
  city: 'city',
  postalCode: 'postal_code',
};

// Serialises a user's address changes (cap, default, promotion) on the user's row.
const lockUser = (connection, userId) => connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);

// Finds an address owned by the user; someone else's row is a 404.
const findOwned = async (userId, id, connection = pool) => {
  const [rows] = await connection.query('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [id, userId]);
  if (!rows[0]) throw new HttpError(404, 'Address not found');
  return rows[0];
};

const list = async (userId) => {
  const [rows] = await pool.query('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id', [userId]);
  return rows.map(view);
};

const get = async (userId, id) => view(await findOwned(userId, id));

// The first address becomes the default.
const create = (userId, fields) =>
  withTransaction(async (connection) => {
    await lockUser(connection, userId);
    const [[{ count }]] = await connection.query('SELECT COUNT(*) AS count FROM addresses WHERE user_id = ?', [userId]);
    if (count >= MAX_ADDRESSES) {
      throw new HttpError(400, `You can save up to ${MAX_ADDRESSES} addresses`, { code: 'address_limit' });
    }
    const [{ insertId }] = await connection.query('INSERT INTO addresses (user_id, is_default, ??) VALUES (?, ?, ?)', [
      Object.values(COLUMNS),
      userId,
      count === 0,
      Object.keys(COLUMNS).map((key) => fields[key]),
    ]);
    return view((await connection.query('SELECT * FROM addresses WHERE id = ?', [insertId]))[0][0]);
  });

const update = async (userId, id, fields) => {
  await withTransaction(async (connection) => {
    await lockUser(connection, userId);
    await findOwned(userId, id, connection);
    const keys = Object.keys(fields);
    if (keys.length) {
      await connection.query(`UPDATE addresses SET ${keys.map((key) => `${COLUMNS[key]} = ?`).join(', ')} WHERE id = ?`, [
        ...keys.map((key) => fields[key]),
        id,
      ]);
    }
  });
  return get(userId, id);
};

const setDefault = async (userId, id) => {
  await withTransaction(async (connection) => {
    await lockUser(connection, userId);
    await findOwned(userId, id, connection);
    await connection.query('UPDATE addresses SET is_default = (id = ?) WHERE user_id = ?', [id, userId]);
  });
  return get(userId, id);
};

// Deleting the default promotes the oldest remaining address.
const remove = (userId, id) =>
  withTransaction(async (connection) => {
    await lockUser(connection, userId);
    const address = await findOwned(userId, id, connection);
    await connection.query('DELETE FROM addresses WHERE id = ?', [id]);
    if (address.is_default) {
      await connection.query('UPDATE addresses SET is_default = 1 WHERE user_id = ? ORDER BY id LIMIT 1', [userId]);
    }
  });

export { list, get, create, update, setDefault, remove };

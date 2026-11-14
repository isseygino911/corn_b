import { pool } from '../db.js';

const PAGE_SIZE = 25;

const signInMethod = (row) => {
  if (row.password_hash && row.google_id) return 'both';
  return row.google_id ? 'google' : 'password';
};

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

const listUsers = async ({ q, page }) => {
  const where = q ? 'WHERE name LIKE ? OR email LIKE ?' : '';
  const params = q ? [`%${escapeLike(q)}%`, `%${escapeLike(q)}%`] : [];
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users ${where}`, params);
  const [rows] = await pool.query(`SELECT * FROM users ${where} ORDER BY id LIMIT ? OFFSET ?`, [
    ...params,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  ]);
  return {
    users: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      verified: Boolean(row.email_verified),
      signInMethod: signInMethod(row),
      admin: Boolean(row.is_admin),
      createdAt: row.created_at,
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
  };
};

// Sold out counts live (non-archived) products and accessories with no stock.
const dashboard = async () => {
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM products WHERE archived_at IS NULL AND active = 1 AND sold = 0) AS activeProducts,
       (SELECT COUNT(*) FROM products WHERE archived_at IS NULL AND active = 0) AS inactiveProducts,
       (SELECT COUNT(*) FROM accessories WHERE archived_at IS NULL) AS accessories,
       (SELECT COUNT(*) FROM products WHERE archived_at IS NULL AND sold = 0 AND stock = 0)
         + (SELECT COUNT(*) FROM accessories WHERE archived_at IS NULL AND stock = 0) AS soldOut`,
  );
  return {
    users: counts.users,
    products: { active: counts.activeProducts, inactive: counts.inactiveProducts },
    accessories: counts.accessories,
    soldOut: Number(counts.soldOut),
  };
};

export { listUsers, dashboard };

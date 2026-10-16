import { closePool, pool } from '../src/db.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run make-admin <email>');
  process.exit(1);
}

const [result] = await pool.query('UPDATE users SET is_admin = 1 WHERE email = ?', [email]);
await closePool();
if (!result.affectedRows) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}
console.log(`${email} is now an admin`);

import mysql from 'mysql2/promise';

const connectionConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

const database = process.env.NODE_ENV === 'test' ? `${process.env.DB_NAME}_test` : process.env.DB_NAME;

const pool = mysql.createPool({ ...connectionConfig, database, waitForConnections: true, connectionLimit: 10 });

const closePool = () => pool.end();

// Runs fn(connection) in a transaction, rolling back if it throws. A deadlock victim is rolled back and retried once.
const withTransaction = async (fn, { retried = false } = {}) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_LOCK_DEADLOCK' && !retried) return withTransaction(fn, { retried: true });
    throw err;
  } finally {
    connection.release();
  }
};

export { connectionConfig, pool, closePool, withTransaction };

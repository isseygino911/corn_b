import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { connectionConfig } from '../src/db.js';

const dir = new URL('../migrations/', import.meta.url);
const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

// Applies pending migrations to the development and test databases.
for (const database of [process.env.DB_NAME, `${process.env.DB_NAME}_test`]) {
  const connection = await mysql.createConnection({ ...connectionConfig, database, multipleStatements: true });
  await connection.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  const [rows] = await connection.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));
  for (const file of files.filter((name) => !applied.has(name))) {
    await connection.query(await fs.readFile(new URL(file, dir), 'utf8'));
    await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    console.log(`${database}: applied ${file}`);
  }
  await connection.end();
}

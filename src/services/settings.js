import { pool } from '../db.js';

const DEFAULTS = { shipping_enabled: '0' };

// Store-wide settings; a key never saved falls back to its default. Pass a connection to read inside a transaction.
const getSettings = async (connection = pool) => {
  const [rows] = await connection.query('SELECT setting_key, setting_value FROM settings');
  const values = { ...DEFAULTS, ...Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value])) };
  return { shippingEnabled: values.shipping_enabled === '1' };
};

const updateSettings = async ({ shippingEnabled }) => {
  const entries = [['shipping_enabled', shippingEnabled === undefined ? undefined : Number(shippingEnabled)]].filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length) {
    await pool.query(
      'INSERT INTO settings (setting_key, setting_value) VALUES ? ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [entries.map(([key, value]) => [key, String(value)])],
    );
  }
  return getSettings();
};

export { getSettings, updateSettings };

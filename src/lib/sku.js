const PREFIXES = { charms: 'CHM', pearls: 'PRL', accessories: 'ACC' };
const SKU_PATTERN = /^[A-Z]{3}\d{4,8}$/;

// Next SKU for a prefix: highest existing number + 1, padded to at least four digits. `table` is 'products' or 'accessories'.
const nextSku = async (connection, table, kind) => {
  const prefix = PREFIXES[kind];
  const [[row]] = await connection.query(`SELECT MAX(CAST(SUBSTRING(sku, 4) AS UNSIGNED)) AS last FROM ${table} WHERE sku LIKE ?`, [`${prefix}%`]);
  const next = (row.last ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
};

export { SKU_PATTERN, nextSku };

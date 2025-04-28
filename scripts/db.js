const mysql = require('mysql2');
const util = require('util');
const axios = require('axios');
require('dotenv').config();

// Set up MySQL connection
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST,
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  port: process.env.MYSQL_PORT || 3306,
};

const connection = mysql.createConnection(MYSQL_CONFIG);
const query = util.promisify(connection.query.bind(connection));

// Set up BigCommerce API client
const bigcommerce = axios.create({
  baseURL: `https://api.bigcommerce.com/stores/${process.env.STORE_HASH}/v3`,
  headers: {
    'X-Auth-Token': process.env.ACCESS_TOKEN,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

async function createTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sku VARCHAR(100) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      stock INT NOT NULL,
      price DECIMAL(10,2) NOT NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS bundles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS bundle_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      bundle_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);
}

async function syncProductsFromBigCommerce() {
  console.log('[DB] Syncing products from BigCommerce...');

  const { data } = await bigcommerce.get('/catalog/products?limit=250');

  for (const p of data.data) {
    if (!p.sku) continue;

    const sku = p.sku;
    const name = p.name;
    const stock = p.inventory_level || 0;
    const price = p.price || 0.00;

    await query(`
      INSERT INTO products (sku, name, stock, price)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        stock = VALUES(stock),
        price = VALUES(price);
    `, [sku, name, stock, price]);
  }

  console.log(`[DB] ✅ Synced ${data.data.length} products from BigCommerce.`);
}

(async () => {
  try {
    await createTables();
    await syncProductsFromBigCommerce();
  } catch (err) {
    console.error('[DB] ❌ Error:', err.message);
  } finally {
    connection.end();
  }
})();

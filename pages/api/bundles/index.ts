// pages/api/bundles/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const { name, items, price } = req.body;

  if (!name || !items || items.length === 0 || !price) {
    return res.status(400).json({ message: 'Invalid bundle data' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    const [bundleResult] = await conn.query(
      'INSERT INTO bundles (name, price) VALUES (?, ?)',
      [name, price]
    );

    const bundleId = (bundleResult as any).insertId;

    for (const item of items) {
      const [product] = await conn.query('SELECT id FROM products WHERE sku = ?', [item.sku]);
      const productId = (product as any)[0]?.id;

      if (!productId) throw new Error(`Product not found for SKU: ${item.sku}`);

      await conn.query(
        'INSERT INTO bundle_items (bundle_id, product_id, quantity) VALUES (?, ?, ?)',
        [bundleId, productId, item.quantity]
      );
    }

    await conn.commit();
    conn.release();

    res.status(200).json({ message: 'Bundle saved successfully' });
  } catch (error) {
    console.error('[Bundle Save Error]', error);
    res.status(500).json({ message: 'Error saving bundle', error: error.message });
  }
}

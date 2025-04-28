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
  try {
    const [rows] = await pool.query(`
      SELECT sku, name, price, stock FROM products
    `);

    res.status(200).json({ data: rows });
  } catch (error) {
    console.error('[Bundle Products API Error]', error);
    res.status(500).json({ message: 'Failed to fetch bundle products' });
  }
}

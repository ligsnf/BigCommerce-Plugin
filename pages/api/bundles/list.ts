import mysql from 'mysql2/promise';
import type { NextApiRequest, NextApiResponse } from 'next';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  try {
    const [bundles] = await pool.query(`
      SELECT 
        b.id, 
        b.name, 
        b.price,
        GROUP_CONCAT(p.sku SEPARATOR ', ') as skus
      FROM 
        bundles b
      LEFT JOIN 
        bundle_items bi ON b.id = bi.bundle_id
      LEFT JOIN 
        products p ON bi.product_id = p.id
      GROUP BY 
        b.id
      ORDER BY 
        b.name
    `);
    res.status(200).json({ bundles });
  } catch (err) {
    console.error('[API Bundles List Error]', err);
    res.status(500).json({ message: 'Error fetching bundles', error: err.message });
  }
}

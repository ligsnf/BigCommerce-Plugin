// pages/api/bundles/list.ts
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
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  try {
    const [rows] = await pool.query('SELECT id, name, price FROM bundles');
    res.status(200).json({ bundles: rows });
  } catch (err) {
    console.error('[API Bundles List Error]', err);
    res.status(500).json({ message: 'Error fetching bundles', error: err.message });
  }
}

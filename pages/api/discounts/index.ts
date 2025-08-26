import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/database.js';

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS category_discounts (
      id SERIAL PRIMARY KEY,
      store_hash VARCHAR(10) NOT NULL,
      name TEXT NOT NULL,
      categories JSONB NOT NULL,
      type TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      start_date DATE,
      end_date DATE,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { storeHash } = await getSession(req);
    await ensureTable();

    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM category_discounts WHERE store_hash = ${storeHash} ORDER BY created_at DESC`;
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { name, categories, type, amount, startDate, endDate, status } = req.body || {};

      if (!name || !Array.isArray(categories) || !type || !amount) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const [row] = await sql`
        INSERT INTO category_discounts (store_hash, name, categories, type, amount, start_date, end_date, status)
        VALUES (
          ${storeHash},
          ${name},
          ${JSON.stringify(categories)},
          ${type},
          ${amount},
          ${startDate || null},
          ${endDate || null},
          ${status || 'Active'}
        )
        RETURNING *
      `;

      return res.status(201).json({ data: row });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.message || 'Internal server error';
    return res.status(status).json({ message });
  }
}




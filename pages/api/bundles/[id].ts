// pages/api/bundles/[id].ts
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
  const { id } = req.query;

  if (!id || Array.isArray(id)) {
    return res.status(400).json({ message: 'Invalid bundle ID' });
  }

  if (req.method === 'GET') {
    try {
      const [bundleRows] = await pool.query('SELECT * FROM bundles WHERE id = ?', [id]);
      if ((bundleRows as any).length === 0) {
        return res.status(404).json({ message: 'Bundle not found' });
      }

      const bundle = (bundleRows as any)[0];

      const [items] = await pool.query(
        `
        SELECT p.sku, bi.quantity
        FROM bundle_items bi
        JOIN products p ON p.id = bi.product_id
        WHERE bi.bundle_id = ?
        `,
        [id]
      );

      res.status(200).json({
        id: bundle.id,
        name: bundle.name,
        price: bundle.price,
        items,
      });
    } catch (error) {
      console.error('[GET Bundle Error]', error);
      res.status(500).json({ message: 'Failed to fetch bundle' });
    }
  } 
  
  else if (req.method === 'PUT') {
    const { name, price, items } = req.body;

    if (!name || !price || !Array.isArray(items)) {
      return res.status(400).json({ message: 'Invalid bundle data' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Update bundle name and price
      await conn.query(
        'UPDATE bundles SET name = ?, price = ? WHERE id = ?',
        [name, price, id]
      );

      // Delete old bundle items
      await conn.query(
        'DELETE FROM bundle_items WHERE bundle_id = ?',
        [id]
      );

      // Re-insert new bundle items
      for (const item of items) {
        const [product] = await conn.query('SELECT id FROM products WHERE sku = ?', [item.sku]);
        const productId = (product as any)[0]?.id;
        if (!productId) {
          throw new Error(`Product not found for SKU: ${item.sku}`);
        }

        await conn.query(
          'INSERT INTO bundle_items (bundle_id, product_id, quantity) VALUES (?, ?, ?)',
          [id, productId, item.quantity]
        );
      }

      await conn.commit();
      res.status(200).json({ message: 'Bundle updated successfully' });
    } catch (error) {
      await conn.rollback();
      console.error('[PUT Bundle Error]', error);
      res.status(500).json({ message: 'Failed to update bundle', error: error.message });
    } finally {
      conn.release();
    }
  } 
  
  else if (req.method === 'DELETE') {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
  
      // Delete bundle items first
      await conn.query('DELETE FROM bundle_items WHERE bundle_id = ?', [id]);
  
      // Then delete the bundle itself
      await conn.query('DELETE FROM bundles WHERE id = ?', [id]);
  
      await conn.commit();
      res.status(200).json({ message: 'Bundle deleted successfully' });
    } catch (error) {
      await conn.rollback();
      console.error('[DELETE Bundle Error]', error);
      res.status(500).json({ message: 'Failed to delete bundle', error: error.message });
    } finally {
      conn.release();
    }
  }
  
  
  else {
    res.setHeader('Allow', ['GET', 'PUT']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

// pages/api/products/[productId]/metafields.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '../../../../lib/db'; // adjust path as necessary

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const productId = Number(req.query.productId);

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { isBundle, linkedProductIds } = req.body;

  if (typeof isBundle !== 'boolean' || !Array.isArray(linkedProductIds)) {
    return res.status(400).json({ message: 'Invalid request body' });
  }

  try {
    // Save bundle metafields (example: updating a `bundles` table)
    await query(`
      INSERT INTO bundles (product_id, is_bundle)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE is_bundle = ?
    `, [productId, isBundle, isBundle]);

    // Delete existing links and re-insert new ones
    await query(`DELETE FROM bundle_links WHERE bundle_id = ?`, [productId]);

    if (linkedProductIds.length > 0) {
      const values = linkedProductIds.map(id => `(${productId}, ${id})`).join(',');
      await query(`INSERT INTO bundle_links (bundle_id, product_id) VALUES ${values}`);
    }

    res.status(200).json({ message: 'Metafields saved' });
  } catch (err) {
    console.error('Metafields save error:', err);
    res.status(500).json({ message: 'Server error' });
  }
}

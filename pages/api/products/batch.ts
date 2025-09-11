import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    
return res.status(405).end('Method Not Allowed');
  }

  try {
    const { accessToken, storeHash } = await getSession(req);
    if (!accessToken || !storeHash) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const idsParam = String(req.query.ids || '').trim();
    if (!idsParam) {
      return res.status(400).json({ message: 'Missing ids query param' });
    }

    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 250); // BigCommerce limit safeguard

    if (ids.length === 0) {
      return res.status(400).json({ message: 'No valid ids provided' });
    }

    const bc = bigcommerceClient(accessToken, storeHash);

    // Fetch all products in a single request; include variants for downstream logic
    const query = `/catalog/products?id:in=${ids.join(',')}&include=variants&limit=${Math.max(
      ids.length,
      1,
    )}`;
    const { data: products } = await bc.get(query);

    return res.status(200).json(products || []);
  } catch (error: any) {
    console.error('[API] /products/batch failed:', error.response?.data || error.message);
    
return res.status(error.response?.status || 500).json({ message: error.message || 'Internal error' });
  }
}




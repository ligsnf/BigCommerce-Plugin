import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {

    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { accessToken, storeHash } = await getSession(req);
    const bc = bigcommerceClient(accessToken, storeHash);

    // Try to find an existing category named "Bundle"
    const { data: categories } = await bc.get('/catalog/categories?limit=250');
    const existing = (categories || []).find((c: any) => String(c?.name || '').toLowerCase() === 'bundle');

    if (existing) { 

      return res.status(200).json({ id: existing.id });
    }

    // Create the category if it doesn't exist
    const { data: created } = await bc.post('/catalog/categories', {
      name: 'Bundle',
      parent_id: 0,
      is_visible: true,
    });

    return res.status(201).json({ id: created?.id });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.message || 'Failed to ensure Bundle category';

    return res.status(status).json({ message });
  }
}



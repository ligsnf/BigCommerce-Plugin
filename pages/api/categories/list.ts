import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const session = await getSession(req);
    const { accessToken, storeHash } = session;
    const bc = bigcommerceClient(accessToken, storeHash);

    // Fetch categories (all, first 250)
    const { data } = await bc.get('/catalog/categories?limit=250');

    const options = (data || []).map((c: any) => ({ value: String(c.id), content: c.name, id: c.id }));

    return res.status(200).json({ options, raw: data });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.message || 'Failed to fetch categories';

    return res.status(status).json({ message });
  }
}



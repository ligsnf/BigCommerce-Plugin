import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const productId = req.query.productId;

  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ message: 'Invalid product ID' });
  }

  const { accessToken, storeHash } = await getSession(req);
  const baseUrl = `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${productId}/metafields`;

  // GET: Retrieve metafields
  if (req.method === 'GET') {
    try {
      const response = await fetch(baseUrl, {
        method: 'GET',
        headers: {
          'X-Auth-Token': accessToken,
          Accept: 'application/json',
        },
      });

      const { data } = await response.json();

      const isBundle = data.find(f => f.key === 'is_bundle')?.value === 'true';
      const linkedIdsRaw = data.find(f => f.key === 'linked_product_ids')?.value;
      const linkedProductIds = linkedIdsRaw ? JSON.parse(linkedIdsRaw) : [];

      return res.status(200).json({ isBundle, linkedProductIds });
    } catch (err: any) {
      console.error('[GET metafields] Error:', err);
      return res.status(500).json({ message: err.message });
    }
  }

  // POST: Save or update metafields
  if (req.method === 'POST') {
    try {
      const { isBundle, linkedProductIds } = req.body;

      if (typeof isBundle !== 'boolean') {
        return res.status(400).json({ message: 'Missing or invalid isBundle' });
      }

      // First, get existing metafields to check if they exist
      const existingRes = await fetch(baseUrl, {
        method: 'GET',
        headers: {
          'X-Auth-Token': accessToken,
          Accept: 'application/json',
        },
      });

      const { data: existingFields } = await existingRes.json();

      const existingByKey = Object.fromEntries(
        existingFields.map((field: any) => [field.key, field])
      );

      const metafields = [
        {
          key: 'is_bundle',
          value: isBundle.toString(),
          namespace: 'bundle',
          permission_set: 'app_only',
          description: 'Whether this product is a bundle',
        },
        {
          key: 'linked_product_ids',
          value: JSON.stringify(linkedProductIds ?? []),
          namespace: 'bundle',
          permission_set: 'app_only',
          description: 'Array of product IDs linked in the bundle',
        }
      ];

      const responses = await Promise.all(
        metafields.map(async (field) => {
          const existing = existingByKey[field.key];
          const method = existing ? 'PUT' : 'POST';
          const url = existing
            ? `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${productId}/metafields/${existing.id}`
            : baseUrl;

          const response = await fetch(url, {
            method,
            headers: {
              'X-Auth-Token': accessToken,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(field),
          });

          const result = await response.json();
          return result;
        })
      );

      return res.status(200).json({ message: 'Metafields saved/updated', responses });
    } catch (err: any) {
      console.error('[POST metafields] Error:', err);
      return res.status(500).json({ message: err.message });
    }
  }

  // Method not allowed
  return res.status(405).setHeader('Allow', 'GET, POST').end('Method Not Allowed');
}

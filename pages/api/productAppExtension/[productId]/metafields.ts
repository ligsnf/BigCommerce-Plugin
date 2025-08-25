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

      // Restrict to the shared namespace
      const bundleFields = (data || []).filter((f: any) => f.namespace === 'bundle');
      const isBundle = bundleFields.find((f: any) => f.key === 'is_bundle')?.value === 'true';
      const linkedIdsRaw = bundleFields.find((f: any) => f.key === 'linked_product_ids')?.value;
      let linkedProductIds = linkedIdsRaw ? JSON.parse(linkedIdsRaw) : [];
      // Normalize: always return array of { productId, variantId, quantity }
      linkedProductIds = linkedProductIds.map(item => {
        if (typeof item === 'object' && item !== null) {
          return {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity ?? 1
          };
        } else {
          return {
            productId: item,
            variantId: null,
            quantity: 1
          };
        }
      });

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
        (existingFields || [])
          .filter((f: any) => f.namespace === 'bundle')
          .map((field: any) => [field.key, field])
      );

      // Ensure all entries are objects with productId, variantId, quantity
      const normalizedLinkedProductIds = (linkedProductIds ?? []).map(item => {
        if (typeof item === 'object' && item !== null) {
          return {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity ?? 1
          };
        } else {
          return {
            productId: item,
            variantId: null,
            quantity: 1
          };
        }
      });

      const metafields = [
        {
          key: 'is_bundle',
          value: isBundle.toString(),
          namespace: 'bundle',
          permission_set: 'read_and_write',
          description: 'Whether this product is a bundle',
        },
        {
          key: 'linked_product_ids',
          value: JSON.stringify(normalizedLinkedProductIds),
          namespace: 'bundle',
          permission_set: 'read_and_write',
          description: 'Array of product/variant objects in the bundle',
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

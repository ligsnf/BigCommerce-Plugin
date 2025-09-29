import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@lib/auth';

// Simple in-memory cache
const serverCache = new Map<string, { value: any; expiresAt: number }>();
const getCache = (key: string) => {
  const e = serverCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { serverCache.delete(key); 

return null; }
  
return e.value;
};
const setCache = (key: string, value: any, ttlMs = 60_000) => {
  serverCache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { productId, variantId } = req.query;

    if (!productId || typeof productId !== 'string' || !variantId || typeof variantId !== 'string') {
      return res.status(400).json({ message: 'Invalid product ID or variant ID' });
    }

    const session = await getSession(req);
    if (!session || !session.accessToken || !session.storeHash) {
      console.error('[GET variant metafields] Session error:', session);
      
return res.status(401).json({ message: 'Invalid session or missing auth data' });
    }

    const { accessToken, storeHash } = session;
  const baseUrl = `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${productId}/variants/${variantId}/metafields`;

  // GET: Retrieve metafields
  if (req.method === 'GET') {
    try {
      const cacheKey = `variant:metafields:${storeHash}:${productId}:${variantId}`;
      const hit = getCache(cacheKey);
      if (hit) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
        
return res.status(200).json(hit);
      }
      const response = await fetch(baseUrl, {
        method: 'GET',
        headers: {
          'X-Auth-Token': accessToken,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`[GET variant metafields] API error: ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        console.error(`[GET variant metafields] Error response:`, errorText);
        throw new Error(`BigCommerce API error: ${response.status} - ${errorText}`);
      }

      const responseText = await response.text();
      if (!responseText.trim()) {
        console.error('[GET variant metafields] Empty response from BigCommerce API');
        const payload = { isBundle: false, linkedProductIds: [], overridePrice: null, originalSku: null };
        setCache(cacheKey, payload, 60_000);
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
        
return res.status(200).json(payload);
      }

      let parsedResponse;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[GET variant metafields] Failed to parse response as JSON:', parseError);
        console.error('[GET variant metafields] Raw response:', responseText);
        throw new Error(`Invalid JSON response from BigCommerce API`);
      }

      const { data } = parsedResponse;

      const isBundle = data.find(f => f.key === 'is_bundle')?.value === 'true';
      const linkedIdsRaw = data.find(f => f.key === 'linked_product_ids')?.value;
      const overridePriceRaw = data.find(f => f.key === 'override_price')?.value;
      const originalSkuRaw = data.find(f => f.key === 'original_sku')?.value;
      let linkedProductIds = [];
      if (linkedIdsRaw) {
        try {
          linkedProductIds = JSON.parse(linkedIdsRaw);
        } catch (e) {
          console.warn('[GET variant metafields] Invalid JSON in linked_product_ids:', linkedIdsRaw);
          linkedProductIds = [];
        }
      }
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
      const overridePrice = overridePriceRaw != null ? parseFloat(overridePriceRaw) : null;
      const originalSku = originalSkuRaw != null ? String(originalSkuRaw) : null;

      const payload = { isBundle, linkedProductIds, overridePrice, originalSku };
      setCache(cacheKey, payload, 60_000);
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
      
return res.status(200).json(payload);
    } catch (err: any) {
      console.error('[GET variant metafields] Error:', err);

      return res.status(500).json({ message: err.message });
    }
  }

  // POST: Save or update metafields
  if (req.method === 'POST') {
    try {
      const { isBundle, linkedProductIds, overridePrice, originalSku } = req.body;

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
          permission_set: 'app_only',
          description: 'Whether this variant is a bundle',
        },
        {
          key: 'linked_product_ids' ,
          value: JSON.stringify(normalizedLinkedProductIds),
          namespace: 'bundle',
          permission_set: 'app_only',
          description: 'Array of product/variant objects in the variant bundle',
        },
        ...(overridePrice != null && overridePrice !== '' ? [{
          key: 'override_price',
          value: String(overridePrice),
          namespace: 'bundle',
          permission_set: 'app_only',
          description: 'Optional manual price override for the variant bundle',
        }] : []),
        ...(originalSku != null && originalSku !== '' ? [{
          key: 'original_sku',
          value: String(originalSku),
          namespace: 'bundle',
          permission_set: 'app_only',
          description: 'Original SKU before variant bundle status',
        }] : [])
      ];

      const responses = await Promise.all(
        metafields.map(async (field) => {
          const existing = existingByKey[field.key];
          const method = existing ? 'PUT' : 'POST';
          const url = existing
            ? `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${productId}/variants/${variantId}/metafields/${existing.id}`
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

      // Invalidate cache after update
      serverCache.delete(`variant:metafields:${storeHash}:${productId}:${variantId}`);

      // If overridePrice is not provided, delete existing override_price metafield if present
      if ((overridePrice == null || overridePrice === '') && existingByKey['override_price']) {
        try {
          await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${productId}/variants/${variantId}/metafields/${existingByKey['override_price'].id}`, {
            method: 'DELETE',
            headers: {
              'X-Auth-Token': accessToken,
              Accept: 'application/json',
            },
          });
        } catch (e) {
          console.warn('[DELETE override_price metafield] Warning:', e);
        }
      }

      return res.status(200).json({ message: 'Variant metafields saved/updated', responses });
    } catch (err: any) {
      console.error('[POST variant metafields] Error:', err);

      return res.status(500).json({ message: err.message });
    }
  }

    // Method not allowed
    return res.status(405).setHeader('Allow', 'GET, POST').end('Method Not Allowed');
  } catch (error: any) {
    console.error('[variant metafields handler] Unexpected error:', error);
    
return res.status(500).json({ 
      message: 'Internal server error', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
} 
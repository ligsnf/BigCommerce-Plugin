import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient , getSession } from '@lib/auth';

// Simple in-memory cache for server responses
const serverCache = new Map<string, { value: any; expiresAt: number }>();
const getCache = (key: string) => {
  const entry = serverCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    serverCache.delete(key);
    
return null;
  }
  
return entry.value;
};
const setCache = (key: string, value: any, ttlMs = 60_000) => {
  serverCache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const session = await getSession(req);
    if (!session) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { accessToken, storeHash } = session;
    const bc = bigcommerceClient(accessToken, storeHash);

    const cacheKey = `bundles:list:${storeHash}`;
    const cached = getCache(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
      
return res.status(200).json(cached);
    }

    // Fetch all products
    const { data: products } = await bc.get('/catalog/products?include=variants');

    const regularProducts = [];
    const bundles = [];

    // Process each product
    for (const product of products) {
      // Check product-level metafields
      const { data: productMetafields } = await bc.get(`/catalog/products/${product.id}/metafields`);
      const isProductBundle = productMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';

      if (isProductBundle) {
        const linkedField = productMetafields.find(f => f.key === 'linked_product_ids' && f.namespace === 'bundle');
        if (linkedField) {
          const linkedProductIds = JSON.parse(linkedField.value);
          bundles.push({
            id: product.id,
            name: product.name,
            sku: product.sku,
            isVariant: false,
            productCount: linkedProductIds.length
          });
        }
      } else {
        // Check if any variants are bundles
        const hasVariantBundles = product.variants?.some(variant => {
          const variantMetafields = variant.metafields || [];

          return variantMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';
        });

        if (!hasVariantBundles) {
          regularProducts.push({
            id: product.id,
            name: product.name,
            sku: product.sku,
            variants: product.variants || []
          });
        }

        // Process variants for bundles
        if (product.variants?.length > 0) {
          for (const variant of product.variants) {
            const { data: variantMetafields } = await bc.get(`/catalog/products/${product.id}/variants/${variant.id}/metafields`);
            const isVariantBundle = variantMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';

            if (isVariantBundle) {
              const linkedField = variantMetafields.find(f => f.key === 'linked_product_ids' && f.namespace === 'bundle');
              if (linkedField) {
                const linkedProductIds = JSON.parse(linkedField.value);
                const variantName = variant.option_values?.map(ov => ov.label).join(' - ') || 'Variant';
                
                bundles.push({
                  id: product.id,
                  name: product.name,
                  sku: variant.sku || product.sku,
                  isVariant: true,
                  variantId: variant.id,
                  variantName,
                  productCount: linkedProductIds.length
                });
              }
            }
          }
        }
      }
    }

    const payload = {
      products: regularProducts,
      bundles
    };

    setCache(cacheKey, payload, 60_000);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
    res.status(200).json(payload);
  } catch (error) {
    console.error('Error fetching products and bundles:', error);
    res.status(500).json({ message: 'Error fetching products and bundles' });
  }
}

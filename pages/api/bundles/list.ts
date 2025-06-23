import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient , getSession } from '@lib/auth';

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

    res.status(200).json({
      products: regularProducts,
      bundles
    });
  } catch (error) {
    console.error('Error fetching products and bundles:', error);
    res.status(500).json({ message: 'Error fetching products and bundles' });
  }
}

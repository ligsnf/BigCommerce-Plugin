import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient } from '../../../lib/auth';
import db from '../../../lib/db';

// Utility to get bundle info for a product
async function getProductBundleInfo(productId: number, bc: any) {
  const { data: metafields } = await bc.get(`/catalog/products/${productId}/metafields`);
  const isBundle = metafields.find((f: any) => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';
  const linkedField = metafields.find((f: any) => f.key === 'linked_product_ids' && f.namespace === 'bundle');
  const linkedProductIds = linkedField ? JSON.parse(linkedField.value) : [];
  
  return { isBundle, linkedProductIds };
}

// Utility to get bundle info for a variant
async function getVariantBundleInfo(productId: number, variantId: number, bc: any) {
  const { data: metafields } = await bc.get(`/catalog/products/${productId}/variants/${variantId}/metafields`);
  const isBundle = metafields.find((f: any) => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';
  const linkedField = metafields.find((f: any) => f.key === 'linked_product_ids' && f.namespace === 'bundle');
  const linkedProductIds = linkedField ? JSON.parse(linkedField.value) : [];

  return { isBundle, linkedProductIds };
}

// Utility to parse linked product info
function parseLinkedProduct(linkedProduct: any) {
  return {
    productId: typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct,
    variantId: typeof linkedProduct === 'object' ? linkedProduct.variantId : null,
    quantity: typeof linkedProduct === 'object' ? linkedProduct.quantity : 1,
  };
}

// Helper function to update affected bundles when a product's inventory changes
async function updateAffectedBundles(productId: number, variantId: number | null, bc: any) {
  console.log(`[Product Update] Updating bundles affected by product ${productId}${variantId ? ` variant ${variantId}` : ''}`);
  
  // Get all products that are bundles
  const { data: allProducts } = await bc.get('/catalog/products');
  const bundleProducts = [];
  const bundleVariants = [];
  
  // Find all bundles and their details
  for (const product of allProducts) {
    // Check product-level metafields
    const { isBundle: isProductBundle, linkedProductIds: productLinkedProductIds } = await getProductBundleInfo(product.id, bc);
    
    if (isProductBundle) {
      bundleProducts.push({
        id: product.id,
        linkedProductIds: productLinkedProductIds
      });
    }

    // Check variant-level metafields
    const { data: variants } = await bc.get(`/catalog/products/${product.id}/variants`);
    for (const variant of variants) {
      const { isBundle: isVariantBundle, linkedProductIds: variantLinkedProductIds } = await getVariantBundleInfo(product.id, variant.id, bc);
      
      if (isVariantBundle) {
        bundleVariants.push({
          productId: product.id,
          variantId: variant.id,
          linkedProductIds: variantLinkedProductIds
        });
      }
    }
  }

  // Find and update all product bundles that contain this product
  const affectedBundles = bundleProducts.filter(bundle => 
    bundle.linkedProductIds.some((linkedProduct: any) => {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      const targetVariantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
      
      // Match product ID and variant ID (if specified)
      if (variantId) {
        return targetProductId === productId && targetVariantId === variantId;
      } else {
        return targetProductId === productId && !targetVariantId;
      }
    })
  );
  
  // Find and update all variant bundles that contain this product
  const affectedVariantBundles = bundleVariants.filter(bundle => 
    bundle.linkedProductIds.some((linkedProduct: any) => {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      const targetVariantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
      
      // Match product ID and variant ID (if specified)
      if (variantId) {
        return targetProductId === productId && targetVariantId === variantId;
      } else {
        return targetProductId === productId && !targetVariantId;
      }
    })
  );
  
  console.log(`[Product Update] Found ${affectedBundles.length} product bundles and ${affectedVariantBundles.length} variant bundles to update`);
  
  // Update product bundles
  for (const bundle of affectedBundles) {
    let minPossibleBundles = Infinity;
    for (const linkedProduct of bundle.linkedProductIds) {
      const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
      
      if (targetVariantId) {
        const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
        const possibleBundles = Math.floor(linkedVariant.inventory_level / quantity);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      } else {
        const { data: linkedProductObj } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProductObj.inventory_level / quantity);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      }
    }
    
    const newInventoryLevel = Math.max(0, minPossibleBundles);
    await bc.put(`/catalog/products/${bundle.id}`, {
      inventory_level: newInventoryLevel
    });
    
    console.log(`[Product Update] Updated product bundle ${bundle.id} inventory to ${newInventoryLevel}`);
  }

  // Update variant bundles
  for (const bundle of affectedVariantBundles) {
    let minPossibleBundles = Infinity;
    for (const linkedProduct of bundle.linkedProductIds) {
      const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
      
      if (targetVariantId) {
        const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
        const possibleBundles = Math.floor(linkedVariant.inventory_level / quantity);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      } else {
        const { data: linkedProductObj } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProductObj.inventory_level / quantity);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      }
    }
    
    const newInventoryLevel = Math.max(0, minPossibleBundles);
    await bc.put(`/catalog/products/${bundle.productId}/variants/${bundle.variantId}`, {
      inventory_level: newInventoryLevel
    });
    
    console.log(`[Product Update] Updated variant bundle ${bundle.productId}:${bundle.variantId} inventory to ${newInventoryLevel}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  try {
    const product = req.body.data;
    const scope = req.body.scope;
    
    // Extract store hash from producer field (format: "stores/7wt5mizwwn")
    const storeHash = req.body.producer?.split('/')[1];

    if (!product || !storeHash) {
      return res.status(400).json({ message: 'Missing required information' });
    }

    console.log(`[Product Update] Received ${scope} webhook for product ${product.id} in store ${storeHash}`);

    // Get the access token for this store from the database
    const accessToken = await db.getStoreToken(storeHash);

    if (!accessToken) {
      return res.status(401).json({ message: 'Store not authorized' });
    }

    const bc = bigcommerceClient(accessToken, storeHash);

    // Handle product updates (covers both product and variant updates)
    if (scope === 'store/product/updated') {
      // Check if this is a variant update or product update
      if (product.variant_id) {
        // Variant-level update
        await updateAffectedBundles(product.product_id || product.id, product.variant_id, bc);
      } else {
        // Product-level update
        await updateAffectedBundles(product.id, null, bc);
      }
    }

    res.status(200).json({ message: 'Bundle inventory updated successfully' });
  } catch (err: any) {
    console.error('[Product Update] Error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
}

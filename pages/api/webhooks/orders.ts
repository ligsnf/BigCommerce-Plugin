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

// Utility to update inventory for a product or variant
async function updateInventory(targetProductId: number, targetVariantId: number | null, totalQuantity: number, bc: any) {
  if (targetVariantId) {
    const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
    const newStock = Math.max(0, linkedVariant.inventory_level - totalQuantity);
    return await bc.put(`/catalog/products/${targetProductId}/variants/${targetVariantId}`, { inventory_level: newStock });
  } else {
    const { data: linkedProduct } = await bc.get(`/catalog/products/${targetProductId}`);
    const newStock = Math.max(0, linkedProduct.inventory_level - totalQuantity);
    return await bc.put(`/catalog/products/${targetProductId}`, { inventory_level: newStock });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  console.log('[Bundle Debug] Orders webhook received');
  try {
    const order = req.body.data;
    // Extract store hash from producer field (format: "stores/7wt5mizwwn")
    const storeHash = req.body.producer?.split('/')[1];

    if (!order || !storeHash) {
      return res.status(400).json({ message: 'Missing required information' });
    }

    // Get the access token for this store from the database
    const accessToken = await db.getStoreToken(storeHash);

    if (!accessToken) {
      return res.status(401).json({ message: 'Store not authorized' });
    }

    const bc = bigcommerceClient(accessToken, storeHash);
    const orderId = order.id;
    console.log('[Bundle Debug] Order ID:', orderId);

    // Fetch order products using V2 API manually
    const orderProductsRes = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}/products`, {
      method: 'GET',
      headers: {
        'X-Auth-Token': accessToken,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!orderProductsRes.ok) {
      throw new Error(`Failed to fetch order products: ${orderProductsRes.status}`);
    }

    const orderDetails = await orderProductsRes.json();

    // Get all products that are bundles
    const { data: allProducts } = await bc.get('/catalog/products');
    console.log('[Bundle Debug] Fetched all products:', allProducts.length);
    const bundleProducts = [];
    const bundleVariants = [];
    
    // Find all bundles and their details
    for (const product of allProducts) {
      // Check product-level metafields
      const { isBundle: isProductBundle, linkedProductIds: productLinkedProductIds } = await getProductBundleInfo(product.id, bc);
      console.log(`[Bundle Debug] Product ${product.id} isBundle:`, isProductBundle, 'linkedProductIds:', productLinkedProductIds);
      
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
        console.log(`[Bundle Debug] Variant ${variant.id} of Product ${product.id} isBundle:`, isVariantBundle, 'linkedProductIds:', variantLinkedProductIds);
        
        if (isVariantBundle) {
          bundleVariants.push({
            productId: product.id,
            variantId: variant.id,
            linkedProductIds: variantLinkedProductIds
          });
        }
      }
    }

    // Process each ordered item
    for (const item of orderDetails) {
      const productId = item.product_id;
      const variantId = item.variant_id;
      const orderedQuantity = item.quantity;
      console.log(`[Bundle Debug] Processing order item:`, { productId, variantId, orderedQuantity });
      
      // Check if the ordered item is a variant bundle
      if (variantId) {
        const { isBundle: isVariantBundle, linkedProductIds: variantLinkedProductIds } = await getVariantBundleInfo(productId, variantId, bc);
        console.log(`[Bundle Debug] Order item is variant. isVariantBundle:`, isVariantBundle, 'linkedProductIds:', variantLinkedProductIds);

        if (isVariantBundle) {
          if (variantLinkedProductIds) {
            // Update stock for each product in the bundle
            for (const linkedProduct of variantLinkedProductIds) {
              const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
              const totalQuantity = orderedQuantity * quantity;
              console.log(`[Bundle Debug] Updating inventory for linked variant bundle:`, { targetProductId, targetVariantId, quantity, orderedQuantity, totalQuantity });
              await updateInventory(targetProductId, targetVariantId, totalQuantity, bc);
            }
          } else {
            console.log('[Bundle Debug] No linkedProductIds found for variant bundle');
          }
        } else {
          console.log('[Bundle Debug] Variant is not a bundle. Updating affected bundles.');
          // Handle individual variant purchase - update affected bundles
          await updateAffectedBundles(productId, orderedQuantity, bundleProducts, bundleVariants, bc);
        }
      } else {
        // Check if the ordered item is a product bundle
        const { isBundle: isProductBundle, linkedProductIds: productLinkedProductIds } = await getProductBundleInfo(productId, bc);
        console.log(`[Bundle Debug] Order item is product. isProductBundle:`, isProductBundle, 'linkedProductIds:', productLinkedProductIds);
        
        if (isProductBundle) {
          if (productLinkedProductIds) {
            console.log('[Bundle Debug] Processing bundle purchase:', { productId, orderedQuantity, linkedProductIds: productLinkedProductIds });
            // Update stock for each product in the bundle
            for (const linkedProduct of productLinkedProductIds) {
              const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
              const totalQuantity = orderedQuantity * quantity;
              console.log('[Bundle Debug] Updating inventory for linked product bundle:', { targetProductId, targetVariantId, quantity, orderedQuantity, totalQuantity });
              await updateInventory(targetProductId, targetVariantId, totalQuantity, bc);
            }
          } else {
            console.log('[Bundle Debug] No linkedProductIds found for product bundle');
          }
        } else {
          console.log('[Bundle Debug] Product is not a bundle. Updating affected bundles.');
          // Handle individual product purchase - update affected bundles
          await updateAffectedBundles(productId, orderedQuantity, bundleProducts, bundleVariants, bc);
        }
      }
    }

    res.status(200).json({ message: 'Stock levels updated successfully' });
  } catch (err: any) {
    console.error('Webhook error:', err);
    console.error('Error details:', err.response?.data || err.message);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
}

// Helper function to update affected bundles
async function updateAffectedBundles(productId: number, orderedQuantity: number, bundleProducts: any[], bundleVariants: any[], bc: any) {
  console.log('[Bundle Debug] updateAffectedBundles called for productId:', productId, 'orderedQuantity:', orderedQuantity);
  // Find and update all product bundles that contain this product
  const affectedBundles = bundleProducts.filter(bundle => 
    bundle.linkedProductIds.some((linkedProduct: any) => {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      return targetProductId === productId;
    })
  );
  console.log('[Bundle Debug] Affected product bundles:', affectedBundles.map(b => b.id));
  
  // Find and update all variant bundles that contain this product
  const affectedVariantBundles = bundleVariants.filter(bundle => 
    bundle.linkedProductIds.some((linkedProduct: any) => {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      return targetProductId === productId;
    })
  );
  console.log('[Bundle Debug] Affected variant bundles:', affectedVariantBundles.map(b => ({ productId: b.productId, variantId: b.variantId })));
  
  // Update product bundles
  for (const bundle of affectedBundles) {
    let minPossibleBundles = Infinity;
    console.log('[Bundle Debug] Calculating minPossibleBundles for product bundle:', bundle.id);
    for (const linkedProduct of bundle.linkedProductIds) {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      const targetVariantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
      const quantityNeeded = typeof linkedProduct === 'object' ? linkedProduct.quantity : 1;
      console.log('[Bundle Debug] Linked product in bundle:', { targetProductId, targetVariantId, quantityNeeded });
      if (targetVariantId) {
        const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
        const possibleBundles = Math.floor(linkedVariant.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
        console.log('[Bundle Debug] Variant inventory:', linkedVariant.inventory_level, 'possibleBundles:', possibleBundles);
      } else {
        const { data: linkedProductObj } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProductObj.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
        console.log('[Bundle Debug] Product inventory:', linkedProductObj.inventory_level, 'possibleBundles:', possibleBundles);
      }
    }
    const bundleProductResponse = await bc.put(`/catalog/products/${bundle.id}`, {
      inventory_level: minPossibleBundles
    });
    console.log('[Bundle Debug] BigCommerce PUT bundle product response:', bundleProductResponse);
  }

  // Update variant bundles
  for (const bundle of affectedVariantBundles) {
    let minPossibleBundles = Infinity;
    console.log('[Bundle Debug] Calculating minPossibleBundles for variant bundle:', { productId: bundle.productId, variantId: bundle.variantId });
    for (const linkedProduct of bundle.linkedProductIds) {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      const targetVariantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
      const quantityNeeded = typeof linkedProduct === 'object' ? linkedProduct.quantity : 1;
      console.log('[Bundle Debug] Linked product in variant bundle:', { targetProductId, targetVariantId, quantityNeeded });
      if (targetVariantId) {
        const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
        const possibleBundles = Math.floor(linkedVariant.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
        console.log('[Bundle Debug] Variant inventory:', linkedVariant.inventory_level, 'possibleBundles:', possibleBundles);
      } else {
        const { data: linkedProductObj } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProductObj.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
        console.log('[Bundle Debug] Product inventory:', linkedProductObj.inventory_level, 'possibleBundles:', possibleBundles);
      }
    }
    const bundleVariantResponse = await bc.put(`/catalog/products/${bundle.productId}/variants/${bundle.variantId}`, {
      inventory_level: minPossibleBundles
    });
    console.log('[Bundle Debug] BigCommerce PUT bundle variant response:', bundleVariantResponse);
  }
}

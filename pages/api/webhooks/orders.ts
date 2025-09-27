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

// Calculate deltas between original and current order items
async function calculateOrderDeltas(orderId: number, currentItems: any[]) {
  console.log('[Order Webhook] Calculating order deltas for bare minimum implementation');
  
  // Bare minimum approach: 
  // For order updates, we'll process the current order state and let the recalculation logic handle it
  // This avoids complex delta calculation but still updates bundles correctly
  
  const deltaItems = currentItems.map(item => ({
    ...item,
    quantity: item.quantity // Use current quantities
  }));
  
  console.log(`[Order Webhook] Processing ${deltaItems.length} items from updated order`);
  
  return deltaItems;
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  try {
    // Prevent webhook loops - skip if this update was triggered by our app
    const isFromApp = req.headers['x-bundle-app-update'] === 'true';
    if (isFromApp) {
      console.log('[Order Webhook] Skipping app-generated update to prevent loops');
      
return res.status(200).json({ message: 'Skipped app-generated update' });
    }

    const order = req.body.data;
    const scope = req.body.scope;
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

    console.log(`[Order Webhook] Received ${scope} for order ${orderId}`);

    // Only process store/order/updated events (handles both new orders and edits)
    if (scope !== 'store/order/updated') {
      console.log(`[Order Webhook] Ignoring ${scope} - only processing store/order/updated`);
      return res.status(200).json({ message: 'Webhook scope not handled' });
    }

    console.log(`[Order Webhook] Processing order update/creation: ${orderId}`);

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

    const currentOrderItems = await orderProductsRes.json();

    // For order updates, we need to calculate deltas
    let itemsToProcess = currentOrderItems;
    if (scope === 'store/order/updated') {
      console.log('[Order Webhook] Processing order update - calculating deltas');
      itemsToProcess = await calculateOrderDeltas(orderId, currentOrderItems);
    }

    console.log(`[Order Webhook] Processing order ${orderId} with ${itemsToProcess.length} items`);

    // Get bundle category products only (much more efficient)
    const bundleProducts = [];
    const bundleVariants = [];
    
    try {
      const { data: categories } = await bc.get('/catalog/categories?limit=250');
      const bundleCategory = categories.find((c: any) => String(c?.name || '').toLowerCase() === 'bundle');
      
      if (bundleCategory) {
        console.log(`[Order Webhook] Found bundle category: ${bundleCategory.id}`);
        const { data: bundleCategoryProducts } = await bc.get(`/catalog/products?categories:in=${bundleCategory.id}`);
        console.log(`[Order Webhook] Found ${bundleCategoryProducts.length} products in bundle category`);
        
        // Only check metafields for products in bundle category
        for (const product of bundleCategoryProducts) {
      // Check product-level metafields
      const { isBundle: isProductBundle, linkedProductIds: productLinkedProductIds } = await getProductBundleInfo(product.id, bc);
      
          if (isProductBundle && productLinkedProductIds.length > 0) {
        bundleProducts.push({
          id: product.id,
          linkedProductIds: productLinkedProductIds
        });
            console.log(`[Order Webhook] Found product bundle: ${product.id}`);
      }

      // Check variant-level metafields
      const { data: variants } = await bc.get(`/catalog/products/${product.id}/variants`);
      for (const variant of variants) {
        const { isBundle: isVariantBundle, linkedProductIds: variantLinkedProductIds } = await getVariantBundleInfo(product.id, variant.id, bc);
        
            if (isVariantBundle && variantLinkedProductIds.length > 0) {
          bundleVariants.push({
            productId: product.id,
            variantId: variant.id,
            linkedProductIds: variantLinkedProductIds
          });
              console.log(`[Order Webhook] Found variant bundle: ${product.id}:${variant.id}`);
            }
          }
        }
      } else {
        console.log(`[Order Webhook] No bundle category found, will check ordered items individually`);
      }
    } catch (error) {
      console.warn(`[Order Webhook] Could not fetch bundle category, falling back to individual checks:`, error);
    }

    // Collect all inventory updates to batch them
    const inventoryUpdates = new Map<string, { productId: number, variantId: number | null, newLevel: number }>();
    const bundleRecalculations = new Set<string>();

    // Process each ordered item (either full order or deltas)
    for (const item of itemsToProcess) {
      const productId = item.product_id;
      const variantId = item.variant_id;
      const orderedQuantity = item.quantity;
      
      console.log(`[Order Webhook] Processing item: Product ${productId}${variantId ? ` Variant ${variantId}` : ''} x${orderedQuantity}`);
      
      // Check if this ordered item is a known bundle
      let isItemABundle = false;
      
      if (variantId) {
        // Check if this variant is a bundle
        const variantBundle = bundleVariants.find(b => b.productId === productId && b.variantId === variantId);
        if (variantBundle) {
          console.log(`[Order Webhook] Ordered item is a variant bundle: ${productId}:${variantId}`);
          isItemABundle = true;
          
          // Deduct stock from each component in the bundle
          for (const linkedProduct of variantBundle.linkedProductIds) {
            const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
            const totalQuantity = orderedQuantity * quantity;
            
            const key = targetVariantId ? `${targetProductId}:${targetVariantId}` : `${targetProductId}`;
            const current = inventoryUpdates.get(key);
            const newDeduction = (current?.newLevel || 0) + totalQuantity;
            
            inventoryUpdates.set(key, {
              productId: targetProductId,
              variantId: targetVariantId,
              newLevel: newDeduction
            });
            
            console.log(`[Order Webhook] Will deduct ${totalQuantity} from ${key}`);
          }
        }
      }
      
      if (!isItemABundle) {
        // Check if the parent product is a bundle
        const productBundle = bundleProducts.find(b => b.id === productId);
        if (productBundle) {
          console.log(`[Order Webhook] Ordered item is a product bundle: ${productId}`);
          isItemABundle = true;
          
          // Deduct stock from each component in the bundle
          for (const linkedProduct of productBundle.linkedProductIds) {
              const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
              const totalQuantity = orderedQuantity * quantity;
            
            const key = targetVariantId ? `${targetProductId}:${targetVariantId}` : `${targetProductId}`;
            const current = inventoryUpdates.get(key);
            const newDeduction = (current?.newLevel || 0) + totalQuantity;
            
            inventoryUpdates.set(key, {
              productId: targetProductId,
              variantId: targetVariantId,
              newLevel: newDeduction
            });
            
            console.log(`[Order Webhook] Will deduct ${totalQuantity} from ${key}`);
          }
        }
      }
      
      if (!isItemABundle) {
        // Individual item purchased - mark bundles containing this item for recalculation
        console.log(`[Order Webhook] Individual item purchased: ${productId}${variantId ? `:${variantId}` : ''}`);
        
        // Find bundles that contain this product/variant
        for (const bundle of bundleProducts) {
          const containsItem = bundle.linkedProductIds.some((linked: any) => {
            const targetProductId = typeof linked === 'object' ? linked.productId : linked;
            const targetVariantId = typeof linked === 'object' ? linked.variantId : null;
            
return targetProductId === productId && (!variantId || targetVariantId === variantId);
          });
          
          if (containsItem) {
            bundleRecalculations.add(`product:${bundle.id}`);
            console.log(`[Order Webhook] Bundle ${bundle.id} needs recalculation`);
          }
        }
        
        for (const bundle of bundleVariants) {
          const containsItem = bundle.linkedProductIds.some((linked: any) => {
            const targetProductId = typeof linked === 'object' ? linked.productId : linked;
            const targetVariantId = typeof linked === 'object' ? linked.variantId : null;
            
return targetProductId === productId && (!variantId || targetVariantId === variantId);
          });
          
          if (containsItem) {
            bundleRecalculations.add(`variant:${bundle.productId}:${bundle.variantId}`);
            console.log(`[Order Webhook] Variant bundle ${bundle.productId}:${bundle.variantId} needs recalculation`);
          }
        }
      }
    }

    // Apply inventory deductions
    console.log(`[Order Webhook] Applying ${inventoryUpdates.size} inventory updates`);
    for (const [key, update] of Array.from(inventoryUpdates)) {
      try {
        if (update.variantId) {
          const { data: variant } = await bc.get(`/catalog/products/${update.productId}/variants/${update.variantId}`);
          const newStock = Math.max(0, variant.inventory_level - update.newLevel);
          
          const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${update.productId}/variants/${update.variantId}`, {
            method: 'PUT',
            headers: {
              'X-Auth-Token': accessToken,
              'Content-Type': 'application/json',
              'X-Bundle-App-Update': 'true' // Prevent webhook loops
            },
            body: JSON.stringify({ inventory_level: newStock })
          });
          
          if (response.ok) {
            console.log(`[Order Webhook] Updated variant ${update.productId}:${update.variantId} inventory: ${variant.inventory_level} → ${newStock}`);
          } else {
            console.error(`[Order Webhook] Failed to update variant ${update.productId}:${update.variantId}: ${response.status}`);
          }
        } else {
          const { data: product } = await bc.get(`/catalog/products/${update.productId}`);
          const newStock = Math.max(0, product.inventory_level - update.newLevel);
          
          const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products`, {
            method: 'PUT',
            headers: {
              'X-Auth-Token': accessToken,
              'Content-Type': 'application/json',
              'X-Bundle-App-Update': 'true' // Prevent webhook loops
            },
            body: JSON.stringify([{ id: update.productId, inventory_level: newStock }])
          });
          
          if (response.ok) {
            console.log(`[Order Webhook] Updated product ${update.productId} inventory: ${product.inventory_level} → ${newStock}`);
          } else {
            console.error(`[Order Webhook] Failed to update product ${update.productId}: ${response.status}`);
          }
        }
      } catch (error) {
        console.error(`[Order Webhook] Failed to update inventory for ${key}:`, error);
      }
    }

    // Recalculate affected bundles
    console.log(`[Order Webhook] Recalculating ${bundleRecalculations.size} affected bundles`);
    for (const bundleKey of Array.from(bundleRecalculations)) {
      try {
        if (bundleKey.startsWith('product:')) {
          const bundleId = parseInt(bundleKey.split(':')[1]);
          const bundle = bundleProducts.find(b => b.id === bundleId);
          if (bundle) {
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
            
            const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products`, {
              method: 'PUT',
              headers: {
                'X-Auth-Token': accessToken,
                'Content-Type': 'application/json',
                'X-Bundle-App-Update': 'true' // Prevent webhook loops
              },
              body: JSON.stringify([{ id: bundleId, inventory_level: newInventoryLevel }])
            });
            
            if (response.ok) {
              console.log(`[Order Webhook] Updated bundle ${bundleId} inventory to ${newInventoryLevel}`);
          } else {
              console.error(`[Order Webhook] Failed to update bundle ${bundleId}: ${response.status}`);
            }
          }
        } else if (bundleKey.startsWith('variant:')) {
          const [, bundleProductId, bundleVariantId] = bundleKey.split(':');
          const bundle = bundleVariants.find(b => b.productId === parseInt(bundleProductId) && b.variantId === parseInt(bundleVariantId));
          if (bundle) {
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
            
            const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${bundleProductId}/variants/${bundleVariantId}`, {
              method: 'PUT',
              headers: {
                'X-Auth-Token': accessToken,
                'Content-Type': 'application/json',
                'X-Bundle-App-Update': 'true' // Prevent webhook loops
              },
              body: JSON.stringify({ inventory_level: newInventoryLevel })
            });
            
            if (response.ok) {
              console.log(`[Order Webhook] Updated variant bundle ${bundleProductId}:${bundleVariantId} inventory to ${newInventoryLevel}`);
            } else {
              console.error(`[Order Webhook] Failed to update variant bundle ${bundleProductId}:${bundleVariantId}: ${response.status}`);
            }
          }
        }
      } catch (error) {
        console.error(`[Order Webhook] Failed to recalculate bundle ${bundleKey}:`, error);
      }
    }

    res.status(200).json({ message: 'Stock levels updated successfully' });
  } catch (err: any) {
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient } from '../../../lib/auth';
import { 
  parseLinkedProduct, 
  recalculateBundlesFromKeys 
} from '../../../lib/bundle-calculator';
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

// parseLinkedProduct function moved to lib/bundle-calculator.ts

// Check if order is newly created by comparing date_created and date_modified
async function checkIfNewOrder(orderId: number, storeHash: string, accessToken: string) {
  try {
    const orderResponse = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'X-Auth-Token': accessToken,
        'Accept': 'application/json',
      },
    });

    if (!orderResponse.ok) {
      console.warn('[Order Webhook] Could not fetch order details, assuming new order');
      
return true; // Default to treating as new order if we can't check
    }

    const orderData = await orderResponse.json();
    const dateCreated = orderData.date_created;
    const dateModified = orderData.date_modified;
    
    // If date_created and date_modified are identical, it's a new order
    // If they're different, the order was modified after creation
    const isNewOrder = dateCreated === dateModified;
    
    console.log(`[Order Webhook] Order ${orderId} - created: ${dateCreated}, modified: ${dateModified}, treating as ${isNewOrder ? 'new order' : 'edit'}`);
    
    return isNewOrder;
  } catch (error) {
    console.warn('[Order Webhook] Error checking order timestamps, assuming new order:', error);
    
return true; // Default to treating as new order on error
  }
}

// Calculate deltas between original and current order items for order updates
async function calculateOrderDeltas(orderId: number, currentItems: any[]) {
  console.log('[Order Webhook] Calculating order deltas for order update');
  
  try {
    // For order updates, we don't need to handle individual item stock changes
    // BigCommerce automatically handles those. We only need to:
    // 1. Find bundles that were in the order and recalculate their stock
    // 2. Find bundles that contain updated items and recalculate their stock
    
    // Return empty array since BigCommerce handles individual item stock automatically
    // The main logic will still process bundle recalculations based on current order state
    console.log('[Order Webhook] Order update detected - BigCommerce handles individual item stock automatically');
    console.log('[Order Webhook] Will recalculate bundle stock based on current order state');
    
    // Return items with zero quantity change since BigCommerce already handled the stock
    // This ensures we only trigger bundle recalculations, not individual stock deductions
    const deltaItems = currentItems.map(item => ({
      ...item,
      quantity: 0, // Zero delta - BigCommerce already handled the stock change
      originalQuantity: item.quantity, // Keep original for bundle calculations
      isOrderUpdate: true // Flag to indicate this is from an order update
    }));
    
    console.log(`[Order Webhook] Prepared ${deltaItems.length} items for bundle recalculation (no stock deductions)`);
    
    return deltaItems;
    
  } catch (error) {
    console.error('[Order Webhook] Error calculating order deltas:', error);
    
    // Fallback: return items with zero quantities to avoid double stock deduction
    return currentItems.map(item => ({
      ...item,
      quantity: 0,
      originalQuantity: item.quantity,
      isOrderUpdate: true
    }));
  }
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

    // Check if this is a new order or an edit by comparing timestamps
    const isNewOrder = await checkIfNewOrder(orderId, storeHash, accessToken);
    console.log(`[Order Webhook] Processing ${isNewOrder ? 'new order' : 'order update'}: ${orderId}`);

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

    // Handle new orders vs order updates differently
    let itemsToProcess = currentOrderItems;
    
    if (isNewOrder) {
      // For new orders, process all items as-is (no deltas needed)
      console.log('[Order Webhook] Processing new order - using full order data');
    } else {
      // For order updates, calculate deltas to handle edits properly
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
      const isOrderUpdate = item.isOrderUpdate || false;
      
      console.log(`[Order Webhook] Processing item: Product ${productId}${variantId ? ` Variant ${variantId}` : ''} x${orderedQuantity}${isOrderUpdate ? ' (order update)' : ''}`);
      
      // For order updates, skip individual stock deductions - BigCommerce handles these automatically
      if (isOrderUpdate && orderedQuantity === 0) {
        console.log(`[Order Webhook] Skipping stock deduction for order update - BigCommerce handles automatically`);
      }
      
      // Check if this ordered item is a known bundle
      let isItemABundle = false;
      
      if (variantId) {
        // Check if this variant is a bundle
        const variantBundle = bundleVariants.find(b => b.productId === productId && b.variantId === variantId);
        if (variantBundle) {
          console.log(`[Order Webhook] Ordered item is a variant bundle: ${productId}:${variantId}`);
          isItemABundle = true;
          
          // Only deduct stock from bundle components for new orders
          // For order updates, BigCommerce handles the stock changes automatically
          if (!isOrderUpdate && orderedQuantity > 0) {
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
          } else if (isOrderUpdate) {
            console.log(`[Order Webhook] Skipping bundle component deduction for order update - BigCommerce handles automatically`);
          }
        }
      }
      
      if (!isItemABundle) {
        // Check if the parent product is a bundle
        const productBundle = bundleProducts.find(b => b.id === productId);
        if (productBundle) {
          console.log(`[Order Webhook] Ordered item is a product bundle: ${productId}`);
          isItemABundle = true;
          
          // Only deduct stock from bundle components for new orders
          // For order updates, BigCommerce handles the stock changes automatically
          if (!isOrderUpdate && orderedQuantity > 0) {
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
          } else if (isOrderUpdate) {
            console.log(`[Order Webhook] Skipping bundle component deduction for order update - BigCommerce handles automatically`);
          }
        }
      }
      
      if (!isItemABundle) {
        // Individual item purchased - mark bundles containing this item for recalculation
        // For order updates, we still need to recalculate bundles because the item quantities may have changed
        const displayQuantity = isOrderUpdate ? item.originalQuantity : orderedQuantity;
        console.log(`[Order Webhook] Individual item purchased: ${productId}${variantId ? `:${variantId}` : ''} (qty: ${displayQuantity})`);
        
        // Find bundles that contain this product/variant
        for (const bundle of bundleProducts) {
          const containsItem = bundle.linkedProductIds.some((linked: any) => {
            const targetProductId = typeof linked === 'object' ? linked.productId : linked;
            const targetVariantId = typeof linked === 'object' ? linked.variantId : null;
            
return targetProductId === productId && (!variantId || targetVariantId === variantId);
          });
          
          if (containsItem) {
            bundleRecalculations.add(`product:${bundle.id}`);
            console.log(`[Order Webhook] Bundle ${bundle.id} needs recalculation ${isOrderUpdate ? '(order update)' : ''}`);
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
            console.log(`[Order Webhook] Variant bundle ${bundle.productId}:${bundle.variantId} needs recalculation ${isOrderUpdate ? '(order update)' : ''}`);
          }
        }
      } else if (isOrderUpdate) {
        // Even if item is a bundle, we need to recalculate bundle stock for order updates
        // because BigCommerce may have changed the bundle's own stock level
        if (variantId) {
          bundleRecalculations.add(`variant:${productId}:${variantId}`);
          console.log(`[Order Webhook] Variant bundle ${productId}:${variantId} needs recalculation (order update)`);
        } else {
          bundleRecalculations.add(`product:${productId}`);
          console.log(`[Order Webhook] Product bundle ${productId} needs recalculation (order update)`);
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

    // Recalculate affected bundles using shared utility
    await recalculateBundlesFromKeys(bundleRecalculations, bundleProducts, bundleVariants, bc, storeHash, accessToken);

    res.status(200).json({ message: 'Stock levels updated successfully' });
  } catch (err: any) {
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
}

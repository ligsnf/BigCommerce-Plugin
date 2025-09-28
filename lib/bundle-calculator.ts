// bigcommerceClient import removed - not needed in this utility file

// Utility to parse linked product info (moved from webhooks)
export function parseLinkedProduct(linkedProduct: any) {
  return {
    productId: typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct,
    variantId: typeof linkedProduct === 'object' ? linkedProduct.variantId : null,
    quantity: typeof linkedProduct === 'object' ? linkedProduct.quantity : 1,
  };
}

// Core bundle inventory calculation logic
export async function calculateBundleInventory(
  bundle: { linkedProductIds: any[] },
  bc: any
): Promise<number> {
  let minPossibleBundles = Infinity;
  
  for (const linkedProduct of bundle.linkedProductIds) {
    const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
    
    try {
      if (targetVariantId) {
        const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
        const possibleBundles = Math.floor(linkedVariant.inventory_level / quantity);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      } else {
        const { data: linkedProductObj } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProductObj.inventory_level / quantity);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      }
    } catch (error) {
      console.error(`[Bundle Calculator] Error fetching inventory for ${targetProductId}${targetVariantId ? `:${targetVariantId}` : ''}:`, error);
      // If we can't fetch inventory for a component, assume 0 possible bundles
      minPossibleBundles = 0;
      break;
    }
  }
  
  return Math.max(0, minPossibleBundles);
}

// Update a single product bundle's inventory
export async function updateProductBundleInventory(
  bundleId: number,
  newInventoryLevel: number,
  storeHash: string,
  accessToken: string
): Promise<boolean> {
  try {
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
      console.log(`[Bundle Calculator] Updated product bundle ${bundleId} inventory to ${newInventoryLevel}`);
      
return true;
    } else {
      const errorText = await response.text();
      console.error(`[Bundle Calculator] Failed to update product bundle ${bundleId}: ${response.status} - ${errorText}`);
      
return false;
    }
  } catch (error) {
    console.error(`[Bundle Calculator] Error updating product bundle ${bundleId}:`, error);
    
return false;
  }
}

// Update a single variant bundle's inventory
export async function updateVariantBundleInventory(
  productId: number,
  variantId: number,
  newInventoryLevel: number,
  storeHash: string,
  accessToken: string
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${productId}/variants/${variantId}`, {
      method: 'PUT',
      headers: {
        'X-Auth-Token': accessToken,
        'Content-Type': 'application/json',
        'X-Bundle-App-Update': 'true' // Prevent webhook loops
      },
      body: JSON.stringify({ inventory_level: newInventoryLevel })
    });
    
    if (response.ok) {
      console.log(`[Bundle Calculator] Updated variant bundle ${productId}:${variantId} inventory to ${newInventoryLevel}`);
      
return true;
    } else {
      const errorText = await response.text();
      console.error(`[Bundle Calculator] Failed to update variant bundle ${productId}:${variantId}: ${response.status} - ${errorText}`);
      
return false;
    }
  } catch (error) {
    console.error(`[Bundle Calculator] Error updating variant bundle ${productId}:${variantId}:`, error);
    
return false;
  }
}

// Bulk update product bundles (more efficient for multiple updates)
export async function bulkUpdateProductBundles(
  bundleUpdates: Array<{ id: number; inventory_level: number }>,
  storeHash: string,
  accessToken: string
): Promise<boolean> {
  if (bundleUpdates.length === 0) return true;
  
  try {
    console.log(`[Bundle Calculator] Bulk updating ${bundleUpdates.length} product bundles`);
    
    const response = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products`, {
      method: 'PUT',
      headers: {
        'X-Auth-Token': accessToken,
        'Content-Type': 'application/json',
        'X-Bundle-App-Update': 'true' // Prevent webhook loops
      },
      body: JSON.stringify(bundleUpdates)
    });
    
    if (response.ok) {
      console.log(`[Bundle Calculator] Successfully bulk updated ${bundleUpdates.length} product bundles`);
      
return true;
    } else {
      const errorText = await response.text();
      console.error(`[Bundle Calculator] Failed to bulk update product bundles: ${response.status} - ${errorText}`);
      
return false;
    }
  } catch (error) {
    console.error(`[Bundle Calculator] Error bulk updating product bundles:`, error);
    
return false;
  }
}

// Recalculate and update multiple product bundles
export async function recalculateProductBundles(
  bundles: Array<{ id: number; linkedProductIds: any[] }>,
  bc: any,
  storeHash: string,
  accessToken: string
): Promise<void> {
  if (bundles.length === 0) return;
  
  console.log(`[Bundle Calculator] Recalculating ${bundles.length} product bundles`);
  
  const bundleUpdates = [];
  
  for (const bundle of bundles) {
    try {
      const newInventoryLevel = await calculateBundleInventory(bundle, bc);
      bundleUpdates.push({
        id: bundle.id,
        inventory_level: newInventoryLevel
      });
      console.log(`[Bundle Calculator] Calculated product bundle ${bundle.id} inventory: ${newInventoryLevel}`);
    } catch (error) {
      console.error(`[Bundle Calculator] Failed to calculate product bundle ${bundle.id}:`, error);
    }
  }
  
  // Bulk update all bundles
  await bulkUpdateProductBundles(bundleUpdates, storeHash, accessToken);
}

// Recalculate and update multiple variant bundles
export async function recalculateVariantBundles(
  bundles: Array<{ productId: number; variantId: number; linkedProductIds: any[] }>,
  bc: any,
  storeHash: string,
  accessToken: string
): Promise<void> {
  if (bundles.length === 0) return;
  
  console.log(`[Bundle Calculator] Recalculating ${bundles.length} variant bundles`);
  
  // Group variant updates by product for potential optimization
  const variantUpdatesByProduct: Record<string, Array<{id: number, inventory_level: number}>> = {};
  
  for (const bundle of bundles) {
    try {
      const newInventoryLevel = await calculateBundleInventory(bundle, bc);
      
      if (!variantUpdatesByProduct[bundle.productId]) {
        variantUpdatesByProduct[bundle.productId] = [];
      }
      variantUpdatesByProduct[bundle.productId].push({
        id: bundle.variantId,
        inventory_level: newInventoryLevel
      });
      
      console.log(`[Bundle Calculator] Calculated variant bundle ${bundle.productId}:${bundle.variantId} inventory: ${newInventoryLevel}`);
    } catch (error) {
      console.error(`[Bundle Calculator] Failed to calculate variant bundle ${bundle.productId}:${bundle.variantId}:`, error);
    }
  }
  
  // Update variant bundles (individual calls required for variants)
  for (const [productId, variantUpdates] of Object.entries(variantUpdatesByProduct)) {
    console.log(`[Bundle Calculator] Updating ${variantUpdates.length} variants for product ${productId}`);
    
    for (const variantUpdate of variantUpdates) {
      await updateVariantBundleInventory(
        parseInt(productId),
        variantUpdate.id,
        variantUpdate.inventory_level,
        storeHash,
        accessToken
      );
    }
  }
}

// Convenience function to recalculate bundles from bundle keys (used in orders webhook)
export async function recalculateBundlesFromKeys(
  bundleKeys: Set<string>,
  bundleProducts: Array<{ id: number; linkedProductIds: any[] }>,
  bundleVariants: Array<{ productId: number; variantId: number; linkedProductIds: any[] }>,
  bc: any,
  storeHash: string,
  accessToken: string
): Promise<void> {
  console.log(`[Bundle Calculator] Recalculating ${bundleKeys.size} affected bundles`);
  
  const productBundlesToRecalculate = [];
  const variantBundlesToRecalculate = [];
  
  for (const bundleKey of Array.from(bundleKeys)) {
    if (bundleKey.startsWith('product:')) {
      const bundleId = parseInt(bundleKey.split(':')[1]);
      const bundle = bundleProducts.find(b => b.id === bundleId);
      if (bundle) {
        productBundlesToRecalculate.push(bundle);
      }
    } else if (bundleKey.startsWith('variant:')) {
      const [, bundleProductId, bundleVariantId] = bundleKey.split(':');
      const bundle = bundleVariants.find(b => 
        b.productId === parseInt(bundleProductId) && 
        b.variantId === parseInt(bundleVariantId)
      );
      if (bundle) {
        variantBundlesToRecalculate.push(bundle);
      }
    }
  }
  
  // Recalculate product and variant bundles
  await recalculateProductBundles(productBundlesToRecalculate, bc, storeHash, accessToken);
  await recalculateVariantBundles(variantBundlesToRecalculate, bc, storeHash, accessToken);
}

/* eslint-disable no-console */
import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient } from '../../../lib/auth';
import db from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  try {
    console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

    const order = req.body.data;
    const storeHash = req.body.store_id; // BigCommerce sends store_id in webhook payload

    if (!order || !storeHash) {
      console.error('❌ Missing order or storeHash in webhook payload');

      return res.status(400).json({ message: 'Missing required information' });
    }

    // Get the access token for this store from the database
    const accessToken = await db.getStoreToken(storeHash);

    if (!accessToken) {
      console.error(`❌ No access token found for store ${storeHash}`);

      return res.status(401).json({ message: 'Store not authorized' });
    }

    const bc = bigcommerceClient(accessToken, storeHash);
    const orderId = order.id;

    console.log(`📦 Fetching products for order ID ${orderId} via V2...`);

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
    const bundleProducts = [];
    const bundleVariants = [];
    
    // Find all bundles and their details
    for (const product of allProducts) {
      // Check product-level metafields
      const { data: productMetafields } = await bc.get(`/catalog/products/${product.id}/metafields`);
      const isProductBundle = productMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';
      
      if (isProductBundle) {
        const linkedField = productMetafields.find(f => f.key === 'linked_product_ids' && f.namespace === 'bundle');
        const productQuantitiesField = productMetafields.find(f => f.key === 'product_quantities' && f.namespace === 'bundle');
        
        if (linkedField && productQuantitiesField) {
          bundleProducts.push({
            id: product.id,
            linkedProductIds: JSON.parse(linkedField.value),
            productQuantities: JSON.parse(productQuantitiesField.value)
          });
        }
      }

      // Check variant-level metafields
      const { data: variants } = await bc.get(`/catalog/products/${product.id}/variants`);
      for (const variant of variants) {
        const { data: variantMetafields } = await bc.get(`/catalog/products/${product.id}/variants/${variant.id}/metafields`);
        const isVariantBundle = variantMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';
        
        if (isVariantBundle) {
          const linkedField = variantMetafields.find(f => f.key === 'linked_product_ids' && f.namespace === 'bundle');
          const productQuantitiesField = variantMetafields.find(f => f.key === 'product_quantities' && f.namespace === 'bundle');
          
          if (linkedField && productQuantitiesField) {
            bundleVariants.push({
              productId: product.id,
              variantId: variant.id,
              linkedProductIds: JSON.parse(linkedField.value),
              productQuantities: JSON.parse(productQuantitiesField.value)
            });
          }
        }
      }
    }

    // Process each ordered item
    for (const item of orderDetails) {
      const productId = item.product_id;
      const variantId = item.variant_id;
      const orderedQuantity = item.quantity;

      console.log(`🔍 Processing ordered product ${productId}${variantId ? ` variant ${variantId}` : ''}...`);
      
      // Check if the ordered item is a variant bundle
      if (variantId) {
        const { data: variantMetafields } = await bc.get(`/catalog/products/${productId}/variants/${variantId}/metafields`);
        const isVariantBundle = variantMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';

        if (isVariantBundle) {
          console.log(`📦 Variant ${variantId} is a bundle`);
          const linkedField = variantMetafields.find(f => f.key === 'linked_product_ids' && f.namespace === 'bundle');
          const productQuantitiesField = variantMetafields.find(f => f.key === 'product_quantities' && f.namespace === 'bundle');
          
          if (linkedField && productQuantitiesField) {
            const linkedProductIds = JSON.parse(linkedField.value);
            const productQuantities = JSON.parse(productQuantitiesField.value);
            
            // Update stock for each product in the bundle
            for (const linkedId of linkedProductIds) {
              const quantity = productQuantities[linkedId] || 1;
              const totalQuantity = orderedQuantity * quantity;
              
              const { data: linkedProduct } = await bc.get(`/catalog/products/${linkedId}`);
              const newStock = Math.max(0, linkedProduct.inventory_level - totalQuantity);
              
              console.log(`📉 Reducing stock for bundled product ${linkedId}: ${linkedProduct.inventory_level} → ${newStock}`);
              await bc.put(`/catalog/products/${linkedId}`, {
                inventory_level: newStock
              });
            }
          }
        }
      } else {
        // Check if the ordered item is a product bundle
        const { data: itemMetafields } = await bc.get(`/catalog/products/${productId}/metafields`);
        const isProductBundle = itemMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';

        if (isProductBundle) {
          console.log(`📦 Product ${productId} is a bundle`);
          const linkedField = itemMetafields.find(f => f.key === 'linked_product_ids' && f.namespace === 'bundle');
          const productQuantitiesField = itemMetafields.find(f => f.key === 'product_quantities' && f.namespace === 'bundle');
          
          if (linkedField && productQuantitiesField) {
            const linkedProductIds = JSON.parse(linkedField.value);
            const productQuantities = JSON.parse(productQuantitiesField.value);
            
            // Update stock for each product in the bundle
            for (const linkedId of linkedProductIds) {
              const quantity = productQuantities[linkedId] || 1;
              const totalQuantity = orderedQuantity * quantity;
              
              const { data: linkedProduct } = await bc.get(`/catalog/products/${linkedId}`);
              const newStock = Math.max(0, linkedProduct.inventory_level - totalQuantity);
              
              console.log(`📉 Reducing stock for bundled product ${linkedId}: ${linkedProduct.inventory_level} → ${newStock}`);
              await bc.put(`/catalog/products/${linkedId}`, {
                inventory_level: newStock
              });
            }
          }
        } else {
          // Handle individual product purchase - update affected bundles
          console.log(`📦 Product ${productId} is an individual item`);
          
          // Find and update all product bundles that contain this product
          const affectedBundles = bundleProducts.filter(bundle => 
            bundle.linkedProductIds.includes(productId)
          );
          
          // Find and update all variant bundles that contain this product
          const affectedVariantBundles = bundleVariants.filter(bundle => 
            bundle.linkedProductIds.includes(productId)
          );
          
          console.log(`🔍 Found ${affectedBundles.length} product bundles and ${affectedVariantBundles.length} variant bundles containing product ${productId}`);
          
          // Update product bundles
          for (const bundle of affectedBundles) {
            let minPossibleBundles = Infinity;
            
            for (const linkedId of bundle.linkedProductIds) {
              const { data: linkedProduct } = await bc.get(`/catalog/products/${linkedId}`);
              const quantityNeeded = bundle.productQuantities[linkedId] || 1;
              const possibleBundles = Math.floor(linkedProduct.inventory_level / quantityNeeded);
              minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
            }
            
            console.log(`📊 Updating product bundle ${bundle.id} stock to ${minPossibleBundles}`);
            await bc.put(`/catalog/products/${bundle.id}`, {
              inventory_level: minPossibleBundles
            });
          }

          // Update variant bundles
          for (const bundle of affectedVariantBundles) {
            let minPossibleBundles = Infinity;
            
            for (const linkedId of bundle.linkedProductIds) {
              const { data: linkedProduct } = await bc.get(`/catalog/products/${linkedId}`);
              const quantityNeeded = bundle.productQuantities[linkedId] || 1;
              const possibleBundles = Math.floor(linkedProduct.inventory_level / quantityNeeded);
              minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
            }
            
            console.log(`📊 Updating variant bundle ${bundle.variantId} stock to ${minPossibleBundles}`);
            await bc.put(`/catalog/products/${bundle.productId}/variants/${bundle.variantId}`, {
              inventory_level: minPossibleBundles
            });
          }
        }
      }
    }

    console.log('✅ Inventory updates completed.');
    res.status(200).json({ message: 'Stock levels updated successfully' });
  } catch (err: any) {
    console.error('[Webhook] ❌ Error processing order:', err.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}

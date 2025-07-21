import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient } from '../../../lib/auth';
import db from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

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
        
        if (linkedField) {
          const linkedProductIds = JSON.parse(linkedField.value);
          
          bundleProducts.push({
            id: product.id,
            linkedProductIds: linkedProductIds
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
          
          if (linkedField) {
            const linkedProductIds = JSON.parse(linkedField.value);
            
            bundleVariants.push({
              productId: product.id,
              variantId: variant.id,
              linkedProductIds: linkedProductIds
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
      
      // Check if the ordered item is a variant bundle
      if (variantId) {
        const { data: variantMetafields } = await bc.get(`/catalog/products/${productId}/variants/${variantId}/metafields`);
        
        const isVariantBundle = variantMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';

        if (isVariantBundle) {
          const linkedField = variantMetafields.find(f => f.key === 'linked_product_ids' && f.namespace === 'bundle');
          
          if (linkedField) {
            const linkedProductIds = JSON.parse(linkedField.value);
            
            // Update stock for each product in the bundle
            for (const linkedProduct of linkedProductIds) {
              // Handle both old format (just ID) and new format (object with productId, variantId, quantity)
              const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
              const targetVariantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
              const quantity = typeof linkedProduct === 'object' ? linkedProduct.quantity : 1;
              
              const totalQuantity = orderedQuantity * quantity;
              
              if (targetVariantId) {
                // Update variant stock
                const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
                const newStock = Math.max(0, linkedVariant.inventory_level - totalQuantity);
                
                const response = await bc.put(`/catalog/products/${targetProductId}/variants/${targetVariantId}`, {
                  inventory_level: newStock
                });
                console.log('BigCommerce PUT variant response:', response);
              } else {
                // Update product stock
                const { data: linkedProduct } = await bc.get(`/catalog/products/${targetProductId}`);
                const newStock = Math.max(0, linkedProduct.inventory_level - totalQuantity);
                
                const response = await bc.put(`/catalog/products/${targetProductId}`, {
                  inventory_level: newStock
                });
                console.log('BigCommerce PUT product response:', response);
              }
            }
          }
        } else {
          // Handle individual variant purchase - update affected bundles
          await updateAffectedBundles(productId, orderedQuantity, bundleProducts, bundleVariants, bc);
        }
      } else {
        // Check if the ordered item is a product bundle
        const { data: itemMetafields } = await bc.get(`/catalog/products/${productId}/metafields`);
        
        const isProductBundle = itemMetafields.find(f => f.key === 'is_bundle' && f.namespace === 'bundle')?.value === 'true';

        if (isProductBundle) {
          const linkedField = itemMetafields.find(f => f.key === 'linked_product_ids' && f.namespace === 'bundle');
          
          if (linkedField) {
            const linkedProductIds = JSON.parse(linkedField.value);
            console.log('Processing bundle purchase:', { productId, orderedQuantity, linkedProductIds });
            // Update stock for each product in the bundle
            for (const linkedProduct of linkedProductIds) {
              // Handle both old format (just ID) and new format (object with productId, variantId, quantity)
              const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
              const targetVariantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
              const quantity = typeof linkedProduct === 'object' ? linkedProduct.quantity : 1;
              
              const totalQuantity = orderedQuantity * quantity;
              console.log('Updating stock for linked product:', { targetProductId, targetVariantId, quantity, orderedQuantity, totalQuantity });
              
              if (targetVariantId) {
                // Update variant stock
                const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
                const newStock = Math.max(0, linkedVariant.inventory_level - totalQuantity);
                
                const response = await bc.put(`/catalog/products/${targetProductId}/variants/${targetVariantId}`, {
                  inventory_level: newStock
                });
                console.log('BigCommerce PUT variant response:', response);
              } else {
                // Update product stock
                const { data: linkedProduct } = await bc.get(`/catalog/products/${targetProductId}`);
                const newStock = Math.max(0, linkedProduct.inventory_level - totalQuantity);
                
                const response = await bc.put(`/catalog/products/${targetProductId}`, {
                  inventory_level: newStock
                });
                console.log('BigCommerce PUT product response:', response);
              }
            }
          }
        } else {
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
  // Find and update all product bundles that contain this product
  const affectedBundles = bundleProducts.filter(bundle => 
    bundle.linkedProductIds.some((linkedProduct: any) => {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;

      return targetProductId === productId;
    })
  );
  
  // Find and update all variant bundles that contain this product
  const affectedVariantBundles = bundleVariants.filter(bundle => 
    bundle.linkedProductIds.some((linkedProduct: any) => {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      
      return targetProductId === productId;
    })
  );
  
  // Update product bundles
  for (const bundle of affectedBundles) {
    let minPossibleBundles = Infinity;
    
    for (const linkedProduct of bundle.linkedProductIds) {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      const targetVariantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
      const quantityNeeded = typeof linkedProduct === 'object' ? linkedProduct.quantity : 1;
      
      if (targetVariantId) {
        const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
        const possibleBundles = Math.floor(linkedVariant.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      } else {
        const { data: linkedProduct } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProduct.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      }
    }
    
    const bundleProductResponse = await bc.put(`/catalog/products/${bundle.id}`, {
      inventory_level: minPossibleBundles
    });
    console.log('BigCommerce PUT bundle product response:', bundleProductResponse);
  }

  // Update variant bundles
  for (const bundle of affectedVariantBundles) {
    let minPossibleBundles = Infinity;
    
    for (const linkedProduct of bundle.linkedProductIds) {
      const targetProductId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
      const targetVariantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
      const quantityNeeded = typeof linkedProduct === 'object' ? linkedProduct.quantity : 1;
      
      if (targetVariantId) {
        const { data: linkedVariant } = await bc.get(`/catalog/products/${targetProductId}/variants/${targetVariantId}`);
        const possibleBundles = Math.floor(linkedVariant.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      } else {
        const { data: linkedProduct } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProduct.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      }
    }
    
    const bundleVariantResponse = await bc.put(`/catalog/products/${bundle.productId}/variants/${bundle.variantId}`, {
      inventory_level: minPossibleBundles
    });
    console.log('BigCommerce PUT bundle variant response:', bundleVariantResponse);
  }
}

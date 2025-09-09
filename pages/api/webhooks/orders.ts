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

    // Process each ordered item
    for (const item of orderDetails) {
      const productId = item.product_id;
      const variantId = item.variant_id;
      const orderedQuantity = item.quantity;
      
      // Check if the ordered item is a variant bundle
      if (variantId) {
        const { isBundle: isVariantBundle, linkedProductIds: variantLinkedProductIds } = await getVariantBundleInfo(productId, variantId, bc);

        if (isVariantBundle) {
          if (variantLinkedProductIds) {
            // Update stock for each product in the bundle
            for (const linkedProduct of variantLinkedProductIds) {
              const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
              const totalQuantity = orderedQuantity * quantity;
              await updateInventory(targetProductId, targetVariantId, totalQuantity, bc);
            }
          }
        } else {
          // If the variant is not a bundle, check if the parent product is a bundle
          const { isBundle: isProductBundle, linkedProductIds: productLinkedProductIds } = await getProductBundleInfo(productId, bc);

          if (isProductBundle && productLinkedProductIds) {
            // Update stock for each product in the parent product bundle
            for (const linkedProduct of productLinkedProductIds) {
              const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
              const totalQuantity = orderedQuantity * quantity;
              await updateInventory(targetProductId, targetVariantId, totalQuantity, bc);
            }
          } else {
            // Handle individual variant purchase - update affected bundles
            await updateAffectedBundles(productId, orderedQuantity, bundleProducts, bundleVariants, bc);
          }
        }
      } else {
        // Check if the ordered item is a product bundle
        const { isBundle: isProductBundle, linkedProductIds: productLinkedProductIds } = await getProductBundleInfo(productId, bc);
        
        if (isProductBundle) {
          if (productLinkedProductIds) {
            // Update stock for each product in the bundle
            for (const linkedProduct of productLinkedProductIds) {
              const { productId: targetProductId, variantId: targetVariantId, quantity } = parseLinkedProduct(linkedProduct);
              const totalQuantity = orderedQuantity * quantity;
              await updateInventory(targetProductId, targetVariantId, totalQuantity, bc);
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
        const { data: linkedProductObj } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProductObj.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      }
    }
    const bundleProductResponse = await bc.put(`/catalog/products/${bundle.id}`, {
      inventory_level: minPossibleBundles
    });
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
        const { data: linkedProductObj } = await bc.get(`/catalog/products/${targetProductId}`);
        const possibleBundles = Math.floor(linkedProductObj.inventory_level / quantityNeeded);
        minPossibleBundles = Math.min(minPossibleBundles, possibleBundles);
      }
    }
    const bundleVariantResponse = await bc.put(`/catalog/products/${bundle.productId}/variants/${bundle.variantId}`, {
      inventory_level: minPossibleBundles
    });
  }
}
// TODO: Add a function to update inventory when a product is deleted from bigcommerce

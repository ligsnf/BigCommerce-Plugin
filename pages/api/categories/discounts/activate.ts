import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../../lib/auth';

const NAMESPACE = 'discounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    
return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { accessToken, storeHash } = await getSession(req);
    const bc = bigcommerceClient(accessToken, storeHash);

    const { categoryIds = [] } = req.body || {};
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({ message: 'categoryIds is required' });
    }

    // For each category, apply the discount to products
    for (const categoryId of categoryIds as number[]) {
      // Get all discount metafields for this category
      const { data: mfs } = await bc.get(`/catalog/categories/${categoryId}/metafields`);
      const discountMetafields = (mfs || []).filter((m: any) => m.namespace === NAMESPACE);
      
      // Find the specific discount to activate (we'll need to pass the metafield ID)
      // For now, let's activate the first inactive discount we find
      let discountToActivate = null;
      for (const mf of discountMetafields) {
        try {
          const discountData = JSON.parse(mf.value);
          if (discountData.status === 'Inactive') {
            discountToActivate = { metafield: mf, data: discountData };
            break;
          }
        } catch (error) {
          console.error('Error parsing discount data:', error);
        }
      }
      
      if (discountToActivate) {
        const { metafield, data: discountData } = discountToActivate;
        
        // First, deactivate any existing active discounts in ALL categories that this discount affects
        const allCategoryIds = discountData.categoryIds || [categoryId];
        for (const catId of allCategoryIds) {
          const { data: catMfs } = await bc.get(`/catalog/categories/${catId}/metafields`);
          const catDiscountMetafields = (catMfs || []).filter((m: any) => m.namespace === NAMESPACE);
          
          for (const mf of catDiscountMetafields) {
            try {
              const existingRule = JSON.parse(mf.value);
              if (existingRule.status === 'Active') {
                // Deactivate the existing active discount
                const deactivatedRule = { ...existingRule, status: 'Inactive' };
                await bc.put(`/catalog/categories/${catId}/metafields/${mf.id}`, {
                  namespace: NAMESPACE,
                  key: mf.key,
                  value: JSON.stringify(deactivatedRule),
                  permission_set: 'app_only',
                });
                
                // Remove the discount from products
                await removeDiscountFromCategory(bc, catId);
                console.log(`Deactivated existing active discount "${existingRule.name}" in category ${catId}`);
              }
            } catch (error) {
              console.error('Error processing existing discount:', error);
            }
          }
        }
        
        // Check if the discount has passed its end time
        const now = new Date();
        const hasExpired = discountData.endDateTime && new Date(discountData.endDateTime) <= now;
        
        // Update the metafield status to 'Active' and clear end time if expired
        const updatedData = {
          ...discountData,
          status: 'Active',
          // Clear end time if the discount has expired (user is manually reactivating)
          endDateTime: hasExpired ? null : discountData.endDateTime
        };
        
        // Update the discount in ALL categories it affects
        for (const catId of allCategoryIds) {
          const { data: catMfs } = await bc.get(`/catalog/categories/${catId}/metafields`);
          const catDiscountMetafields = (catMfs || []).filter((m: any) => m.namespace === NAMESPACE);
          
          for (const mf of catDiscountMetafields) {
            if (mf.key === metafield.key) {
              await bc.put(`/catalog/categories/${catId}/metafields/${mf.id}`, {
                namespace: NAMESPACE,
                key: mf.key,
                value: JSON.stringify(updatedData),
                permission_set: 'app_only',
              });
              
              // Apply discount to products in this category using updated data
              await applyDiscountToCategory(bc, catId, updatedData);
            }
          }
        }
      }
    }

    return res.status(200).json({ ok: true, activatedCategories: categoryIds });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.message || 'Internal server error';
    
    return res.status(status).json({ message });
  }
}

async function applyDiscountToCategory(bc: any, categoryId: number, discountData: any) {
  let page = 1;
  const limit = 250;
  let totalPages = 1;

  do {
    const { data: products, meta } = await bc.get(`/catalog/products?categories:in=${categoryId}&limit=${limit}&page=${page}`);
    totalPages = meta?.pagination?.total_pages || 1;

    for (const product of products || []) {
      // Calculate sale price based on discount
      const originalPrice = product.price || 0;
      let salePrice = originalPrice;

      if (discountData.type === 'percent') {
        salePrice = originalPrice * (1 - discountData.amount / 100);
      } else if (discountData.type === 'fixed') {
        salePrice = Math.max(0, originalPrice - discountData.amount);
      }

      // Update product sale price
      const productUpdate: any = {
        sale_price: salePrice,
        sale_price_start_date: new Date().toISOString(),
      };
      
      // Only set end date if it exists
      if (discountData.endDateTime) {
        productUpdate.sale_price_end_date = discountData.endDateTime;
      }
      
      await bc.put(`/catalog/products/${product.id}`, productUpdate);

      // Update variants sale price
      let vPage = 1;
      let vTotalPages = 1;
      const vLimit = 250;
      do {
        const { data: variants, meta: vMeta } = await bc.get(`/catalog/products/${product.id}/variants?limit=${vLimit}&page=${vPage}`);
        vTotalPages = vMeta?.pagination?.total_pages || 1;

        for (const variant of variants || []) {
          const variantOriginalPrice = variant.price || originalPrice;
          let variantSalePrice = variantOriginalPrice;

          if (discountData.type === 'percent') {
            variantSalePrice = variantOriginalPrice * (1 - discountData.amount / 100);
          } else if (discountData.type === 'fixed') {
            variantSalePrice = Math.max(0, variantOriginalPrice - discountData.amount);
          }

          const variantUpdate: any = {
            sale_price: variantSalePrice,
            sale_price_start_date: new Date().toISOString(),
          };
          
          // Only set end date if it exists
          if (discountData.endDateTime) {
            variantUpdate.sale_price_end_date = discountData.endDateTime;
          }
          
          await bc.put(`/catalog/products/${product.id}/variants/${variant.id}`, variantUpdate);
        }

        vPage += 1;
      } while (vPage <= vTotalPages);
    }

    page += 1;
  } while (page <= totalPages);
}

async function removeDiscountFromCategory(bc: any, categoryId: number) {
  console.log(`Removing discount from category ${categoryId}`);
  
  // For each category, fetch products and remove their sale_price (and variant sale_price)
  let page = 1;
  const limit = 250;
  let totalPages = 1;
  let productsProcessed = 0;

  do {
    const { data: products, meta } = await bc.get(`/catalog/products?categories:in=${categoryId}&limit=${limit}&page=${page}`);
    totalPages = meta?.pagination?.total_pages || 1;

    for (const p of products || []) {
      console.log(`Removing sale price from product ${p.id} (${p.name})`);
      
      // Remove product sale price
      await bc.put(`/catalog/products/${p.id}`, { 
        sale_price: 0,
        sale_price_start_date: '',
        sale_price_end_date: ''
      });

      // Remove variants' sale prices as well
      let vPage = 1;
      let vTotalPages = 1;
      const vLimit = 250;
      do {
        const { data: variants, meta: vMeta } = await bc.get(`/catalog/products/${p.id}/variants?limit=${vLimit}&page=${vPage}`);
        vTotalPages = vMeta?.pagination?.total_pages || 1;

        for (const v of variants || []) {
          console.log(`Removing sale price from variant ${v.id}`);
          await bc.put(`/catalog/products/${p.id}/variants/${v.id}`, { 
            sale_price: 0,
            sale_price_start_date: '',
            sale_price_end_date: ''
          });
        }

        vPage += 1;
      } while (vPage <= vTotalPages);
      
      productsProcessed++;
    }

    page += 1;
  } while (page <= totalPages);
  
  console.log(`Processed ${productsProcessed} products in category ${categoryId}`);
}

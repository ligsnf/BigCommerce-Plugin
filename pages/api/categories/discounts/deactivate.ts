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

    const { categoryIds = [], discountId } = req.body || {};
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({ message: 'categoryIds is required' });
    }

    if (!discountId) {
      return res.status(400).json({ message: 'discountId is required' });
    }

    let deactivatedCount = 0;

    // For each category, deactivate the specific discount
    for (const categoryId of categoryIds as number[]) {
      try {
        const { data: mfs } = await bc.get(`/catalog/categories/${categoryId}/metafields`);
        const discountMetafields = (mfs || []).filter((m: any) => m.namespace === NAMESPACE);
        
        // Find the specific discount to deactivate by its key
        const discountMetafield = discountMetafields.find((mf: any) => mf.key === discountId);
        
        if (discountMetafield) {
          try {
            const currentData = JSON.parse(discountMetafield.value);
            if (currentData.status === 'Active') {
              // Remove sale prices from products in this category
              await removeDiscountFromCategory(bc, categoryId);
              
              // Update discount metafield status to 'Inactive'
              const updatedData = {
                ...currentData,
                status: 'Inactive'
              };
              
              await bc.put(`/catalog/categories/${categoryId}/metafields/${discountMetafield.id}`, {
                namespace: NAMESPACE,
                key: discountMetafield.key,
                value: JSON.stringify(updatedData),
                permission_set: 'app_only',
              });
              
              console.log(`Deactivated discount "${currentData.name}" in category ${categoryId}`);
              deactivatedCount++;
            }
          } catch (error) {
            console.error('Error processing discount data:', error);
          }
        }
      } catch (error) {
        console.error(`Error deactivating discount in category ${categoryId}:`, error);
        // Continue with other categories even if one fails
      }
    }

    return res.status(200).json({ ok: true, deactivatedCategories: deactivatedCount });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.message || 'Internal server error';
    
    return res.status(status).json({ message });
  }
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



import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../../lib/auth';

const NAMESPACE = 'discounts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { accessToken, storeHash } = await getSession(req);
    const bc = bigcommerceClient(accessToken, storeHash);

    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }

    const { categoryIds = [], discountId } = req.body || {};

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({ message: 'Missing categoryIds' });
    }

    if (!discountId) {
      return res.status(400).json({ message: 'Missing discountId' });
    }

    let deletedCount = 0;

    // Remove the discount metafield from each category
    for (const categoryId of categoryIds) {
      try {
        const { data: metafields } = await bc.get(`/catalog/categories/${categoryId}/metafields`);
        const discountMetafields = (metafields || []).filter((mf: any) => mf.namespace === NAMESPACE);
        
        // Find the specific discount to delete by its key
        const discountMetafield = discountMetafields.find((mf: any) => mf.key === discountId);
        
        if (discountMetafield) {
          // First remove sale prices from products in this category if the discount was active
          try {
            const discountData = JSON.parse(discountMetafield.value);
            if (discountData.status === 'Active') {
              await removeDiscountFromCategory(bc, categoryId);
            }
          } catch (error) {
            console.error('Error parsing discount data:', error);
          }
          
          // Then delete the metafield
          await bc.delete(`/catalog/categories/${categoryId}/metafields/${discountMetafield.id}`);
          console.log(`Deleted discount metafield from category ${categoryId}`);
          deletedCount++;
        }
      } catch (error) {
        console.error(`Error deleting metafield from category ${categoryId}:`, error);
        // Continue with other categories even if one fails
      }
    }

    return res.status(200).json({ 
      message: 'Discount deleted successfully',
      deletedFromCategories: deletedCount
    });

  } catch (error: any) {
    console.error('Error deleting discount:', error);
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

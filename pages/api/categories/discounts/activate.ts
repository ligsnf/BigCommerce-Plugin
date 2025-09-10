import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../../lib/auth';

const NAMESPACE = 'discounts';
const KEY = 'rule';

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
      // Get the discount metafield for this category
      const { data: mfs } = await bc.get(`/catalog/categories/${categoryId}/metafields`);
      const existing = (mfs || []).find((m: any) => m.namespace === NAMESPACE && m.key === KEY);
      
      if (existing) {
        const discountData = JSON.parse(existing.value);
        
        // Update the metafield status to 'Active'
        const updatedData = {
          ...discountData,
          status: 'Active'
        };
        
        await bc.put(`/catalog/categories/${categoryId}/metafields/${existing.id}`, {
          value: JSON.stringify(updatedData)
        });

        // Apply discount to products in this category
        await applyDiscountToCategory(bc, categoryId, discountData);
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
      await bc.put(`/catalog/products/${product.id}`, {
        sale_price: salePrice,
        sale_price_start_date: new Date().toISOString(),
        sale_price_end_date: discountData.endDateTime || null,
      });

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

          await bc.put(`/catalog/products/${product.id}/variants/${variant.id}`, {
            sale_price: variantSalePrice,
            sale_price_start_date: new Date().toISOString(),
            sale_price_end_date: discountData.endDateTime || null,
          });
        }

        vPage += 1;
      } while (vPage <= vTotalPages);
    }

    page += 1;
  } while (page <= totalPages);
}

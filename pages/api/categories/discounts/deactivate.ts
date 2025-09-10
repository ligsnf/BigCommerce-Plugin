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

    // For each category, fetch products and reset sale_price (and variant sale_price)
    for (const categoryId of categoryIds as number[]) {
      let page = 1;
      const limit = 250;
      let totalPages = 1;

      do {
        const { data: products, meta } = await bc.get(`/catalog/products?categories:in=${categoryId}&limit=${limit}&page=${page}`);
        totalPages = meta?.pagination?.total_pages || 1;

        for (const p of products || []) {
          // Reset product sale price and clear dates
          await bc.put(`/catalog/products/${p.id}`, {
            sale_price: 0,
            sale_price_start_date: null,
            sale_price_end_date: null,
          });

          // Reset variants sale price and clear dates
          let vPage = 1;
          let vTotalPages = 1;
          const vLimit = 250;
          do {
            const { data: variants, meta: vMeta } = await bc.get(`/catalog/products/${p.id}/variants?limit=${vLimit}&page=${vPage}`);
            vTotalPages = vMeta?.pagination?.total_pages || 1;

            for (const v of variants || []) {
              await bc.put(`/catalog/products/${p.id}/variants/${v.id}`, {
                sale_price: 0,
                sale_price_start_date: null,
                sale_price_end_date: null,
              });
            }

            vPage += 1;
          } while (vPage <= vTotalPages);
        }

        page += 1;
      } while (page <= totalPages);

      // Update discount metafield status to 'Inactive' instead of removing it
      try {
        const { data: mfs } = await bc.get(`/catalog/categories/${categoryId}/metafields`);
        const existing = (mfs || []).find((m: any) => m.namespace === NAMESPACE && m.key === KEY);
        if (existing) {
          const currentData = JSON.parse(existing.value);
          const updatedData = {
            ...currentData,
            status: 'Inactive'
          };
          
          await bc.put(`/catalog/categories/${categoryId}/metafields/${existing.id}`, {
            value: JSON.stringify(updatedData)
          });
        }
      } catch (e) {
        // Best-effort: ignore metafield update errors
      }
    }

    return res.status(200).json({ ok: true, deactivatedCategories: categoryIds });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.message || 'Internal server error';
    
    return res.status(status).json({ message });
  }
}



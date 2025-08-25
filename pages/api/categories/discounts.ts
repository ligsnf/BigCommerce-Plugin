import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../lib/auth';

const NAMESPACE = 'discounts';
const KEY = 'rule';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { accessToken, storeHash } = await getSession(req);
    const bc = bigcommerceClient(accessToken, storeHash);

    if (req.method === 'GET') {
      const { data: cats } = await bc.get('/catalog/categories?limit=250');
      const rows: Array<{ categoryId: number; categoryName: string; rule: any }> = [];

      for (const c of cats) {
        const { data: mfs } = await bc.get(`/catalog/categories/${c.id}/metafields`);
        const mf = (mfs || []).find((m: any) => m.namespace === NAMESPACE && m.key === KEY);
        if (!mf) continue;
        let rule: any = null;
        try {
          rule = typeof mf.value === 'string' ? JSON.parse(mf.value) : mf.value;
        } catch {
          continue;
        }
        rows.push({ categoryId: c.id, categoryName: c.name, rule });
      }

      const grouped: Record<string, any> = {};
      for (const r of rows) {
        const sig = JSON.stringify({
          name: r.rule?.name,
          type: r.rule?.type,
          amount: r.rule?.amount,
          startDate: r.rule?.startDate || null,
          endDate: r.rule?.endDate || null,
          status: r.rule?.status || 'Active',
        });

        if (!grouped[sig]) {
          grouped[sig] = {
            name: r.rule?.name,
            type: r.rule?.type,
            amount: Number(r.rule?.amount || 0),
            startDate: r.rule?.startDate || undefined,
            endDate: r.rule?.endDate || undefined,
            status: r.rule?.status || 'Active',
            categories: [] as string[],
          };
        }
        grouped[sig].categories.push(r.categoryName);
      }

      return res.status(200).json({ data: Object.values(grouped) });
    }

    if (req.method === 'POST') {
      const { name, type, amount, startDate, endDate, status = 'Active', categoryIds = [] } = req.body || {};

      // Validate required fields
      if (!name || !type || !Array.isArray(categoryIds) || categoryIds.length === 0) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      // Enforce discount amount is required and valid
      const parsedAmount: number = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ message: 'Discount amount must be a number greater than 0' });
      }
      if (type !== 'percent' && type !== 'fixed') {
        return res.status(400).json({ message: 'Invalid discount type' });
      }
      if (type === 'percent' && parsedAmount > 100) {
        return res.status(400).json({ message: 'Percent discount cannot exceed 100' });
      }

      const payload = {
        namespace: NAMESPACE,
        key: KEY,
        value: JSON.stringify({ name, type, amount: parsedAmount, startDate, endDate, status }),
        permission_set: 'app_only',
      };

      // Save/Update the metafield rule for each category (keeps UI listing intact)
      for (const id of categoryIds) {
        const { data: mfs } = await bc.get(`/catalog/categories/${id}/metafields`);
        const existing = (mfs || []).find((m: any) => m.namespace === NAMESPACE && m.key === KEY);
        if (existing) {
          await bc.put(`/catalog/categories/${id}/metafields/${existing.id}`, payload);
        } else {
          await bc.post(`/catalog/categories/${id}/metafields`, payload);
        }
      }

      // Helper to round to 2 decimals consistently
      const round2 = (value: number) => Math.round(value * 100) / 100;

      // Compute discounted price from base price
      const computeDiscounted = (base: number, t: 'percent' | 'fixed', a: number) => {
        if (!base || base <= 0) return 0;
        if (t === 'percent') {
          return round2(base * (1 - a / 100));
        }
        return round2(Math.max(0, base - a));
      };

      // Convert yyyy-mm-dd to ISO date range fields (start at 00:00:00Z, end at 23:59:59Z)
      const toStartIso = (d?: string | null) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : undefined);
      const toEndIso = (d?: string | null) => (d ? new Date(`${d}T23:59:59.000Z`).toISOString() : undefined);

      // For each category, fetch products and update their sale_price (and variant sale_price)
      for (const categoryId of categoryIds as number[]) {
        let page = 1;
        const limit = 250;
        let totalPages = 1;

        do {
          const { data: products, meta } = await bc.get(`/catalog/products?categories:in=${categoryId}&limit=${limit}&page=${page}`);
          totalPages = meta?.pagination?.total_pages || 1;

          for (const p of products || []) {
            const productBasePrice = Number(p.price || 0);
            const discountedProductPrice = computeDiscounted(productBasePrice, type, parsedAmount);

            const productUpdate: any = { sale_price: discountedProductPrice };
            const startIso = toStartIso(startDate);
            const endIso = toEndIso(endDate);
            if (startIso) productUpdate.sale_price_start_date = startIso;
            if (endIso) productUpdate.sale_price_end_date = endIso;

            // Update product sale price
            await bc.put(`/catalog/products/${p.id}`, productUpdate);

            // Update variants' sale prices as well (so variant-specific prices reflect the discount)
            let vPage = 1;
            let vTotalPages = 1;
            const vLimit = 250;
            do {
              const { data: variants, meta: vMeta } = await bc.get(`/catalog/products/${p.id}/variants?limit=${vLimit}&page=${vPage}`);
              vTotalPages = vMeta?.pagination?.total_pages || 1;

              for (const v of variants || []) {
                const variantBase = v.price != null ? Number(v.price) : productBasePrice;
                const discountedVariantPrice = computeDiscounted(variantBase, type, parsedAmount);
                const variantUpdate: any = { sale_price: discountedVariantPrice };
                if (startIso) variantUpdate.sale_price_start_date = startIso;
                if (endIso) variantUpdate.sale_price_end_date = endIso;
                await bc.put(`/catalog/products/${p.id}/variants/${v.id}`, variantUpdate);
              }

              vPage += 1;
            } while (vPage <= vTotalPages);
          }

          page += 1;
        } while (page <= totalPages);
      }

      return res.status(201).json({ ok: true, appliedToCategories: categoryIds });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error: any) {
    const status = error?.response?.status || 500;
    const message = error?.message || 'Internal server error';
    return res.status(status).json({ message });
  }
}



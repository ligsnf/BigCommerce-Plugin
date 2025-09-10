import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../../lib/auth';

const NAMESPACE = 'discounts';
const KEY = 'rule';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { accessToken, storeHash } = await getSession(req);
    const bc = bigcommerceClient(accessToken, storeHash);

    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method not allowed' });
    }

    const now = new Date();
    let activatedCount = 0;

    // Get all categories
    const { data: categories } = await bc.get('/catalog/categories?limit=250');

    for (const category of categories) {
      // Get metafields for this category
      const { data: metafields } = await bc.get(`/catalog/categories/${category.id}/metafields`);
      const discountMetafield = (metafields || []).find((mf: any) => mf.namespace === NAMESPACE && mf.key === KEY);
      
      if (!discountMetafield) continue;

      let rule: any = null;
      try {
        rule = typeof discountMetafield.value === 'string' ? JSON.parse(discountMetafield.value) : discountMetafield.value;
      } catch {
        continue;
      }

      // Check if this is a scheduled discount that should be activated
      if (rule.status === 'Scheduled' && rule.scheduledTime) {
        const scheduledTime = new Date(rule.scheduledTime);
        
        if (scheduledTime <= now) {
          // Time to activate this discount
          console.log(`Activating scheduled discount: ${rule.name} for category: ${category.name}`);
          
          // Update the rule status to Active
          const updatedRule = {
            ...rule,
            status: 'Active',
            scheduledTime: null // Clear the scheduled time
          };

          // Update the metafield
          await bc.put(`/catalog/categories/${category.id}/metafields/${discountMetafield.id}`, {
            namespace: NAMESPACE,
            key: KEY,
            value: JSON.stringify(updatedRule),
            permission_set: 'app_only',
          });

          // Apply the discount to products in this category
          await applyDiscountToCategory(bc, category.id, rule);
          
          activatedCount++;
        }
      }

      // Check if this is an active discount that should be deactivated
      if (rule.status === 'Active' && rule.endDateTime) {
        const endTime = new Date(rule.endDateTime);
        
        if (endTime <= now) {
          // Time to deactivate this discount
          console.log(`Deactivating expired discount: ${rule.name} for category: ${category.name}`);
          
          // Update the rule status to Inactive
          const updatedRule = {
            ...rule,
            status: 'Inactive',
            endDateTime: null // Clear the end datetime
          };

          // Update the metafield
          await bc.put(`/catalog/categories/${category.id}/metafields/${discountMetafield.id}`, {
            namespace: NAMESPACE,
            key: KEY,
            value: JSON.stringify(updatedRule),
            permission_set: 'app_only',
          });

          // Remove the discount from products in this category
          await removeDiscountFromCategory(bc, category.id);
          
          activatedCount++; // Using same counter for both activation and deactivation
        }
      }
    }

    return res.status(200).json({ 
      activatedCount,
      message: activatedCount > 0 ? `Activated ${activatedCount} scheduled discounts` : 'No scheduled discounts to activate'
    });

  } catch (error: any) {
    console.error('Error activating scheduled discounts:', error);
    const status = error?.response?.status || 500;
    const message = error?.message || 'Internal server error';
    return res.status(status).json({ message });
  }
}

async function applyDiscountToCategory(bc: any, categoryId: number, rule: any) {
  const { type, amount: parsedAmount } = rule;

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
      const startIso = toStartIso(rule.startDate);
      const endIso = toEndIso(rule.endDate);
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

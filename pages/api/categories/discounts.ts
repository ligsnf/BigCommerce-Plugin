import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../lib/auth';

const NAMESPACE = 'discounts';
// We'll use unique keys for each discount instead of a single 'rule' key

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { accessToken, storeHash } = await getSession(req);
    const bc = bigcommerceClient(accessToken, storeHash);

    if (req.method === 'GET') {
      const { data: cats } = await bc.get('/catalog/categories?limit=250');
      const discountMap = new Map(); // Use Map to group discounts by their unique key

      for (const c of cats) {
        const { data: mfs } = await bc.get(`/catalog/categories/${c.id}/metafields`);
        // Get all discount metafields for this category (multiple discounts allowed)
        const discountMetafields = (mfs || []).filter((m: any) => m.namespace === NAMESPACE);
        
        for (const mf of discountMetafields) {
          let rule: any = null;
          try {
            rule = typeof mf.value === 'string' ? JSON.parse(mf.value) : mf.value;
          } catch {
            continue;
          }
          
          const discountKey = mf.key; // Use the metafield key as the unique identifier
          
          if (!discountMap.has(discountKey)) {
            // Create new discount entry
            discountMap.set(discountKey, {
              id: discountKey, // Use the metafield key as the unique ID
              name: rule?.name,
              type: rule?.type,
              amount: Number(rule?.amount || 0),
              startDate: rule?.startDate || undefined,
              endDate: rule?.endDate || undefined,
              scheduledTime: rule?.scheduledTime || undefined,
              endDateTime: rule?.endDateTime || undefined,
              status: rule?.status || 'Active',
              categories: [],
              categoryIds: rule?.categoryIds || [],
              metafieldIds: [],
              categoryMetafields: []
            });
          }
          
          // Add this category to the discount
          const discount = discountMap.get(discountKey);
          if (!discount.categories.includes(c.name)) {
            discount.categories.push(c.name);
          }
          if (!discount.categoryIds.includes(c.id)) {
            discount.categoryIds.push(c.id);
          }
          discount.metafieldIds.push(mf.id);
          discount.categoryMetafields.push({
            categoryId: c.id,
            categoryName: c.name,
            metafieldId: mf.id
          });
        }
      }

      return res.status(200).json({ data: Array.from(discountMap.values()) });
    }

    if (req.method === 'POST') {
      const { name, type, amount, startDate, endDate, scheduledTime, endDateTime, status = 'Active', categoryIds = [] } = req.body || {};

      // Validate required fields
      if (!name || !type || !Array.isArray(categoryIds) || categoryIds.length === 0) {

        return res.status(400).json({ message: 'Missing required fields' });
      }

      // Validate scheduled time if provided
      if (scheduledTime) {
        const scheduledDate = new Date(scheduledTime);
        const now = new Date();
        if (isNaN(scheduledDate.getTime()) || scheduledDate <= now) {
          return res.status(400).json({ message: 'Scheduled time must be a valid future date' });
        }
      }

      // Validate end datetime if provided
      if (endDateTime) {
        const endDate = new Date(endDateTime);
        const now = new Date();
        if (isNaN(endDate.getTime()) || endDate <= now) {
          return res.status(400).json({ message: 'End datetime must be a valid future date' });
        }
        
        // If scheduled, end datetime must be after scheduled time
        if (scheduledTime) {
          const scheduledDate = new Date(scheduledTime);
          if (endDate <= scheduledDate) {
            return res.status(400).json({ message: 'End datetime must be after the scheduled start time' });
          }
        }
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

      // First, deactivate any existing active discounts in the selected categories
      if (status === 'Active') {
        for (const categoryId of categoryIds) {
          const { data: mfs } = await bc.get(`/catalog/categories/${categoryId}/metafields`);
          const discountMetafields = (mfs || []).filter((m: any) => m.namespace === NAMESPACE);
          
          for (const mf of discountMetafields) {
            try {
              const existingRule = JSON.parse(mf.value);
              if (existingRule.status === 'Active') {
                // Deactivate the existing active discount
                const deactivatedRule = { ...existingRule, status: 'Inactive' };
                await bc.put(`/catalog/categories/${categoryId}/metafields/${mf.id}`, {
                  namespace: NAMESPACE,
                  key: mf.key,
                  value: JSON.stringify(deactivatedRule),
                  permission_set: 'app_only',
                });
                
                // Remove the discount from products
                await removeDiscountFromCategory(bc, categoryId);
                console.log(`Deactivated existing active discount "${existingRule.name}" in category ${categoryId}`);
              }
            } catch (error) {
              console.error('Error processing existing discount:', error);
            }
          }
        }
      }
      
      // Create a single discount record that references all categories
      const uniqueKey = `discount_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const discountData = { 
        name, 
        type, 
        amount: parsedAmount, 
        startDate, 
        endDate, 
        scheduledTime, 
        endDateTime, 
        status,
        categoryIds // Store the list of category IDs in the discount data
      };
      
      // Store the discount in each category with the same key and data
      for (const categoryId of categoryIds) {
        const payload = {
          namespace: NAMESPACE,
          key: uniqueKey,
          value: JSON.stringify(discountData),
          permission_set: 'app_only',
        };
        
        await bc.post(`/catalog/categories/${categoryId}/metafields`, payload);
      }

      // If this is a scheduled discount, don't apply price changes yet
      if (scheduledTime) {
        return res.status(201).json({ 
          ok: true, 
          appliedToCategories: categoryIds,
          message: 'Discount scheduled successfully. It will be activated at the specified time.'
        });
      }

      // Helper to round to 2 decimals consistently
      const round2 = (value: number) => Math.round(value * 100) / 100;

      // Compute discounted price from base price
      const computeDiscounted = (base: number, t: 'percent' | 'fixed', a: number) => {
        if (!base || base <= 0) 
          
          return 0;
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



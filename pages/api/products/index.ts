import { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../lib/auth';

export default async function products(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { accessToken, storeHash } = await getSession(req);
    const bigcommerce = bigcommerceClient(accessToken, storeHash);

    // Get query parameters
    const { bundleStatus } = req.query;
    
    // Build the API query
    let query = '/catalog/products?limit=250&include=variants';
    
    // Add SKU filter based on bundle status
    if (bundleStatus === 'bundles') {
      query += '&sku:in=BUN-*';
    } else if (bundleStatus === 'non-bundles') {
      query += '&sku:not_in=BUN-*';
    }

    // Get products with the appropriate filter
    const { data: products } = await bigcommerce.get(query);

    // Fetch variants for each product
    const productsWithVariants = await Promise.all(
      products.map(async (p) => {
        try {
          // Use the v3 API endpoint for variants
          const { data: variants } = await bigcommerce.get(`/catalog/products/${p.id}/variants?limit=250`);
          
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            variants: variants || [],
            type: p.type,
            inventory_level: p.inventory_level,
            is_bundle: p.sku?.startsWith('BUN-') || false
          };
        } catch (error) {
          console.error(`Error fetching variants for product ${p.id}:`, error);
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            variants: [],
            type: p.type,
            inventory_level: p.inventory_level,
            is_bundle: p.sku?.startsWith('BUN-') || false
          };
        }
      })
    );

    res.status(200).json(productsWithVariants);
  } catch (error: any) {
    console.error('[API] Failed to fetch products:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ message: error.message });
  }
}

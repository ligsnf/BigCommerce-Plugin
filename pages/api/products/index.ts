import { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../lib/auth';

export default async function products(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { accessToken, storeHash } = await getSession(req);
    const bigcommerce = bigcommerceClient(accessToken, storeHash);

    // Get all products
    const { data: products } = await bigcommerce.get('/catalog/products?limit=250');

    console.log('Raw API response:', JSON.stringify(products[0], null, 2));

    const excludeBundles = req.query.excludeBundles === 'true';

    const filtered = excludeBundles
      ? products.filter(p => !p.custom_fields?.some(f => f.name === 'is_bundle' && f.value === 'true'))
      : products;

    // Fetch variants for each product
    const productsWithVariants = await Promise.all(
      filtered.map(async (p) => {
        try {
          // Use the v3 API endpoint for variants
          const { data: variants } = await bigcommerce.get(`/catalog/products/${p.id}/variants?limit=250`);
          console.log(`Variants for product ${p.id}:`, variants);
          
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            variants: variants || [],
            type: p.type,
            inventory_level: p.inventory_level
          };
        } catch (error) {
          console.error(`Error fetching variants for product ${p.id}:`, error);
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            variants: [],
            type: p.type,
            inventory_level: p.inventory_level
          };
        }
      })
    );

    console.log('First product with variants:', JSON.stringify(productsWithVariants[0], null, 2));

    res.status(200).json(productsWithVariants);
  } catch (error: any) {
    console.error('[API] Failed to fetch products:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ message: error.message });
  }
}

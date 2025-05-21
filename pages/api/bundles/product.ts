import mysql from 'mysql2/promise';
import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../lib/auth';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    // Create a bundle product
    try {
      const { accessToken, storeHash } = await getSession(req);
      const bigcommerce = bigcommerceClient(accessToken, storeHash);
      const { name, price, description, type, isVisible, components } = req.body;
      
      // 1. Create the product in BigCommerce
      const { data: product } = await bigcommerce.post('/catalog/products', {
        name,
        price,
        description,
        type,
        is_visible: isVisible
      });
      
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        
        // 2. Mark it as a bundle in our database
        await conn.query(
          'UPDATE products SET is_bundle = ? WHERE sku = ?',
          [true, product.sku]
        );
        
        // 3. Add the component products
        if (components && components.length > 0) {
          for (const component of components) {
            // Get product IDs
            const [bundleRows] = await conn.query(
              'SELECT id FROM products WHERE sku = ?',
              [product.sku]
            );
            
            const [componentRows] = await conn.query(
              'SELECT id FROM products WHERE sku = ?',
              [component.sku]
            );
            
            if ((bundleRows as any).length === 0 || (componentRows as any).length === 0) {
              throw new Error('Product not found');
            }
            
            const bundleId = (bundleRows as any)[0].id;
            const componentId = (componentRows as any)[0].id;
            
            // Add to bundle_products table
            await conn.query(
              'INSERT INTO bundle_products (bundle_id, product_id, quantity) VALUES (?, ?, ?)',
              [bundleId, componentId, component.quantity || 1]
            );
          }
        }
        
        await conn.commit();
        res.status(200).json({ product, message: 'Bundle created successfully' });
      } catch (error) {
        await conn.rollback();
        console.error('Error creating bundle:', error);
        res.status(500).json({ message: 'Error creating bundle', error: error.message });
      } finally {
        conn.release();
      }
    } catch (error) {
      console.error('BigCommerce API error:', error);
      res.status(500).json({ message: 'Error creating product in BigCommerce', error: error.message });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

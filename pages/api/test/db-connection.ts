import type { NextApiRequest, NextApiResponse } from 'next';
import database from '../../../lib/database.js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { sql } = database;

    // Test basic query
    const result = await sql`SELECT 1 as test_value`;

    // Ensure result is an array
    if (!Array.isArray(result)) {
      console.error('❌ Database query result is not an array:', typeof result, result);

      return res.status(500).json({
        message: 'Database connection issue: result is not an array',
        resultType: typeof result,
        result: result
      });
    }

    // Test table existence
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `;

    if (!Array.isArray(tables)) {
      console.error('❌ Tables query result is not an array:', typeof tables, tables);

      return res.status(500).json({
        message: 'Database tables query issue: result is not an array',
        resultType: typeof tables,
        result: tables
      });
    }

    return res.status(200).json({
      message: 'Database connection successful',
      testQuery: result,
      tables: tables.map(t => t.table_name),
      environment: process.env.POSTGRES_URL?.includes('neon') ? 'neon' : 'local'
    });

  } catch (error) {
    console.error('❌ Database connection test failed:', error);

    return res.status(500).json({
      message: 'Database connection failed',
      error: error.message
    });
  }
}

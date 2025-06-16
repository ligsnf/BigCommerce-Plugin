/* eslint-disable no-console */
import { neon } from '@neondatabase/serverless';
import { Pool } from 'pg';
import 'dotenv/config';

// Database connection setup
const POSTGRES_URL = process.env.POSTGRES_URL;
if (!POSTGRES_URL) {
    throw new Error('POSTGRES_URL environment variable is not set');
}

// Detect if we're using Neon (contains neon) or local PostgreSQL
const isNeon = POSTGRES_URL.includes('neon');

let sql;
let pool = null;

if (isNeon) {
    // Use Neon serverless driver for production
    const neonSql = neon(POSTGRES_URL);

    // Wrap Neon to ensure consistent return format
    sql = async (strings, ...values) => {
        const result = await neonSql(strings, ...values);

        // Ensure we always return an array
        return Array.isArray(result) ? result : [];
    };
    console.log('[DB] Using Neon serverless driver');
} else {
    // Use traditional pg driver for local development
    pool = new Pool({
        connectionString: POSTGRES_URL,
    });

    // Create a sql function that mimics Neon's interface
    sql = async (strings, ...values) => {
        const client = await pool.connect();
        try {
            // Handle both template literal syntax and regular query strings
            if (typeof strings === 'string') {
                // Regular query string with parameters
                const result = await client.query(strings, values);

                return result.rows;
            } else {
                // Template literal syntax
                let query = strings[0];
                for (let i = 0; i < values.length; i++) {
                    query += '$' + (i + 1) + strings[i + 1];
                }
                const result = await client.query(query, values);

                return result.rows;
            }
        } finally {
            client.release();
        }
    };
    console.log('[DB] Using traditional PostgreSQL driver for local development');
}

// Export the sql function for use in scripts
export default { sql };

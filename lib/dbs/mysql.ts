import mysql, { PoolOptions } from 'mysql2';
import { promisify } from 'util';
import { SessionProps, StoreData } from '../../types';

const MYSQL_CONFIG: PoolOptions = {
    host: process.env.MYSQL_HOST,
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USERNAME,
    password: process.env.MYSQL_PASSWORD,
    ...(process.env.MYSQL_PORT && { port: Number(process.env.MYSQL_PORT) }),
};

const dbUrl = process.env.DATABASE_URL;
const pool = dbUrl ? mysql.createPool(dbUrl) : mysql.createPool(MYSQL_CONFIG);
const query = promisify(pool.query.bind(pool));

export { query };

// ----------- Existing Methods ------------
export async function setUser({ user }: SessionProps) {
    if (!user) return null;
    const { email, id, username } = user;
    const userData = { email, userId: id, username };
    await query('REPLACE INTO users SET ?', userData);
}

export async function setStore(session: SessionProps) {
    const { access_token: accessToken, context, scope } = session;
    if (!accessToken || !scope) return null;
    const storeHash = context?.split('/')[1] || '';
    const storeData: StoreData = { accessToken, scope, storeHash };
    await query('REPLACE INTO stores SET ?', storeData);
}

export async function setStoreUser(session: SessionProps) {
    const { access_token: accessToken, context, owner, sub, user: { id: userId } } = session;
    if (!userId) return null;
    const contextString = context ?? sub;
    const storeHash = contextString?.split('/')[1] || '';
    const sql = 'SELECT * FROM storeUsers WHERE userId = ? AND storeHash = ?';
    const values = [String(userId), storeHash];
    const storeUser = await query(sql, values);

    if (accessToken) {
        if (!storeUser.length) {
            await query('INSERT INTO storeUsers SET ?', { isAdmin: true, storeHash, userId });
        } else if (!storeUser[0]?.isAdmin) {
            await query('UPDATE storeUsers SET isAdmin=1 WHERE userId = ? AND storeHash = ?', values);
        }
    } else {
        if (!storeUser.length) {
            await query('INSERT INTO storeUsers SET ?', { isAdmin: owner.id === userId, storeHash, userId });
        }
    }
}

export async function deleteUser({ context, user, sub }: SessionProps) {
    const contextString = context ?? sub;
    const storeHash = contextString?.split('/')[1] || '';
    const values = [String(user?.id), storeHash];
    await query('DELETE FROM storeUsers WHERE userId = ? AND storeHash = ?', values);
}

export async function hasStoreUser(storeHash: string, userId: string) {
    if (!storeHash || !userId) return false;
    const values = [userId, storeHash];
    const results = await query('SELECT * FROM storeUsers WHERE userId = ? AND storeHash = ? LIMIT 1', values);
    return results.length > 0;
}

export async function getStoreToken(storeHash: string) {
    if (!storeHash) return null;
    const results = await query('SELECT accessToken FROM stores WHERE storeHash = ?', storeHash);
    return results.length ? results[0].accessToken : null;
}

export async function deleteStore({ store_hash: storeHash }: SessionProps) {
    await query('DELETE FROM stores WHERE storeHash = ?', storeHash);
}

export async function hasAppExtensionsScope(storeHash: string): Promise<boolean> {
    const scopes = await query('SELECT scope FROM stores WHERE storeHash = ?', storeHash);
    const row = scopes[0];
    return row?.scope?.includes('store_app_extensions_manage') ?? false;
}

// ----------- New Methods for Bundles ------------

export async function saveBundle(productId: number, isBundle: boolean) {
    return query(`
        INSERT INTO bundles (product_id, is_bundle)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE is_bundle = VALUES(is_bundle)
    `, [productId, isBundle]);
}

export async function updateBundleLinks(productId: number, linkedProductIds: number[]) {
    await query(`DELETE FROM bundle_links WHERE bundle_id = ?`, [productId]);

    if (linkedProductIds.length > 0) {
        const values = linkedProductIds.map(id => [productId, id]);
        await query(`INSERT INTO bundle_links (bundle_id, product_id) VALUES ?`, [values]);
    }
}

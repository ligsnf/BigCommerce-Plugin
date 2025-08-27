import type { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '@lib/auth';

type CleanupResult = {
  productId: number;
  product: { updatedToShared: boolean; deletedDuplicates: number };
  variants: Array<{ variantId: number; updatedToShared: boolean; deletedDuplicates: number }>;
  errors: string[];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {

    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const session = await getSession(req);
    if (!session) {

      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { accessToken, storeHash } = session;
    const bc = bigcommerceClient(accessToken, storeHash);

    const { productId } = req.body || {};

    const processOne = async (pid: number): Promise<CleanupResult> => {
      const result: CleanupResult = {
        productId: pid,
        product: { updatedToShared: false, deletedDuplicates: 0 },
        variants: [],
        errors: [],
      };

      // Helper: consolidate metafields for a given entity
      const consolidate = async (
        fields: any[],
        listKeys: string[],
        putUrl: (key: string, id?: number) => string,
        deleteUrl: (id: number) => string
      ): Promise<{ updatedToShared: boolean; deletedDuplicates: number; errors: string[] }> => {
        const errors: string[] = [];
        let updatedToShared = false;
        let deletedDuplicates = 0;

        const byKey: Record<string, any[]> = {};
        for (const f of fields.filter((f: any) => f.namespace === 'bundle' && listKeys.includes(f.key))) {
          byKey[f.key] = byKey[f.key] || [];
          byKey[f.key].push(f);
        }

        for (const key of listKeys) {
          const items = byKey[key] || [];
          if (items.length === 0) continue;

          // Prefer read_and_write as canonical; else first
          const canonical = items.find(f => f.permission_set === 'read_and_write') || items[0];

          // Ensure canonical is read_and_write
          if (canonical.permission_set !== 'read_and_write') {
            try {
              await fetch(putUrl(key, canonical.id), {
                method: 'PUT',
                headers: {
                  'X-Auth-Token': accessToken,
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                },
                body: JSON.stringify({
                  key,
                  value: canonical.value,
                  namespace: 'bundle',
                  permission_set: 'read_and_write',
                }),
              });
              updatedToShared = true;
            } catch (e: any) {
              errors.push(`Failed to update ${key} to shared: ${e?.message || e}`);
            }
          }

          // Delete duplicates (all except canonical)
          for (const dup of items.filter(f => f.id !== canonical.id)) {
            try {
              await fetch(deleteUrl(dup.id), {
                method: 'DELETE',
                headers: {
                  'X-Auth-Token': accessToken,
                  Accept: 'application/json',
                },
              });
              deletedDuplicates += 1;
            } catch (e: any) {
              errors.push(`Failed to delete duplicate metafield ${dup.id} (${key}): ${e?.message || e}`);
            }
          }
        }

        return { updatedToShared, deletedDuplicates, errors };
      };

      try {
        // Product level cleanup
        const { data: productFields } = await bc.get(`/catalog/products/${pid}/metafields`);
        const productConsol = await consolidate(
          productFields || [],
          ['is_bundle', 'linked_product_ids'],
          (key: string, metafieldId?: number) => metafieldId
            ? `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${pid}/metafields/${metafieldId}`
            : `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${pid}/metafields`,
          (metafieldId: number) => `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${pid}/metafields/${metafieldId}`
        );
        result.product = {
          updatedToShared: productConsol.updatedToShared,
          deletedDuplicates: productConsol.deletedDuplicates,
        };
        result.errors.push(...productConsol.errors);

        // Variant level cleanup
        const { data: productWithVariants } = await bc.get(`/catalog/products/${pid}?include=variants`);
        const variants: any[] = productWithVariants?.variants || [];
        for (const v of variants) {
          const { data: variantFields } = await bc.get(`/catalog/products/${pid}/variants/${v.id}/metafields`);
          const variantConsol = await consolidate(
            variantFields || [],
            ['is_bundle', 'linked_product_ids'],
            (key: string, metafieldId?: number) => metafieldId
              ? `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${pid}/variants/${v.id}/metafields/${metafieldId}`
              : `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${pid}/variants/${v.id}/metafields`,
            (metafieldId: number) => `https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${pid}/variants/${v.id}/metafields/${metafieldId}`
          );
          result.variants.push({
            variantId: v.id,
            updatedToShared: variantConsol.updatedToShared,
            deletedDuplicates: variantConsol.deletedDuplicates,
          });
          result.errors.push(...variantConsol.errors);
        }
      } catch (e: any) {
        result.errors.push(e?.message || String(e));
      }

      return result;
    };

    if (productId) {
      const result = await processOne(Number(productId));

      return res.status(200).json({ results: [result] });
    }

    // Cleanup all products (limited to 250 for safety)
    const { data: products } = await bc.get('/catalog/products?limit=250&include=variants');
    const results: CleanupResult[] = [];
    for (const p of products || []) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await processOne(p.id));
    }

    return res.status(200).json({ results });
  } catch (error: any) {
    console.error('[cleanup] Error:', error?.response?.data || error?.message || error);

    return res.status(error?.response?.status || 500).json({ message: error?.message || 'Cleanup failed' });
  }
}

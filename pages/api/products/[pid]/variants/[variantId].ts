import { NextApiRequest, NextApiResponse } from 'next';
import { bigcommerceClient, getSession } from '../../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const {
        body,
        query: { pid, variantId },
        method,
    } = req;

    if (!pid || typeof pid !== 'string' || !variantId || typeof variantId !== 'string') {
        return res.status(400).json({ message: 'Invalid product ID or variant ID' });
    }

    switch (method) {
        case 'GET':
            try {
                const { accessToken, storeHash } = await getSession(req);
                const bigcommerce = bigcommerceClient(accessToken, storeHash);

                const { data: variant } = await bigcommerce.get(`/catalog/products/${pid}/variants/${variantId}`);
                res.status(200).json(variant);
            } catch (error: any) {
                const { message, response } = error;
                res.status(response?.status || 500).json({ message });
            }
            break;
        case 'PUT':
            try {
                const { accessToken, storeHash } = await getSession(req);
                const bigcommerce = bigcommerceClient(accessToken, storeHash);

                const { data } = await bigcommerce.put(`/catalog/products/${pid}/variants/${variantId}`, body);
                res.status(200).json(data);
            } catch (error: any) {
                const { message, response } = error;
                res.status(response?.status || 500).json({ message });
            }
            break;
        default:
            res.setHeader('Allow', ['GET', 'PUT']);
            res.status(405).end(`Method ${method} Not Allowed`);
    }
} 
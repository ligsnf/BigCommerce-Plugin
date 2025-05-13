import { NextApiRequest, NextApiResponse } from 'next';
import { encodePayload, getBCAuth, registerAppExtension, setSession } from '../../lib/auth';

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
    try {
        // Authenticate the app on install
        const session = await getBCAuth(req.query);
        const encodedContext = encodePayload(session); // Signed JWT to validate/ prevent tampering

        await setSession(session);

        // Use the accessToken and storeHash from the session
        await registerAppExtension(session.accessToken, session.storeHash);

        res.redirect(302, `/?context=${encodedContext}`);
    } catch (error) {
        const { message, response } = error;
        res.status(response?.status || 500).json({ message });
    }
}

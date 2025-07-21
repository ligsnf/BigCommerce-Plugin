/* eslint-disable no-console */
import 'dotenv/config';
import axios from 'axios';

// You can set these as environment variables or hardcode for quick testing
const storeHash = process.env.BC_STORE_HASH || '7wt5mizwwn';
const accessToken = process.env.BC_ACCESS_TOKEN || 'nnikw7gtfck4miecop0ox5h163qnmbx';

async function checkWebhooks() {
  try {
    const response = await axios({
      method: 'get',
      url: `https://api.bigcommerce.com/stores/${storeHash}/v3/hooks`,
      headers: {
        'X-Auth-Token': accessToken,
        'Accept': 'application/json',
      },
    });

    const webhooks = response.data.data || [];
    if (webhooks.length === 0) {
      console.log('No webhooks registered for this store.');
    } else {
      console.log(`Found ${webhooks.length} webhook(s):`);
      webhooks.forEach(hook => {
        console.log(`- ID: ${hook.id}, Scope: ${hook.scope}, Destination: ${hook.destination}, Active: ${hook.is_active}`);
      });
    }
  } catch (error) {
    console.error('Error fetching webhooks:', error.response?.data || error.message);
  }
}

checkWebhooks(); 
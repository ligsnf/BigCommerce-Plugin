/* eslint-disable no-console */
import 'dotenv/config';
import axios from 'axios';
import { getStoreCredentials } from './db.js';

async function createProductWebhooks() {
  const appUrl = process.env.APP_URL;

  if (!appUrl) {
    console.error('Please ensure APP_URL is set in .env file');
    process.exit(1);
  }

  try {
    // Get store credentials from database
    const { storeHash, accessToken } = await getStoreCredentials();

    console.log(`Creating product webhooks for store: ${storeHash}`);

    // Define the webhooks we need for bundle inventory management
    const webhooks = [
      {
        scope: 'store/product/updated',
        destination: `${appUrl}/api/webhooks/products`,
        description: 'Product updated webhook for bundle inventory updates'
      },
      {
        scope: 'store/product/variant/updated',
        destination: `${appUrl}/api/webhooks/products`,
        description: 'Product variant updated webhook for bundle inventory updates'
      },
      {
        scope: 'store/product/inventory/updated',
        destination: `${appUrl}/api/webhooks/products`,
        description: 'Product inventory updated webhook for bundle inventory updates'
      }
    ];

    // First, get existing webhooks to avoid duplicates
    const existingWebhooksResponse = await axios({
      method: 'get',
      url: `https://api.bigcommerce.com/stores/${storeHash}/v3/hooks`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Auth-Token': accessToken
      }
    });

    const existingWebhooks = existingWebhooksResponse.data.data || [];

    // Create each webhook if it doesn't already exist
    for (const webhook of webhooks) {
      const existingWebhook = existingWebhooks.find(existing => 
        existing.scope === webhook.scope && 
        existing.destination === webhook.destination
      );

      if (existingWebhook) {
        console.log(`✅ Webhook already exists for ${webhook.scope}:`, existingWebhook.id);
        continue;
      }

      const response = await axios({
        method: 'post',
        url: `https://api.bigcommerce.com/stores/${storeHash}/v3/hooks`,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Auth-Token': accessToken
        },
        data: {
          scope: webhook.scope,
          destination: webhook.destination,
          is_active: true
        }
      });

      console.log(`✅ Created webhook for ${webhook.scope}:`);
      console.log(JSON.stringify(response.data, null, 2));
    }

    console.log('\n🎉 All product webhooks have been set up successfully!');
    console.log('Your bundles will now automatically update when their constituent products change.');
  } catch (error) {
    if (error.message.includes('No stores found')) {
      console.error('❌ No stores found in database.');
      console.error('Please install the app on a BigCommerce store first, then run this script.');
    } else {
      console.error('❌ Error creating webhooks:');
      console.error(error.response?.data || error.message);
    }
  }
}

createProductWebhooks();

/* eslint-disable no-console */
import 'dotenv/config';
import axios from 'axios';
import db from '../lib/db.ts';

async function checkWebhooksForStore(storeHash, accessToken) {
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
    console.log(`\n📍 Store: ${storeHash}`);
    console.log(`📊 Scope: ${response.data.scope || 'N/A'}`);
    
    if (webhooks.length === 0) {
      console.log('❌ No webhooks registered for this store.');
    } else {
      console.log(`✅ Found ${webhooks.length} webhook(s):`);
      webhooks.forEach(hook => {
        const status = hook.is_active ? '🟢 Active' : '🔴 Inactive';
        console.log(`   - ID: ${hook.id} | ${status} | Scope: ${hook.scope}`);
        console.log(`     Destination: ${hook.destination}`);
      });
    }
  } catch (error) {
    console.log(`\n📍 Store: ${storeHash}`);
    console.error(`❌ Error fetching webhooks: ${error.response?.data?.title || error.message}`);
    if (error.response?.status === 401) {
      console.error('   💡 This might be due to invalid/expired access token');
    }
  }
}

async function checkAllWebhooks() {
  try {
    console.log('🔍 Fetching all stores from database...');
    const stores = await db.getAllStores();
    
    if (stores.length === 0) {
      console.log('❌ No stores found in database.');
      return;
    }

    console.log(`📦 Found ${stores.length} store(s) in database:`);
    
    // Process stores sequentially to avoid rate limiting
    for (const store of stores) {
      await checkWebhooksForStore(store.storeHash, store.accessToken);
    }

    console.log('\n🎉 Finished checking all stores!');

  } catch (error) {
    console.error('❌ Error fetching stores from database:', error.message);
    console.log('💡 Falling back to hardcoded store credentials...');
    
    // Fallback to hardcoded store for testing
    const fallbackStore = {
      storeHash: 'mr060sppq6',
      accessToken: 'gpa9fxqhe060cogblxfwmqnrqzn8bgm'
    };
    
    console.log('📦 Using fallback store for testing:');
    await checkWebhooksForStore(fallbackStore.storeHash, fallbackStore.accessToken);
  }
}

checkAllWebhooks(); 
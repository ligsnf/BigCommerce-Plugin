require('dotenv').config();
const axios = require('axios');

async function createWebhook() {
  const storeHash = process.env.STORE_HASH;
  const authToken = process.env.ACCESS_TOKEN;
  const ngrokUrl = process.env.NGROK_URL;

  if (!storeHash || !authToken || !ngrokUrl) {
    console.error('Please ensure all environment variables are set in .env file:');
    console.error('BIGCOMMERCE_STORE_HASH');
    console.error('BIGCOMMERCE_AUTH_TOKEN');
    console.error('NGROK_URL');
    process.exit(1);
  }

  try {
    const response = await axios({
      method: 'post',
      url: `https://api.bigcommerce.com/stores/${storeHash}/v3/hooks`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Auth-Token': authToken
      },
      data: {
        scope: 'store/order/created',
        destination: `${ngrokUrl}/api/webhooks/orders`,
        is_active: true
      }
    });

    console.log('Webhook created successfully:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error creating webhook:');
    console.error(error.response?.data || error.message);
  }
}

createWebhook(); 
import { Box, Button, Flex, H2, H4, Panel, Text } from '@bigcommerce/big-design';
import { useEffect, useState } from 'react';

const BundleManagerExtension = () => {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Listen for messages from BigCommerce
    const handleMessage = (event) => {
      // Verify the origin is from BigCommerce
      if (!event.origin.match(/^https:\/\/store-[^.]+\.mybigcommerce\.com$/)) {
        return;
      }

      if (event.data.productId) {
        // We received product data from BigCommerce
        fetchProductDetails(event.data.productId);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const fetchProductDetails = async (productId) => {
    try {
      setLoading(true);
      // This would be a call to your API endpoint that fetches product details
      const response = await fetch(`/api/products/${productId}`);
      const data = await response.json();
      setProduct(data);
    } catch (err) {
      setError('Failed to load product details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Panel>
        <Box padding="large">
          <Text>Loading product details...</Text>
        </Box>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <Box padding="large">
          <Text color="danger">{error}</Text>
        </Box>
      </Panel>
    );
  }

  if (!product) {
    return (
      <Panel>
        <Box padding="large">
          <Text>Select a product to manage bundle settings.</Text>
        </Box>
      </Panel>
    );
  }

  return (
    <Panel>
      <Box padding="large">
        <H2>Bundle Manager</H2>
        <Box marginVertical="medium">
          <H4>Product: {product.name}</H4>
          <Text>SKU: {product.sku}</Text>
        </Box>

        <Box marginVertical="large">
          <Text>
            <strong>Limitations Demonstration:</strong>
          </Text>
          <Text>
            This panel can display information about the product and provide a custom interface,
            but it cannot modify the core product form or replace the native SKU field.
          </Text>
        </Box>

        <Box marginVertical="large">
          <Text>
            <strong>What we can do:</strong>
          </Text>
          <ul>
            <li>Display product information</li>
            <li>Provide a custom interface in this panel</li>
            <li>Create/update bundle relationships via API</li>
          </ul>
        </Box>

        <Box marginVertical="large">
          <Text>
            <strong>What we cannot do:</strong>
          </Text>
          <ul>
            <li>Replace the native SKU field in the main product form</li>
            <li>Modify the core product editing experience</li>
            <li>Make the bundle SKUs appear as part of the native product data</li>
          </ul>
        </Box>

        <Flex justifyContent="flex-end" marginTop="large">
          <Button variant="primary" onClick={() => window.open('/bundles/list', '_blank')}>
            Open Bundle Manager
          </Button>
        </Flex>
      </Box>
    </Panel>
  );
};

export default BundleManagerExtension;

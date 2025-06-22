import { AlertProps, Box, H1, Panel, Text } from '@bigcommerce/big-design';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CreateBundleForm from '../../../components/createBundleForm';
import ErrorMessage from '../../../components/error';
import Loading from '../../../components/loading';
import { alertsManager } from '../../../lib/alerts';

const EditBundlePage = () => {
  const router = useRouter();
  const { id } = router.query;

  const [bundleData, setBundleData] = useState(null);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
  
    const fetchData = async () => {
      try {
        const [bundleRes, productsRes] = await Promise.all([
          fetch(`/api/bundles/${id}`),
          fetch('/api/bundles/products'),
        ]);
  
        const bundle = await bundleRes.json();
        const productsList = await productsRes.json();
  
        setBundleData(bundle);
        setProducts(productsList?.data || []);
      } catch (err) {
        setError(err);
      } finally {
        setIsLoading(false);
      }
    };
  
    fetchData();
  }, [id]);

  const handleSubmit = async (bundle) => {
    const res = await fetch(`/api/bundles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    });

    if (res.ok) {
      const alert: AlertProps = {
        messages: [{text: 'Bundle updated successfully!'}],
        type: 'success',
        onClose: () => null,
      };
      alertsManager.add(alert);
      router.push('/bundles/list');
    } else {
      const data = await res.json();
      const alert: AlertProps = {
        messages: [{text:`Failed to update bundle: ${data.message}`}],
        type: 'success',
        onClose: () => null,
      };
      alertsManager.add(alert);
    }
  };

  const handleCancel = () => {
    router.push('/bundles/list');
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!bundleData) return <Text>Bundle not found.</Text>;
  if (!products.length) return <Text>Loading products...</Text>;

  return (
    <Panel header="Edit Bundle">
      <Box marginBottom="large">
        <H1>Edit Bundle</H1>
      </Box>
      <CreateBundleForm
        availableSKUs={products.map(({ sku, name, price, stock }) => ({
          sku,
          name,
          price,
          stock, // ✅ because from BigCommerce it's inventory_level
        }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        initialData={bundleData} // 🛠 (we will pass this in CreateBundleForm soon)
      />
    </Panel>
  );
};

export default EditBundlePage;

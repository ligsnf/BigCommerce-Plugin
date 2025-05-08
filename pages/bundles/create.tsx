import { AlertProps, Box, H1, Panel, Text } from '@bigcommerce/big-design';
import { useRouter } from 'next/router';
import CreateBundleForm from '../../components/createBundleForm';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { useProductList } from '../../lib/hooks';
import { alertsManager } from '../../pages/_app';

const BundlesCreatePage = () => {
  const router = useRouter();
  const { list = [], isLoading, error } = useProductList();

  const products = list.map(({ sku, name, price, inventory_level }) => ({
    sku,
    name,
    price,
    stock: inventory_level,
  }));

  const handleSubmit = async (bundle) => {
    const res = await fetch('/api/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    });

    const data = await res.json();

    if (res.ok) {
      const alert: AlertProps = {
        messages: [{text: 'Bundle saved successfully!'}],
        type: 'success',
        onClose: () => null,
      };
      alertsManager.add(alert);
      router.push('/bundles/list'); // Redirect after saving
    } else {
      const alert: AlertProps = {
        messages: [{text: `Failed to save bundle: ${data.message}`}],
        type: 'error',
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

  return (
    <Panel>
      <Box marginBottom="large">
        <H1>Create a New Product Bundle</H1>
        <Text>Select SKUs and quantities to create a bundle. You can override the total price if needed.</Text>
      </Box>
      <CreateBundleForm
        availableSKUs={products}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </Panel>
  );
};

export default BundlesCreatePage;

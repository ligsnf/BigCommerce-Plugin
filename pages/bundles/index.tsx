import { Box, H1, Panel, Text } from '@bigcommerce/big-design';
import Loading from '../../components/loading';
import ErrorMessage from '../../components/error';
import CreateBundleForm from '../../components/createBundleForm';
import { useProductList } from '../../lib/hooks';

const BundlesPage = () => {
  const { list = [], isLoading, error } = useProductList();

  // Transform the list into the format expected by CreateBundleForm
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
      alert('✅ Bundle saved successfully!');
    } else {
      alert(`❌ Failed to save bundle: ${data.message}`);
    }
  };
  

  const handleCancel = () => {
    console.log('Cancelled');
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <Panel header="Bundles">
      <Box marginBottom="large">
        <H1>Create a Product Bundle</H1>
        <Text>
          Select products from the list and set quantities. The total price is calculated automatically.
        </Text>
      </Box>
      <CreateBundleForm
        availableSKUs={products}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </Panel>
  );
};

export default BundlesPage;

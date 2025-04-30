import CreateBundleForm from '../../components/createBundleForm';

const sampleSKUs = [
  { sku: 'AUS-DR', name: 'Aussie Spirit Chess Set', price: 349 },
  { sku: 'L38810DR', name: 'Magnetic Travel Set', price: 39 },
];

const CreateBundlePage = () => {
  const handleSubmit = (bundle) => {
    console.log('Bundle submitted:', bundle);
    // Call API to save bundle to your backend
  };

  return (
    <CreateBundleForm
      availableSKUs={sampleSKUs}
      onSubmit={handleSubmit}
      onCancel={() => window.history.back()}
    />
  );
};

export default CreateBundlePage;

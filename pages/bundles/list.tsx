import { Box, H1, Panel, Table, Text, Button } from '@bigcommerce/big-design';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Loading from '../../components/loading';
import ErrorMessage from '../../components/error';

const BundlesListPage = () => {
  const [bundles, setBundles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const fetchBundles = async () => {
      try {
        const res = await fetch('/api/bundles/list');
        const data = await res.json();
        setBundles(data.bundles || []);
      } catch (err) {
        setError(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBundles();
  }, []);

  if (isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <Panel>
    <Box marginBottom="large">
        <H1>All Saved Bundles</H1>
    </Box>
    <Box marginBottom="medium">
        <Button onClick={() => router.push('/bundles/create')}>
            Create New Bundle
        </Button>
    </Box>


      {bundles.length > 0 ? (
        <Table
          columns={[
            { header: 'Name', hash: 'name', render: ({ name }) => <Text>{name}</Text> },
            { header: 'Price', hash: 'price', render: ({ price }) => <Text>${price}</Text> },
          ]}
          items={bundles}
          itemName="Bundle"
          stickyHeader
        />
      ) : (
        <Text>No bundles found.</Text>
      )}
    </Panel>
  );
};

export default BundlesListPage;

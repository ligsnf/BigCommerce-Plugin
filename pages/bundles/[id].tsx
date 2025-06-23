import { Box, Button, H1, Panel, Table, TableSortDirection , Text } from '@bigcommerce/big-design';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { useSession } from '../../context/session';

const BundleDetailsPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const { context } = useSession();

  const [bundle, setBundle] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [columnHash, setColumnHash] = useState('');
  const [direction, setDirection] = useState<TableSortDirection>('ASC');

  useEffect(() => {
    if (!id || !context) return;

    const fetchBundle = async () => {
      try {
        const res = await fetch(`/api/bundles/${id}?context=${encodeURIComponent(context)}`);
        const data = await res.json();
        setBundle(data);
      } catch (err) {
        setError(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBundle();
  }, [id, context]);

  const handleSort = (newColumnHash: string, newDirection: TableSortDirection) => {
    setColumnHash(newColumnHash);
    setDirection(newDirection);
  };

  const handleBack = () => {
    router.push('/bundles/list');
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!bundle) return <Text>Bundle not found.</Text>;

  return (
    <Panel header="Bundle Details">
      <Box marginBottom="large">
        <H1>{bundle.name}</H1>
        <Text marginBottom="small">Price: ${bundle.price}</Text>
        <Button variant="secondary" onClick={handleBack} marginBottom="large">
          Back to Bundles
        </Button>
      </Box>

      {bundle.items && bundle.items.length > 0 ? (
        <Table
        columns={[
          { header: 'SKU', hash: 'sku', render: ({ sku }) => <Text>{sku}</Text>, isSortable: true },
          { header: 'Quantity', hash: 'quantity', render: ({ quantity }) => <Text>{quantity}</Text>, isSortable: true },
        ]}
        items={[...bundle.items].sort((a, b) => {
            if (!columnHash) return 0; // No sorting initially
          
            const aValue = a[columnHash];
            const bValue = b[columnHash];
          
            if (aValue < bValue) return direction === 'ASC' ? -1 : 1;
            if (aValue > bValue) return direction === 'ASC' ? 1 : -1;

            return 0;
          })}          
        itemName="SKU"
        stickyHeader
        sortable={{
          columnHash,
          direction,
          onSort: handleSort,
        }}
      />
      ) : (
        <Text>No SKUs in this bundle.</Text>
      )}
    </Panel>
  );
};

export default BundleDetailsPage;

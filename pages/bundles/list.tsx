import { AlertProps, Box, Button, Dropdown, H1, Panel, Table, Text } from '@bigcommerce/big-design';
import { MoreHorizIcon } from '@bigcommerce/big-design-icons';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { alertsManager } from '../../lib/alerts';

const BundlesListPage = () => {
  const [bundles, setBundles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this bundle?')) {
      return;
    }

    try {
      const res = await fetch(`/api/bundles/${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        const alert: AlertProps = {
          messages: [{text: 'Bundle deleted successfully!'}],
          type: 'success',
          onClose: () => null,
        };
        alertsManager.add(alert);
        router.reload(); // Refresh the list
      } else {
        const data = await res.json();
        const alert: AlertProps = {
          messages: [{text: `Failed to delete bundle: ${data.message}`}],
          type: 'error',
          onClose: () => null,
        };
        alertsManager.add(alert);
      }
    } catch (err) {
      const alert: AlertProps = {
        messages: [{text: 'An error occurred while deleting the bundle.'}],
        type: 'error',
        onClose: () => null,
      };
      alertsManager.add(alert);
      console.error(err);
    }
  };

  const renderName = ({ id, name }) => (
    <Button
      variant="subtle"
      onClick={() => router.push(`/bundles/${id}`)}
    >
      {name}
    </Button>
  );
  
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
          { header: 'Name', hash: 'name', render: renderName },
          {
            header: 'SKUs',
            hash: 'skus',
            render: ({ skus }) => <Text>{skus || 'No SKUs'}</Text>
          },
          { header: 'Price', hash: 'price', render: ({ price }) => <Text>${price}</Text> },
          {
            header: 'Action',
            hideHeader: true,
            hash: 'id',
            render: ({ id }) => (
              <Dropdown
                toggle={<Button iconOnly={<MoreHorizIcon color="secondary60" />} variant="subtle" />}
                items={[
                  { content: 'Edit', onItemClick: () => router.push(`/bundles/edit/${id}`) },
                  { content: 'Delete', onItemClick: () => handleDelete(id), color: 'danger' },
                ]}
              />
            ),
          } 
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

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Box, Flex, H1, Panel, Button, Tabs, Table } from '@bigcommerce/big-design';
import ErrorMessage from '@components/error';
import Loading from '@components/loading';

interface Product {
  id: number;
  name: string;
  sku: string;
  variants: Array<{
    id: number;
    sku: string;
    option_values: Array<{ label: string }>;
  }>;
}

interface Bundle {
  id: number;
  name: string;
  sku: string;
  isVariant: boolean;
  variantId?: number;
  variantName?: string;
  productCount: number;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activeTab, setActiveTab] = useState<'products' | 'bundles'>('products');
  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/bundles/list');
        if (!res.ok) throw new Error('Failed to fetch data');
        const data = await res.json();
        setProducts(data.products);
        setBundles(data.bundles);
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  if (isLoading) return <Loading />;
  if (error) return <ErrorMessage error={error} />;

  const handleProductClick = (productId: number) => {
    window.open(`https://store-${process.env.NEXT_PUBLIC_STORE_HASH}.mybigcommerce.com/manage/products/${productId}/edit`, '_blank');
  };

  const productColumns = [
    { header: 'Name', hash: 'name', render: ({ name, id }: Product) => (
      <Button variant="subtle" onClick={() => handleProductClick(id)}>
        {name}
      </Button>
    )},
    { header: 'SKU', hash: 'sku', render: ({ sku }: Product) => sku }
  ];

  const bundleColumns = [
    { header: 'Name', hash: 'name', render: ({ name, id, isVariant, variantName }: Bundle) => (
      <Button variant="subtle" onClick={() => handleProductClick(id)}>
        {name}{isVariant && variantName && ` - ${variantName}`}
      </Button>
    )},
    { header: 'SKU', hash: 'sku', render: ({ sku }: Bundle) => sku },
    { header: 'Type', hash: 'type', render: ({ isVariant }: Bundle) => 
      isVariant ? 'Variant Bundle' : 'Product Bundle'
    },
    { header: 'Products', hash: 'productCount', render: ({ productCount }: Bundle) => productCount }
  ];

  return (
    <Box padding="large">
      <Panel>
        <H1>Product Management</H1>
        
        <Flex marginTop="large" marginBottom="medium">
          <Tabs
            activeTab={activeTab}
            onTabClick={(tabId) => setActiveTab(tabId as 'products' | 'bundles')}
            items={[
              { id: 'products', title: 'Products' },
              { id: 'bundles', title: 'Bundles' }
            ]}
          />
        </Flex>

        {activeTab === 'products' ? (
          <Table
            columns={productColumns}
            items={products}
            stickyHeader
          />
        ) : (
          <Table
            columns={bundleColumns}
            items={bundles}
            stickyHeader
          />
        )}
      </Panel>
    </Box>
  );
}

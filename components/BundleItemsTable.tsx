import { Box, Input, Table } from '@bigcommerce/big-design';
import { CloseIcon } from '@bigcommerce/big-design-icons';

interface BundleItemsTableProps {
  linkedProducts: any[];
  productQuantities: Record<string, number>;
  onQuantityChange: (productId: number, quantity: number) => void;
  onRemoveProduct: (productId: number) => void;
}

const BundleItemsTable = ({
  linkedProducts,
  productQuantities,
  onQuantityChange,
  onRemoveProduct
}: BundleItemsTableProps) => {
  if (linkedProducts.length === 0) {

    return null;
  }

  return (
    <Box marginTop="medium">
      <Table
        columns={[
          { header: 'Product', hash: 'product', render: ({ label }) => label },
          { header: 'SKU', hash: 'sku', render: ({ skuLabel }) => skuLabel },
          { 
            header: 'Quantity',
            hash: 'quantity',
            width: '200px',
            render: ({ value, productId, variantId }) => {
              const key = variantId ? `${productId}-${variantId}` : value.toString();

              return (
                <Input
                  type="number"
                  min="1"
                  value={productQuantities[key] || 1}
                  onChange={(e) => onQuantityChange(value, parseInt(e.target.value))}
                  style={{ width: '120px' }}
                />
              );
            }
          },
          {
            header: '',
            hash: 'actions',
            width: '50px',
            render: ({ value }) => (
              <button
                onClick={() => onRemoveProduct(value)}
                style={{ 
                  border: 'none', 
                  background: 'none', 
                  cursor: 'pointer',
                  padding: '4px',
                  color: '#D92D20'
                }}
              >
                <CloseIcon />
              </button>
            )
          }
        ]}
        items={linkedProducts}
      />
    </Box>
  );
};

export default BundleItemsTable; 
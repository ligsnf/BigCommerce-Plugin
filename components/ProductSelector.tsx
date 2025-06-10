import { Box, Small } from '@bigcommerce/big-design';
import Select from 'react-select';

interface ProductOption {
  value: string;
  label: string;
  productId: number;
  sku: string;
  isMainProduct: boolean;
  inventory_level: number;
  inventory_tracking: string;
  variantId?: number;
}

interface ProductSelectorProps {
  combinedOptions: ProductOption[];
  selectedItem: ProductOption | null;
  onItemSelect: (item: ProductOption | null) => void;
  linkedProducts: Array<{
    id: string;
    product: ProductOption;
    quantity: number;
  }>;
  products: any[];
}

const ProductSelector = ({
  combinedOptions,
  selectedItem,
  onItemSelect,
  linkedProducts,
  products
}: ProductSelectorProps) => {
  const filteredOptions = combinedOptions.filter(option => {
    const id = option.variantId
      ? `${option.productId}-${option.variantId}`
      : `${option.productId}-`;
    const isAlreadyLinked = linkedProducts.some(lp => lp.id === id);
    return !isAlreadyLinked;
  });

  return (
    <Box marginBottom="medium">
      <Select
        isSearchable
        options={filteredOptions}
        value={selectedItem}
        onChange={(option) => {
          console.log('Selected option:', {
            label: option?.label,
            productId: option?.productId,
            variantId: option?.variantId,
            inventory_tracking: option?.inventory_tracking
          });
          onItemSelect(option);
        }}
        placeholder="Search and select a product or SKU..."
        noOptionsMessage={() => "No products available. Note: Products must have inventory tracking enabled to be added to bundles."}
        formatOptionLabel={(option) => {
          const product = products.find(p => p.value === option.productId);
          const hasMultipleVariants = product?.variants && product?.variants.length > 1;
          const hasInventoryTracking = option.isMainProduct 
            ? product?.inventory_tracking === "product"
            : hasMultipleVariants && product?.inventory_tracking === "variant";

          return (
            <div style={{ 
              opacity: hasInventoryTracking ? 1 : 0.5,
              color: hasInventoryTracking ? "inherit" : "#666"
            }}>
              {option.label}
              {!hasInventoryTracking && (
                <Small color="secondary" style={{ marginLeft: "8px" }}>
                  (Inventory tracking disabled)
                </Small>
              )}
            </div>
          );
        }}
      />
      <Small marginTop="small" color="secondary">
        Note: Only products with inventory tracking enabled can be added to bundles.
      </Small>
    </Box>
  );
};

export default ProductSelector; 
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
  linkedProducts: any[];
  products: any[];
}

const ProductSelector = ({
  combinedOptions,
  selectedItem,
  onItemSelect,
  linkedProducts,
  products
}: ProductSelectorProps) => {
  return (
    <Box marginBottom="medium">
      <Select
        isSearchable
        options={combinedOptions.filter(option => 
          !linkedProducts.find(lp => lp.selectedSku === option.sku)
        )}
        value={selectedItem}
        onChange={onItemSelect}
        placeholder="Search and select a product or SKU..."
        noOptionsMessage={() => "No products available. Note: Products must have inventory tracking enabled to be added to bundles."}
        formatOptionLabel={(option) => {
          const product = products.find(p => p.value === option.productId);
          const hasMultipleVariants = product?.variants && product.variants.length > 1;
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
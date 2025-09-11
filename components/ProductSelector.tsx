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
  const isOptionLinked = (option: ProductOption) => {
    const optionKey = option.variantId
      ? `${option.productId}-${option.variantId}`
      : `${option.productId}-`;

    return linkedProducts.some(lp => {
      const lpProductId = (lp as any).productId ?? (lp as any).value;
      const lpVariantId = (lp as any).variantId ?? null;
      const lpKey = lpVariantId ? `${lpProductId}-${lpVariantId}` : `${lpProductId}-`;

      return lpKey === optionKey;
    });
  };

  const hasInventoryTrackingEnabled = (option: ProductOption) => {
    const product = products.find(p => p.value === option.productId);
    const hasMultipleVariants = product?.variants && product?.variants.length > 1;

    if (option.isMainProduct) {
      return product?.inventory_tracking === "product";
    }

    return Boolean(hasMultipleVariants && product?.inventory_tracking === "variant");
  };

  const filteredOptions = combinedOptions.filter(option => {
    if (isOptionLinked(option)) return false;
    if (!hasInventoryTrackingEnabled(option)) return false;

    return true;
  });

  return (
    <Box marginBottom="medium">
      <Select
        isSearchable
        options={filteredOptions}
        value={selectedItem}
        closeMenuOnSelect={false}
        onChange={(option) => {
          onItemSelect(option);
        }}
        placeholder="Search and select a product or SKU..."
        noOptionsMessage={() => "No products available. Note: Products must have inventory tracking enabled to be added to bundles."}
        formatOptionLabel={(option) => option.label}
      />
      <Small marginTop="small" color="secondary">
        Note: Only products with inventory tracking enabled can be added to bundles.
      </Small>
    </Box>
  );
};

export default ProductSelector; 
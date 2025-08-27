import { Box, Button, H4, Input, Panel, Switch } from '@bigcommerce/big-design';
import BundleItemsTable from './BundleItemsTable';
import ProductSelector from './ProductSelector';

interface BundleSettingsPanelProps {
  header?: string;
  isBundle: boolean;
  onBundleToggle: () => void;
  combinedOptions: any[];
  selectedItem: any;
  onItemSelect: (item: any) => void;
  linkedProducts: any[];
  products: any[];
  productQuantities: Record<number, number>;
  onQuantityChange: (productId: number, quantity: number) => void;
  onRemoveProduct: (productId: number) => void;
  onSave: () => void;
  saving: boolean;
  variants: any[];
  selectedVariant: any;
  onVariantSelect: (variant: any) => void;
  variantLinkedProducts: Record<number, any[]>;
  variantProductQuantities: Record<number, Record<number, number>>;
  onVariantQuantityChange: (variantId: number, productId: number, quantity: number) => void;
  onVariantRemoveProduct: (variantId: number, productId: number) => void;
  overridePrice: number | null;
  onOverridePriceChange: (value: number | null) => void;
  variantOverridePrices: Record<number, number | null>;
  onVariantOverridePriceChange: (variantId: number, value: number | null) => void;
}

const BundleSettingsPanel = ({
  header,
  isBundle,
  onBundleToggle,
  combinedOptions,
  selectedItem,
  onItemSelect,
  linkedProducts,
  products,
  productQuantities,
  onQuantityChange,
  onRemoveProduct,
  onSave,
  saving,
  variants,
  selectedVariant,
  onVariantSelect,
  variantLinkedProducts,
  variantProductQuantities,
  onVariantQuantityChange,
  onVariantRemoveProduct
  ,
  overridePrice,
  onOverridePriceChange,
  variantOverridePrices,
  onVariantOverridePriceChange
}: BundleSettingsPanelProps) => {
  const hasMultipleVariants = variants && variants.length > 1;
  const canSave = !isBundle || (
    hasMultipleVariants 
      ? Object.values(variantLinkedProducts).every(products => products.length > 0)
      : linkedProducts.length > 0
  );

  const handleVariantSelect = (variant) => {
    // Clear the selected item when switching variants
    onItemSelect(null);
    onVariantSelect(variant);
  };

  return (
    <Panel header={header}>
      <Box marginBottom="medium">
        <H4>Is this product a bundle?</H4>
        <Switch
          checked={isBundle}
          onChange={onBundleToggle}
        />
      </Box>

      {isBundle && (
        <Box marginBottom="medium">
          {hasMultipleVariants ? (
            <>
              <H4>Select a variant to configure its bundle</H4>
              <Box marginBottom="medium">
                <Box marginBottom="small">
                  {variants.map(variant => (
                    <Box key={variant.id} marginBottom="small" display="inline-block" marginRight="small">
                      <Button
                        variant={selectedVariant?.id === variant.id ? "primary" : "secondary"}
                        onClick={() => handleVariantSelect(variant)}
                      >
                        {variant.option_values?.map(ov => ov.label).join(' - ') || 'Variant'} 
                        {variant.sku && ` [${variant.sku}]`}
                        {variantLinkedProducts[variant.id]?.length > 0 && 
                          ` (${variantLinkedProducts[variant.id].length} products)`}
                      </Button>
                    </Box>
                  ))}
                </Box>
              </Box>

              {selectedVariant && (
                <>
                  <H4>Select products and quantities for this variant bundle</H4>
                  <ProductSelector
                    combinedOptions={combinedOptions}
                    selectedItem={selectedItem}
                    onItemSelect={onItemSelect}
                    linkedProducts={variantLinkedProducts[selectedVariant.id] || []}
                    products={products}
                  />
                  
                  <BundleItemsTable
                    linkedProducts={variantLinkedProducts[selectedVariant.id] || []}
                    productQuantities={variantProductQuantities[selectedVariant.id] || {}}
                    onQuantityChange={(productId, quantity) => onVariantQuantityChange(selectedVariant.id, productId, quantity)}
                    onRemoveProduct={(productId) => onVariantRemoveProduct(selectedVariant.id, productId)}
                  />

                  <Box marginTop="medium">
                    <Input
                      label="Override Price"
                      type="number"
                      iconLeft="$"
                      value={variantOverridePrices[selectedVariant.id] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const parsed = val === '' ? null : Number(val);
                        onVariantOverridePriceChange(selectedVariant.id, isNaN(parsed as number) ? null : parsed);
                      }}
                    />
                  </Box>
                </>
              )}
            </>
          ) : (
            <>
          <H4>Select products and quantities for this bundle</H4>
          <ProductSelector
            combinedOptions={combinedOptions}
            selectedItem={selectedItem}
            onItemSelect={onItemSelect}
            linkedProducts={linkedProducts}
            products={products}
          />
          
          <BundleItemsTable
            linkedProducts={linkedProducts}
            productQuantities={productQuantities}
            onQuantityChange={onQuantityChange}
            onRemoveProduct={onRemoveProduct}
          />

          <Box marginTop="medium">
            <Input
              label="Override Price"
              type="number"
              iconLeft="$"
              value={overridePrice ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                const parsed = val === '' ? null : Number(val);
                onOverridePriceChange(isNaN(parsed as number) ? null : parsed);
              }}
            />
          </Box>
            </>
          )}
        </Box>
      )}

      <Button
        isLoading={saving}
        disabled={saving || !canSave}
        onClick={onSave}
        marginTop="medium"
      >
        Save
      </Button>
    </Panel>
  );
};

export default BundleSettingsPanel; 
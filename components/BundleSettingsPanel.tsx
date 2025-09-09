import { Box, Button, H4, Input, Panel, Small, Switch } from '@bigcommerce/big-design';
import BundleItemsTable from './BundleItemsTable';
import ProductSelector from './ProductSelector';

interface BundleSettingsPanelProps {
  header?: string;
  isBundle: boolean;
  onBundleToggle: () => void;
  isToggleDisabled?: boolean;
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
  wasBundleOnLoad: boolean;
}

const BundleSettingsPanel = ({
  header,
  isBundle,
  onBundleToggle,
  isToggleDisabled,
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
  onVariantOverridePriceChange,
  wasBundleOnLoad
}: BundleSettingsPanelProps) => {
  const hasMultipleVariants = variants && variants.length > 1;
  const canSave = !isBundle || (
    hasMultipleVariants 
      ? Object.values(variantLinkedProducts).every(products => products.length > 0)
      : linkedProducts.length > 0
  );

  const getUnitPrice = (item: any) => {
    // Try to resolve price from variants first (if variantId present), then fallback to product price
    const pid = item.productId ?? item.value;
    const vid = item.variantId ?? null;
    const product = products.find((p: any) => p.value === pid);
    if (!product) {
      return Number(item.price ?? 0);
    }

    if (vid && Array.isArray(product.variants)) {
      const variant = product.variants.find((v: any) => v.id === vid);
      if (variant && variant.price != null) {
        return Number(variant.price);
      }
    }

    return Number(product.price ?? item.price ?? 0);
  };

  const formatPrice = (value: number) => `$${(Number(value) || 0).toFixed(2)}`;

  const calculateMainBundlePrice = () => {
    if (!isBundle) return 0;
    return (linkedProducts || []).reduce((sum: number, p: any) => {
      const key = p.variantId ? `${p.productId ?? p.value}-${p.variantId}` : (p.value ?? '').toString();
      const qty = (productQuantities?.[key] ?? 1) as number;
      return sum + getUnitPrice(p) * Math.max(1, Number(qty) || 1);
    }, 0);
  };

  const calculateVariantBundlePrice = () => {
    if (!isBundle || !selectedVariant) return 0;
    const items = variantLinkedProducts?.[selectedVariant.id] || [];
    const quantities = variantProductQuantities?.[selectedVariant.id] || {};
    return items.reduce((sum: number, p: any) => {
      const key = p.variantId ? `${p.productId ?? p.value}-${p.variantId}` : (p.value ?? '').toString();
      const qty = (quantities?.[key] ?? 1) as number;
      return sum + getUnitPrice(p) * Math.max(1, Number(qty) || 1);
    }, 0);
  };

  const handleVariantSelect = (variant) => {
    // Clear the selected item when switching variants
    onItemSelect(null);
    onVariantSelect(variant);
  };

  // Debug: log prop/state changes outside of JSX to avoid returning void in render
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[Panel props] isBundle:', isBundle, { hasMultipleVariants, selectedVariantId: selectedVariant?.id ?? null });
  }

  return (
    <Panel header={header}>
      <Box marginBottom="medium">
        <H4>Is this product a bundle?</H4>
        <Switch
          checked={isBundle}
          onChange={() => {
            // eslint-disable-next-line no-console
            console.log('[UI] Switch onChange fired');
            onBundleToggle();
          }}
          disabled={isToggleDisabled}
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

                  <Box marginTop="small">
                    <Small>Calculated Price: {formatPrice(calculateVariantBundlePrice())}</Small>
                  </Box>

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

          <Box marginTop="small">
            <Small>Calculated Price: {formatPrice(calculateMainBundlePrice())}</Small>
          </Box>

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

      {isBundle && hasMultipleVariants && !canSave && (
        <Box marginBottom="xxSmall">
          <Small color="danger">All variants must have products in order to save.</Small>
        </Box>
      )}

      {wasBundleOnLoad && !isBundle && (
        <Box marginBottom="xxSmall">
          <Small color="danger">Saving will remove the bundle status for this product.</Small>
        </Box>
      )}

      <Button
        actionType={wasBundleOnLoad && !isBundle ? 'destructive' : 'normal'}
        isLoading={saving}
        disabled={saving || !canSave}
        onClick={onSave}
        marginTop="medium"
      >
        {wasBundleOnLoad && !isBundle ? 'Remove bundle status' : 'Save'}
      </Button>
    </Panel>
  );
};

export default BundleSettingsPanel; 
/* eslint-disable no-console */
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import BundleSettingsPanel from '@components/BundleSettingsPanel';
import ErrorMessage from '@components/error';
import Loading from '@components/loading';
import { useProductInfo, useProductList } from '@lib/hooks';
import { alertsManager } from '@lib/alerts';

interface Variant {
  id: number;
  sku: string;
  option_values: Array<{ label: string }>;
}

interface Product {
  name: string;
  variants: Variant[];
  sku: string;
}

const ProductAppExtension = () => {
  const router = useRouter();
  const productId = Number(router.query?.productId);
  const context = router.query?.context as string;

  const { error, isLoading, product } = useProductInfo(productId);
  const { name, variants = [] } = (product ?? { variants: [] }) as Product;

  const [isBundle, setIsBundle] = useState(false);
  const [linkedProducts, setLinkedProducts] = useState([]);
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({});
  const { list = [], isLoading: isProductsLoading, error: productsError } = useProductList();
  const [saving, setSaving] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [variantLinkedProducts, setVariantLinkedProducts] = useState<Record<number, any[]>>({});
  const [variantProductQuantities, setVariantProductQuantities] = useState<Record<number, Record<number, number>>>({});
  const [bundleProductIds, setBundleProductIds] = useState<Set<number>>(new Set());
  const [bundleVariantIds, setBundleVariantIds] = useState<Set<number>>(new Set());
  const [overridePrice, setOverridePrice] = useState<number | null>(null);
  const [variantOverridePrices, setVariantOverridePrices] = useState<Record<number, number | null>>({});

  // Fetch bundles (by metafields) to exclude them from selection
  useEffect(() => {
    async function fetchBundles() {
      try {
        const res = await fetch(`/api/bundles/list?context=${encodeURIComponent(context)}`);
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.warn('Failed to load bundles list:', await res.text());
          
          return;
        }
        const data = await res.json();
        const productIds = new Set<number>();
        const variantIds = new Set<number>();

        (data.bundles || []).forEach((b: any) => {
          if (b.isVariant) {
            if (typeof b.variantId === 'number') variantIds.add(b.variantId);
          } else {
            if (typeof b.id === 'number') productIds.add(b.id);
          }
        });

        setBundleProductIds(productIds);
        setBundleVariantIds(variantIds);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Error fetching bundles list:', e);
      }
    }

    if (context) {
      fetchBundles();
    }
  }, [context]);

  // Format available products for react-select (main products only)
  const products = list
    .filter(({ id }) => {
      if (id === productId) return false;
      if (bundleProductIds.has(id)) return false;

      return true;
    })
    .map(({ id, sku, name, price, inventory_level, variants, inventory_tracking }) => ({
      value: id,
      label: name,
      sku,
      variants: variants || [],
      price,
      inventory_level,
      inventory_tracking
    }));

  // Create combined options for products and their SKUs
  const combinedOptions = products.reduce((acc, product) => {
    acc.push({
      value: `product-${product.value}`,
      label: `${product.sku}: ${product.label}`,
      productId: product.value,
      sku: product.sku,
      isMainProduct: true,
      inventory_level: product.inventory_level,
      inventory_tracking: product.inventory_tracking
    });

    if (Array.isArray(product.variants) && product.variants.length > 1) {
      product.variants.forEach(variant => {
        if (bundleVariantIds.has(variant.id)) return;
        const variantSku = variant.sku || variant.option_values?.map(ov => ov.label).join('-');
        if (variantSku) {
          const variantName = variant.option_values?.map(ov => ov.label).join(' - ') || 'Variant';
          acc.push({
            value: `sku-${variantSku}`,
            label: `${variantSku}: ${product.label} - ${variantName}`,
            productId: product.value,
            sku: variantSku,
            isMainProduct: false,
            inventory_level: variant.inventory_level || 0,
            inventory_tracking: variant.inventory_tracking || product.inventory_tracking,
            variantId: variant.id
          });
        }
      });
    }

    return acc;
  }, []);

  // Handle item selection
  const handleItemSelect = (selectedItem) => {
    if (!selectedItem) return;

    const product = products.find(p => p.value === selectedItem.productId);
    if (!product) return;

    const hasMultipleVariants = product.variants && product.variants.length > 1;
    const hasInventoryTracking = selectedItem.isMainProduct
      ? product.inventory_tracking === "product"
      : hasMultipleVariants && product.inventory_tracking === "variant";

    if (!hasInventoryTracking) {
      alertsManager.add({
        messages: [{ text: 'This product/variant cannot be added because inventory tracking is disabled.' }],
        type: 'error',
        onClose: () => null,
      });
      setSelectedItem(null);

      return;
    }

    const newProduct = {
      ...product,
      selectedSku: selectedItem.sku,
      skuLabel: selectedItem.sku,
      label: selectedItem.label,
      inventory_tracking: product.inventory_tracking,
      variantId: selectedItem.variantId
    };

    if (selectedVariant) {
      // Add to variant bundle
      setVariantLinkedProducts(prev => ({
        ...prev,
        [selectedVariant.id]: [...(prev[selectedVariant.id] || []), newProduct]
      }));
      setVariantProductQuantities(prev => ({
        ...prev,
        [selectedVariant.id]: {
          ...(prev[selectedVariant.id] || {}),
          [`${product.value}-${selectedItem.variantId}`]: 1
        }
      }));
    } else {
      // Add to main product bundle
      setLinkedProducts([...linkedProducts, newProduct]);
      setProductQuantities(prev => ({
        ...prev,
        [`${product.value}-${selectedItem.variantId}`]: 1
      }));
    }

    setSelectedItem(null);
  };

  // Load existing metafields on load
  useEffect(() => {
    async function fetchMetafields() {
      if (!productId || products.length === 0) return;

      try {
        const hasMultipleVariants = variants.length > 1;
        console.log('Initial load - Product data:', {
          productId,
          hasMultipleVariants,
          variants,
          products
        });

        if (hasMultipleVariants) {
          // Fetch metafields for each variant
          const variantMetafieldsPromises = variants.map(async (variant) => {
            const res = await fetch(`/api/productAppExtension/${productId}/variants/${variant.id}/metafields?context=${encodeURIComponent(context)}`);
            if (!res.ok) {
              console.warn(`Failed to load metafields for variant ${variant.id}:`, await res.text());

              return null;
            }

            return res.json();
          });

          const variantMetafieldsResults = await Promise.all(variantMetafieldsPromises);
          console.log('Variant metafields results:', variantMetafieldsResults);

          // Process variant metafields
          const variantData = {};
          const variantQuantities = {};
          const variantProducts = {};
          const variantOverrides: Record<number, number | null> = {};

          variantMetafieldsResults.forEach((data, index) => {
            if (data) {
              const variantId = variants[index].id;
              variantData[variantId] = data.isBundle;
              variantOverrides[variantId] = data.overridePrice ?? null;

              // Map linked products with their quantities
              variantProducts[variantId] = data.linkedProductIds.map((linkedProduct) => {
                // Handle both old format (just ID) and new format (object with productId and variantId)
                const productId = typeof linkedProduct === 'object' ? linkedProduct.productId : linkedProduct;
                const variantId = typeof linkedProduct === 'object' ? linkedProduct.variantId : null;
                const quantity = typeof linkedProduct === 'object' ? linkedProduct.quantity : 1;

                // First try to find a product with this variant ID
                const productWithVariant = products.find(p =>
                  p.variants && p.variants.some(v => v.id === variantId)
                );

                if (productWithVariant && variantId) {
                  const variant = productWithVariant.variants.find(v => v.id === variantId);

                  return {
                    value: variantId,
                    label: `${productWithVariant.label} [${variant.option_values.map(ov => ov.label).join(' - ')}]`,
                    sku: variant.sku,
                    skuLabel: variant.sku,
                    productId: productWithVariant.value,
                    variantId: variantId,
                    quantity: quantity
                  };
                }

                // Fallback to finding by product ID
                const match = products.find(p => p.value === productId);

                return match
                  ? { ...match, quantity, skuLabel: match.sku }
                  : { value: productId, label: `Product ${productId}`, quantity, skuLabel: '' };
              });

              // Set quantities from the linked products
              variantQuantities[variantId] = Object.fromEntries(
                variantProducts[variantId].map(p => [
                  p.variantId ? `${p.productId}-${p.variantId}` : p.value.toString(),
                  p.quantity
                ])
              );
            }
          });

          console.log('Processed variant data:', {
            variantData,
            variantQuantities,
            variantProducts
          });

          setVariantLinkedProducts(variantProducts);
          setVariantProductQuantities(variantQuantities);
          setVariantOverridePrices(variantOverrides);

          // Set isBundle based on whether any variant is a bundle
          setIsBundle(Object.values(variantData).some(isBundle => isBundle));
        } else {
          // For products without variants, fetch product metafields
          const res = await fetch(`/api/productAppExtension/${productId}/metafields?context=${encodeURIComponent(context)}`);
          const data = await res.json();
          console.log('Product metafields data:', data);

          if (res.ok) {
            setIsBundle(data.isBundle);
            setOverridePrice(data.overridePrice ?? null);

            // Map products with their quantities
            const mappedProducts = data.linkedProductIds.map((linkedProduct) => {
              // Handle both old format (just ID) and new format (object with productId and variantId)
              const id = typeof linkedProduct === 'object' ? linkedProduct.variantId || linkedProduct.productId : linkedProduct;
              const quantity = typeof linkedProduct === 'object' ? linkedProduct.quantity : 1;

              // First try to find a product with this variant ID
              const productWithVariant = products.find(p =>
                p.variants && p.variants.some(v => v.id === id)
              );

              if (productWithVariant) {
                const variant = productWithVariant.variants.find(v => v.id === id);

                return {
                  value: id,
                  label: `${productWithVariant.label} [${variant.option_values.map(ov => ov.label).join(' - ')}]`,
                  sku: variant.sku,
                  skuLabel: variant.sku,
                  productId: productWithVariant.value,
                  variantId: id,
                  quantity: quantity
                };
              }

              // Fallback to finding by product ID
              const match = products.find(p => p.value === id);
              const product = match ?? { value: id, label: `Product ${id}` };

              return { ...product, quantity, skuLabel: (product as any).sku };
            });

            // Set quantities from the mapped products
            const quantities = Object.fromEntries(
              mappedProducts.map(p => [
                p.variantId ? `${p.productId}-${p.variantId}` : p.value.toString(),
                p.quantity
              ])
            );

            setProductQuantities(quantities);
            console.log('Mapped products for table:', mappedProducts);
            setLinkedProducts(mappedProducts);
          } else {
            console.warn('Failed to load metafields:', data.message);
          }
        }
      } catch (err) {
        console.error('Error fetching metafields:', err);
      }
    }

    fetchMetafields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, products.length, variants]);

  const handleQuantityChange = (productId, quantity) => {
    // Find the product to get its variantId
    const product = linkedProducts.find(p => p.value === productId);
    if (!product) return;

    const key = product.variantId ? `${product.productId}-${product.variantId}` : productId.toString();
    setProductQuantities(prev => ({
      ...prev,
      [key]: Math.max(1, parseInt(quantity) || 1)
    }));
  };

  const handleVariantQuantityChange = (variantId, productId, quantity) => {
    setVariantProductQuantities(prev => ({
      ...prev,
      [variantId]: {
        ...(prev[variantId] || {}),
        [`${productId}-${variantId}`]: Math.max(1, parseInt(quantity) || 1)
      }
    }));
  };

  const handleVariantRemoveProduct = (variantId, productId) => {
    setVariantLinkedProducts(prev => ({
      ...prev,
      [variantId]: (prev[variantId] || []).filter(p => p.value !== productId)
    }));
  };

  const handleVariantOverridePriceChange = (variantId: number, value: number | null) => {
    setVariantOverridePrices(prev => ({ ...prev, [variantId]: value }));
  };

  // Submit metafield data
  const handleSave = async () => {
    setSaving(true);
    try {
      const hasMultipleVariants = variants.length > 1;
      const isActuallyBundle = isBundle && (
        hasMultipleVariants
          ? Object.values(variantLinkedProducts).some(products => (products as any[]).length > 0)
          : linkedProducts.length > 0
      );

      // Update product and variant SKUs
      const updatePromises = [];

      if (hasMultipleVariants) {
        let anyVariantIsBundle = false;
        // Update each variant (do not change variant SKUs per new rules)
        for (const variant of variants) {
          // Save metafields for each variant
          const currentVariantProducts = variantLinkedProducts[variant.id] || [];
          const variantHasBundle = isBundle && currentVariantProducts.length > 0;
          if (variantHasBundle) anyVariantIsBundle = true;

          const variantMetafieldsData = {
            isBundle: variantHasBundle,
            linkedProductIds: variantHasBundle ? currentVariantProducts.map((p) => {
              const productId = p.productId || p.value;
              const key = p.variantId ? `${productId}-${p.variantId}` : productId.toString();

              return {
                productId: productId,
                variantId: p.variantId || null,
                quantity: variantProductQuantities[variant.id]?.[key] || 1
              };
            }) : []
          };

          console.log(`Saving metafields for variant ${variant.id}:`, JSON.stringify(variantMetafieldsData, null, 2));

          updatePromises.push(
            fetch(`/api/productAppExtension/${productId}/variants/${variant.id}/metafields?context=${encodeURIComponent(context)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...variantMetafieldsData,
                overridePrice: variantOverridePrices[variant.id] ?? null,
              }),
            })
          );

          if (variantHasBundle) {
            // Calculate variant stock and weight based on linked products
            const components = await Promise.all(
              currentVariantProducts.map(async (p) => {
                const compProductId = p.productId || p.value;
                const res = await fetch(`/api/products/${compProductId}?context=${encodeURIComponent(context)}`);
                if (!res.ok) {
                  console.warn(`Failed to fetch product ${compProductId}`);

                  return { availableUnits: 0, weightContribution: 0, priceContribution: 0 };
                }
                const data = await res.json();

                const key = p.variantId ? `${p.productId}-${p.variantId}` : p.value.toString();
                const qty = variantProductQuantities[variant.id]?.[key] || 1;

                if (data.variants && data.variants.length > 0 && p.variantId) {
                  const variantRes = await fetch(`/api/products/${compProductId}/variants/${p.variantId}?context=${encodeURIComponent(context)}`);
                  if (!variantRes.ok) {
                    console.warn(`Failed to fetch variant ${p.variantId} of product ${compProductId}`);

                    return { availableUnits: 0, weightContribution: 0, priceContribution: 0 };
                  }
                  const variantData = await variantRes.json();

                  return {
                    availableUnits: Math.floor((variantData.inventory_level ?? 0) / qty),
                    weightContribution: (variantData.weight ?? 0) * qty,
                    priceContribution: (variantData.price ?? 0) * qty,
                  };
                }

                return {
                  availableUnits: Math.floor((data.inventory_level ?? 0) / qty),
                  weightContribution: (data.weight ?? 0) * qty,
                  priceContribution: (data.price ?? 0) * qty,
                };
              })
            );

            const minStock = Math.min(...components.map(c => c.availableUnits));
            const totalWeight = components.reduce((sum, c) => sum + c.weightContribution, 0);
            const calculatedPrice = components.reduce((sum, c) => sum + c.priceContribution, 0);
            const finalPrice = variantOverridePrices[variant.id] != null ? variantOverridePrices[variant.id] : calculatedPrice;
            updatePromises.push(
              fetch(`/api/products/${productId}/variants/${variant.id}?context=${encodeURIComponent(context)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  inventory_level: minStock,
                  weight: totalWeight,
                  price: finalPrice,
                }),
              })
            );
          }
        }
        // Update main product SKU (add/remove BUN- prefix) when product has variants
        const currentProductSku = product?.sku || '';
        const hasBunPrefixOnProduct = currentProductSku.startsWith('BUN-');
        let newProductSku = currentProductSku;

        if (anyVariantIsBundle && !hasBunPrefixOnProduct) {
          newProductSku = `BUN-${currentProductSku}`;
        } else if (!anyVariantIsBundle && hasBunPrefixOnProduct) {
          newProductSku = currentProductSku.replace('BUN-', '');
        }

        if (newProductSku !== currentProductSku) {
          updatePromises.push(
            fetch(`/api/products/${productId}?context=${encodeURIComponent(context)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sku: newProductSku }),
            })
          );
        }
      } else {
        // For products without variants, save at product level
        const metafieldsData = {
          isBundle: isActuallyBundle,
          linkedProductIds: linkedProducts.map((p) => {
            // Ensure we have both productId and variantId
            const productId = p.productId || p.value;
            const key = p.variantId ? `${productId}-${p.variantId}` : productId.toString();

            return {
              productId: productId,
              variantId: p.variantId || null,
              quantity: productQuantities[key] || 1
            };
          })
        } as any;

        metafieldsData.overridePrice = overridePrice ?? null;

        console.log('Saving metafields for main product:', JSON.stringify(metafieldsData, null, 2));

        updatePromises.push(
          fetch(`/api/productAppExtension/${productId}/metafields?context=${encodeURIComponent(context)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metafieldsData),
          })
        );

        const updateData: any = {};

        if (isActuallyBundle) {
          const components = await Promise.all(
            linkedProducts.map(async (p) => {
              // Use productId for fetching the product, not the variant ID
              const compProductId = p.productId || p.value;
              const res = await fetch(`/api/products/${compProductId}?context=${encodeURIComponent(context)}`);
              if (!res.ok) {
                console.warn(`Failed to fetch product ${compProductId}`);

                return { availableUnits: 0, weightContribution: 0, priceContribution: 0 };
              }
              const data = await res.json();

              if (data.variants && data.variants.length > 0 && p.variantId) {
                const variantRes = await fetch(`/api/products/${compProductId}/variants/${p.variantId}?context=${encodeURIComponent(context)}`);
                if (!variantRes.ok) {
                  console.warn(`Failed to fetch variant ${p.variantId} of product ${compProductId}`);

                  return { availableUnits: 0, weightContribution: 0, priceContribution: 0 };
                }
                const variantData = await variantRes.json();
                const key = `${compProductId}-${p.variantId}`;
                const qty = productQuantities[key] || 1;

                return {
                  availableUnits: Math.floor((variantData.inventory_level ?? 0) / qty),
                  weightContribution: (variantData.weight ?? 0) * qty,
                  priceContribution: (variantData.price ?? 0) * qty,
                };
              }

              const key = p.variantId ? `${compProductId}-${p.variantId}` : compProductId.toString();
              const qty = productQuantities[key] || 1;

              return {
                availableUnits: Math.floor((data.inventory_level ?? 0) / qty),
                weightContribution: (data.weight ?? 0) * qty,
                priceContribution: (data.price ?? 0) * qty,
              };
            })
          );

          const minStock = Math.min(...components.map(c => c.availableUnits));
          const totalWeight = components.reduce((sum, c) => sum + c.weightContribution, 0);
          const calculatedPrice = components.reduce((sum, c) => sum + c.priceContribution, 0);
          const finalPrice = overridePrice != null ? overridePrice : calculatedPrice;
          updateData.inventory_level = minStock;
          updateData.inventory_tracking = "product";
          updateData.weight = totalWeight;
          updateData.price = finalPrice;
          updateData.is_visible = true;
        } else {
          updateData.inventory_tracking = "none";
          updateData.inventory_level = null;
        }

        updatePromises.push(
          fetch(`/api/products/${productId}?context=${encodeURIComponent(context)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData),
          })
        );
      }

      await Promise.all(updatePromises);

      if (isActuallyBundle) {
        alertsManager.add({
          messages: [{ text: `Product saved as a bundle${hasMultipleVariants ? ' (variant-level)' : ''}.` }],
          type: 'success',
          onClose: () => null,
        });
      } else {
        alertsManager.add({
          messages: [{ text: 'Product saved as a regular product (not a bundle).' }],
          type: 'success',
          onClose: () => null,
        });
      }

      // Refresh the page to reflect latest state (preserve query params)
      setTimeout(() => {
        router.replace({ pathname: router.pathname, query: router.query });
      }, 300);
    } catch (err) {
      console.error('Save error:', err);
      alertsManager.add({
        messages: [{ text: 'Failed to save changes.' }],
        type: 'error',
        onClose: () => null,
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || isProductsLoading) return <Loading />;
  if (error || productsError) return <ErrorMessage error={error || productsError} />;

  return (
    <>
      <BundleSettingsPanel
        header={name}
        isBundle={isBundle}
        onBundleToggle={() => setIsBundle(prev => !prev)}
        combinedOptions={combinedOptions}
        selectedItem={selectedItem}
        onItemSelect={handleItemSelect}
        linkedProducts={linkedProducts}
        products={products}
        productQuantities={productQuantities}
        onQuantityChange={handleQuantityChange}
        onRemoveProduct={(productId) => setLinkedProducts(linkedProducts.filter(p => p.value !== productId))}
        onSave={handleSave}
        saving={saving}
        variants={variants}
        selectedVariant={selectedVariant}
        onVariantSelect={setSelectedVariant}
        variantLinkedProducts={variantLinkedProducts}
        variantProductQuantities={variantProductQuantities}
        onVariantQuantityChange={handleVariantQuantityChange}
        onVariantRemoveProduct={handleVariantRemoveProduct}
        overridePrice={overridePrice}
        onOverridePriceChange={setOverridePrice}
        variantOverridePrices={variantOverridePrices}
        onVariantOverridePriceChange={handleVariantOverridePriceChange}
      />
    </>
  );
};

export default ProductAppExtension;
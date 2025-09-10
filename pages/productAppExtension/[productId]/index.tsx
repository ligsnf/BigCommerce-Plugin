import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import BundleSettingsPanel from '@components/BundleSettingsPanel';
import ErrorMessage from '@components/error';
import Loading from '@components/loading';
import { alertsManager } from '@lib/alerts';
import { useProductInfo, useProductList } from '@lib/hooks';

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
  const [metafieldsLoading, setMetafieldsLoading] = useState<boolean>(true);
  const [wasBundleOnLoad, setWasBundleOnLoad] = useState<boolean>(false);

  // Fetch bundles (by metafields) to exclude them from selection
  useEffect(() => {
    async function fetchBundles() {
      try {
        const res = await fetch(`/api/bundles/list?context=${encodeURIComponent(context)}`);
        if (!res.ok) {
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
        // Error fetching bundles list
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
      if (!productId || products.length === 0) {
        setMetafieldsLoading(false);

        return;
      }

      try {
        setMetafieldsLoading(true);
        const hasMultipleVariants = variants.length > 1;

        if (hasMultipleVariants) {
          // Fetch metafields for each variant
          const variantMetafieldsPromises = variants.map(async (variant) => {
            const cacheKey = `variant:metafields:${productId}:${variant.id}:${context}`;
            const cached = (() => {
              try { 
                
                return JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { return null; }
            })();
            if (cached && cached.expiresAt > Date.now()) {

              return cached.value;
            }
            const res = await fetch(`/api/productAppExtension/${productId}/variants/${variant.id}/metafields?context=${encodeURIComponent(context)}`);
            if (!res.ok) {

              return null;
            }
            const json = await res.json();
            try { 
              localStorage.setItem(cacheKey, JSON.stringify({ value: json, expiresAt: Date.now() + 120000 })); 
            } catch {
              // Ignore localStorage errors
            }

            return json;
          });

          const variantMetafieldsResults = await Promise.all(variantMetafieldsPromises);

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


          setVariantLinkedProducts(variantProducts);
          setVariantProductQuantities(variantQuantities);
          setVariantOverridePrices(variantOverrides);

          // Set isBundle based on whether any variant is a bundle
          const anyVariantBundle = Object.values(variantData).some(isBundle => isBundle);
          setIsBundle(anyVariantBundle);
          setWasBundleOnLoad(anyVariantBundle);
        } else {
          // For products without variants, fetch product metafields
          const cacheKey = `product:metafields:${productId}:${context}`;
          const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { return null; } })();
          let data;
          let ok = true;
          if (cached && cached.expiresAt > Date.now()) {
            data = cached.value;
          } else {
            const response = await fetch(`/api/productAppExtension/${productId}/metafields?context=${encodeURIComponent(context)}`);
            ok = response.ok;
            data = await response.json();
            try { 
              localStorage.setItem(cacheKey, JSON.stringify({ value: data, expiresAt: Date.now() + 120000 })); 
            } catch {
              // Ignore localStorage errors
            }
          }

          if (ok) {
            setIsBundle(data.isBundle);
            setWasBundleOnLoad(Boolean(data.isBundle));
            setOverridePrice(data.overridePrice ?? null);

            // Map products with their quantities (distinguish productId vs variantId reliably)
            const mappedProducts = data.linkedProductIds.map((linkedProduct) => {
              if (typeof linkedProduct === 'object' && linkedProduct !== null) {
                const pid = linkedProduct.productId;
                const vid = linkedProduct.variantId ?? null;
                const qty = linkedProduct.quantity ?? 1;

                if (vid) {
                  // Variant-linked item
                  const productWithVariant = products.find(p => p.variants && p.variants.some(v => v.id === vid));
                  if (productWithVariant) {
                    const variant = productWithVariant.variants.find(v => v.id === vid);
                    
                    return {
                      value: vid,
                      label: `${productWithVariant.label} [${variant.option_values.map(ov => ov.label).join(' - ')}]`,
                      sku: variant.sku,
                      skuLabel: variant.sku,
                      productId: productWithVariant.value,
                      variantId: vid,
                      quantity: qty
                    };
                  }

                  return { value: pid, label: `Product ${pid}`, productId: pid, variantId: vid, quantity: qty, skuLabel: '' };
                }

                // Product-linked item (no variantId)
                const match = products.find(p => p.value === pid);
                const product = match ?? { value: pid, label: `Product ${pid}`, sku: '' };

                return { ...product, value: pid, variantId: null, quantity: qty, skuLabel: (product as any).sku };
              }

              // Old format: just a productId number
              const pid = linkedProduct as number;
              const match = products.find(p => p.value === pid);
              const product = match ?? { value: pid, label: `Product ${pid}`, sku: '' };

              return { ...product, value: pid, variantId: null, quantity: 1, skuLabel: (product as any).sku };
            });

            // Set quantities from the mapped products
            const quantities = Object.fromEntries(
              mappedProducts.map(p => [
                p.variantId ? `${p.productId}-${p.variantId}` : p.value.toString(),
                p.quantity
              ])
            );

            setProductQuantities(quantities);
            setLinkedProducts(mappedProducts);
          }
        }
      } catch (err) {
        // Error fetching metafields
      } finally {
        setMetafieldsLoading(false);
      }
    }

    fetchMetafields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, products.length, variants]);


  // Helper to toggle bundle status
  const handleBundleToggle = () => {
    setIsBundle(prev => !prev);
  };

  // Helper to get SKUs from linked products
  const getSkusFromLinkedProducts = async (linkedProducts: any[]) => {
    const skus: string[] = [];
    
    for (const p of linkedProducts) {
      const compProductId = p.productId || p.value;
      try {
        const res = await fetch(`/api/products/${compProductId}?context=${encodeURIComponent(context)}`);
        if (res.ok) {
          const data = await res.json();
          
          if (data.variants && data.variants.length > 0 && p.variantId) {
            // Get variant SKU
            const variantRes = await fetch(`/api/products/${compProductId}/variants/${p.variantId}?context=${encodeURIComponent(context)}`);
            if (variantRes.ok) {
              const variantData = await variantRes.json();
              if (variantData.sku) {
                skus.push(variantData.sku);
              }
            }
          } else {
            // Get product SKU
            if (data.sku) {
              skus.push(data.sku);
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching SKU for product ${compProductId}:`, error);
      }
    }
    
    return skus;
  };

  const handleQuantityChange = (productId, quantity) => {
    // Find the product to get its variantId
    const product = linkedProducts.find(p => p.value === productId);
    if (!product) 
      
      return;

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
        let firstBundleVariantPrice: number | null = null;
        let firstBundleVariantWeight: number | null = null;
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


          updatePromises.push(
            fetch(`/api/productAppExtension/${productId}/variants/${variant.id}/metafields?context=${encodeURIComponent(context)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...variantMetafieldsData,
                overridePrice: variantHasBundle ? (variantOverridePrices[variant.id] ?? null) : null,
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
                  return { availableUnits: 0, weightContribution: 0, priceContribution: 0 };
                }
                const data = await res.json();

                const key = p.variantId ? `${p.productId}-${p.variantId}` : p.value.toString();
                const qty = variantProductQuantities[variant.id]?.[key] || 1;

                if (data.variants && data.variants.length > 0 && p.variantId) {
                  const variantRes = await fetch(`/api/products/${compProductId}/variants/${p.variantId}?context=${encodeURIComponent(context)}`);
                  if (!variantRes.ok) {
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
            if (firstBundleVariantPrice == null) {
              firstBundleVariantPrice = finalPrice;
            }
            if (firstBundleVariantWeight == null) {
              firstBundleVariantWeight = totalWeight;
            }
            // Get SKUs from linked products for this variant bundle
            const variantSkus = await getSkusFromLinkedProducts(currentVariantProducts);
            const newVariantSku = variantSkus.length > 0 ? variantSkus.join(' & ') : variant.sku;

            updatePromises.push(
              fetch(`/api/products/${productId}/variants/${variant.id}?context=${encodeURIComponent(context)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  inventory_level: minStock,
                  weight: totalWeight,
                  price: finalPrice,
                  sku: newVariantSku,
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

        // Set parent product price/weight to the first bundle variant's values
        if (firstBundleVariantPrice != null || firstBundleVariantWeight != null) {
          const parentUpdate: any = {};
          if (firstBundleVariantPrice != null) parentUpdate.price = firstBundleVariantPrice;
          if (firstBundleVariantWeight != null) parentUpdate.weight = firstBundleVariantWeight;
          updatePromises.push(
            fetch(`/api/products/${productId}?context=${encodeURIComponent(context)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(parentUpdate),
            })
          );
        }

        // Ensure product has/doesn't have the 'Bundle' category based on variant bundles
        try {
          const shouldHaveBundleCategory = anyVariantIsBundle;
          const ensureRes = await fetch(`/api/categories/ensure-bundle?context=${encodeURIComponent(context)}`);
          if (ensureRes.ok) {
            const { id: bundleCategoryId } = await ensureRes.json();
            const prodRes = await fetch(`/api/products/${productId}?context=${encodeURIComponent(context)}`);
            if (prodRes.ok) {
              const prodData = await prodRes.json();
              const currentCats: number[] = Array.isArray(prodData.categories) ? prodData.categories : [];
              const hasBundle = currentCats.includes(bundleCategoryId);
              let nextCats = currentCats;
              if (shouldHaveBundleCategory && !hasBundle) {
                nextCats = [...currentCats, bundleCategoryId];
              } else if (!shouldHaveBundleCategory && hasBundle) {
                nextCats = currentCats.filter((c) => c !== bundleCategoryId);
              }
              if (nextCats !== currentCats) {
                updatePromises.push(
                  fetch(`/api/products/${productId}?context=${encodeURIComponent(context)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ categories: nextCats }),
                  })
                );
              }
            }
          }
        } catch (e) {
          // Failed to ensure/update Bundle category for product with variants
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

        metafieldsData.overridePrice = isActuallyBundle ? (overridePrice ?? null) : null;


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
                return { availableUnits: 0, weightContribution: 0, priceContribution: 0 };
              }
              const data = await res.json();

              if (data.variants && data.variants.length > 0 && p.variantId) {
                const variantRes = await fetch(`/api/products/${compProductId}/variants/${p.variantId}?context=${encodeURIComponent(context)}`);
                if (!variantRes.ok) {
                  return { availableUnits: 0, weightContribution: 0, priceContribution: 0 };
                }
                const variantData = await variantRes.json();
                const key = `${compProductId}-${p.variantId}`;
                const qty = productQuantities[key] || 1;

                // Use variant's weight/price, but fall back to product's if variant fields are null/undefined
                const unitWeight = (variantData.weight != null ? variantData.weight : (data.weight ?? 0));
                const unitPrice = (variantData.price != null ? variantData.price : (data.price ?? 0));

                return {
                  availableUnits: Math.floor((variantData.inventory_level ?? 0) / qty),
                  weightContribution: unitWeight * qty,
                  priceContribution: unitPrice * qty,
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
          
          // Get SKUs from linked products for this non-variant bundle
          const bundleSkus = await getSkusFromLinkedProducts(linkedProducts);
          const newBundleSku = bundleSkus.length > 0 ? bundleSkus.join(' & ') : product?.sku;
          
          updateData.inventory_level = minStock;
          updateData.inventory_tracking = "product";
          updateData.weight = totalWeight;
          updateData.price = finalPrice;
          updateData.sku = newBundleSku;
          updateData.is_visible = true;
          // Ensure product has the 'Bundle' category
          try {
            const ensureRes = await fetch(`/api/categories/ensure-bundle?context=${encodeURIComponent(context)}`);
            if (ensureRes.ok) {
              const { id: bundleCategoryId } = await ensureRes.json();
              const prodRes = await fetch(`/api/products/${productId}?context=${encodeURIComponent(context)}`);
              if (prodRes.ok) {
                const prodData = await prodRes.json();
                const currentCats: number[] = Array.isArray(prodData.categories) ? prodData.categories : [];
                if (!currentCats.includes(bundleCategoryId)) {
                  updateData.categories = [...currentCats, bundleCategoryId];
                }
              }
            }
          } catch (e) {
            // Failed to ensure/add Bundle category for product
          }
        } else {
          updateData.inventory_tracking = "none";
          updateData.inventory_level = null;
          // Remove 'Bundle' category if present when not a bundle
          try {
            const ensureRes = await fetch(`/api/categories/ensure-bundle?context=${encodeURIComponent(context)}`);
            if (ensureRes.ok) {
              const { id: bundleCategoryId } = await ensureRes.json();
              const prodRes = await fetch(`/api/products/${productId}?context=${encodeURIComponent(context)}`);
              if (prodRes.ok) {
                const prodData = await prodRes.json();
                const currentCats: number[] = Array.isArray(prodData.categories) ? prodData.categories : [];
                if (currentCats.includes(bundleCategoryId)) {
                  updateData.categories = currentCats.filter((c) => c !== bundleCategoryId);
                }
              }
            }
          } catch (e) {
            // Failed to remove Bundle category for non-bundle product
          }
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

      // Full refresh shortly after showing the success message
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          try {
            // If embedded in an iframe (e.g., BigCommerce panel), try to reload the top-level page
            if (window.top && window.top !== window) {
              window.top.location.reload();

              return;
            }
          } catch (e) {
            // Ignore cross-origin access errors and fall back to reloading this window
          }

          // Fallback: reload current window
          window.location.reload();
        }
      }, 1200);
    } catch (err) {
      alertsManager.add({
        messages: [{ text: 'Failed to save changes.' }],
        type: 'error',
        onClose: () => null,
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || isProductsLoading || metafieldsLoading) {

    return <Loading />;
  }
  if (error || productsError) {

    return <ErrorMessage error={error || productsError} />;
  }

  return (
    <>
      <BundleSettingsPanel
        header={name}
        isBundle={isBundle}
        onBundleToggle={handleBundleToggle}
        isToggleDisabled={metafieldsLoading || saving}
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
        wasBundleOnLoad={wasBundleOnLoad}
      />
    </>
  );
};

export default ProductAppExtension;
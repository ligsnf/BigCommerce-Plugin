import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ErrorMessage from '@components/error';
import Loading from '@components/loading';
import { useProductInfo } from '@lib/hooks';
import { useProductList } from '@lib/hooks';
import BasicInfoPanel from '@components/BasicInfoPanel';
import BundleSettingsPanel from '@components/BundleSettingsPanel';

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

  const { error, isLoading, product } = useProductInfo(productId);
  const { name, variants = [] } = (product ?? { variants: [] }) as Product;

  const [isBundle, setIsBundle] = useState(false);
  const [linkedProducts, setLinkedProducts] = useState([]);
  const [productQuantities, setProductQuantities] = useState({});
  const { list = [], isLoading: isProductsLoading, error: productsError } = useProductList();
  const [saving, setSaving] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [variantLinkedProducts, setVariantLinkedProducts] = useState<Record<number, any[]>>({});
  const [variantProductQuantities, setVariantProductQuantities] = useState<Record<number, Record<number, number>>>({});

  // Format available products for react-select (main products only)
  const products = list
    .filter(({ id, sku }) => {
      if (id === productId) return false;
      if (sku?.startsWith('BUN-')) return false;
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
      label: `${product.label} [${product.sku}]`,
      productId: product.value,
      sku: product.sku,
      isMainProduct: true,
      inventory_level: product.inventory_level,
      inventory_tracking: product.inventory_tracking
    });

    if (Array.isArray(product.variants) && product.variants.length > 1) {
      product.variants.forEach(variant => {
        const variantSku = variant.sku || variant.option_values?.map(ov => ov.label).join('-');
        if (variantSku) {
          const variantName = variant.option_values?.map(ov => ov.label).join(' - ') || 'Variant';
          acc.push({
            value: `sku-${variantSku}`,
            label: `${product.label} [${variantName}] [${variantSku}]`,
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
      alert("This product/variant cannot be added to bundles because it has inventory tracking disabled.");
      setSelectedItem(null);
      return;
    }

    const newProduct = {
      ...product,
      selectedSku: selectedItem.sku,
      skuLabel: selectedItem.sku,
      label: selectedItem.label,
      inventory_tracking: product.inventory_tracking
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
          [product.value]: 1
        }
      }));
    } else {
      // Add to main product bundle
    setLinkedProducts([...linkedProducts, newProduct]);
    setProductQuantities(prev => ({
      ...prev,
      [product.value]: 1
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
        
        if (hasMultipleVariants) {
          // Fetch metafields for each variant
          const variantMetafieldsPromises = variants.map(async (variant) => {
            const res = await fetch(`/api/productAppExtension/${productId}/variants/${variant.id}/metafields`);
            if (!res.ok) {
              console.warn(`Failed to load metafields for variant ${variant.id}:`, await res.text());
              return null;
            }
            return res.json();
          });

          const variantMetafieldsResults = await Promise.all(variantMetafieldsPromises);
          
          // Process variant metafields
          const variantData = {};
          const variantQuantities = {};
          const variantProducts = {};

          variantMetafieldsResults.forEach((data, index) => {
            if (data) {
              const variantId = variants[index].id;
              variantData[variantId] = data.isBundle;
              variantQuantities[variantId] = data.productQuantities || {};
              
              // Map linked products
              variantProducts[variantId] = data.linkedProductIds.map((id) => {
                const match = products.find(p => p.value === id);
                return match ?? { value: id, label: `Product ${id}` };
              });
            }
          });

          setVariantLinkedProducts(variantProducts);
          setVariantProductQuantities(variantQuantities);
          
          // Set isBundle based on whether any variant is a bundle
          setIsBundle(Object.values(variantData).some(isBundle => isBundle));
        } else {
          // For products without variants, fetch product metafields
          const res = await fetch(`/api/productAppExtension/${productId}/metafields`);
          const data = await res.json();
    
          if (res.ok) {
            setIsBundle(data.isBundle);
            setProductQuantities(data.productQuantities || {});
            setLinkedProducts(
              data.linkedProductIds.map((id) => {
                const match = products.find(p => p.value === id);
                const product = match ?? { value: id, label: `Product ${id}` };
                if (!data.productQuantities?.[id]) {
                  setProductQuantities(prev => ({
                    ...prev,
                    [id]: 1
                  }));
                }
                return product;
              })
            );
          } else {
            console.warn('Failed to load metafields:', data.message);
          }
        }
      } catch (err) {
        console.error('Error fetching metafields:', err);
      }
    }
  
    fetchMetafields();
  }, [productId, products.length, variants]);

  const handleQuantityChange = (productId, quantity) => {
    setProductQuantities(prev => ({
      ...prev,
      [productId]: Math.max(1, parseInt(quantity) || 1)
    }));
  };

  const handleVariantQuantityChange = (variantId, productId, quantity) => {
    setVariantProductQuantities(prev => ({
      ...prev,
      [variantId]: {
        ...(prev[variantId] || {}),
        [productId]: Math.max(1, parseInt(quantity) || 1)
      }
    }));
  };

  const handleVariantRemoveProduct = (variantId, productId) => {
    setVariantLinkedProducts(prev => ({
      ...prev,
      [variantId]: (prev[variantId] || []).filter(p => p.value !== productId)
    }));
  };

  // Submit metafield data
  const handleSave = async () => {
    setSaving(true);
    try {
      const hasMultipleVariants = variants.length > 1;
      const isActuallyBundle = isBundle && (
        hasMultipleVariants
          ? Object.values(variantLinkedProducts).every(products => products.length > 0)
          : linkedProducts.length > 0
      );

      // Update product and variant SKUs
      const updatePromises = [];

      if (hasMultipleVariants) {
        // Update each variant
        for (const variant of variants) {
          const currentSku = variant.sku || '';
          const hasBunPrefix = currentSku.startsWith('BUN-');
          let newSku = currentSku;

          if (isActuallyBundle && !hasBunPrefix) {
            newSku = `BUN-${currentSku}`;
          } else if (!isActuallyBundle && hasBunPrefix) {
            newSku = currentSku.replace('BUN-', '');
          }

          // Save metafields for each variant
          const variantMetafieldsData = {
            isBundle: isActuallyBundle,
            linkedProductIds: (variantLinkedProducts[variant.id] || []).map((p) => p.value),
            productQuantities: variantProductQuantities[variant.id] || {},
            variantId: variant.id
          };

          console.log(`Saving metafields for variant ${variant.id}:`, JSON.stringify(variantMetafieldsData, null, 2));

          updatePromises.push(
            fetch(`/api/productAppExtension/${productId}/variants/${variant.id}/metafields`, {
        method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(variantMetafieldsData),
            })
          );

          if (newSku !== currentSku) {
            updatePromises.push(
              fetch(`/api/products/${productId}/variants/${variant.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sku: newSku,
                  inventory_tracking: isActuallyBundle ? "variant" : "none"
                }),
              })
            );
          }

          if (isActuallyBundle && variantLinkedProducts[variant.id]) {
            // Calculate variant stock based on linked products
            const stockLevels = await Promise.all(
              variantLinkedProducts[variant.id].map(async (p) => {
                const res = await fetch(`/api/products/${p.value}`);
                if (!res.ok) {
                  console.warn(`Failed to fetch stock for product ${p.value}`);
                  return 0;
                }
                const data = await res.json();
                return Math.floor((data.inventory_level ?? 0) / (variantProductQuantities[variant.id]?.[p.value] || 1));
              })
            );
            
            const minStock = Math.min(...stockLevels);
            updatePromises.push(
              fetch(`/api/products/${productId}/variants/${variant.id}`, {
                method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
                  inventory_level: minStock
                }),
              })
            );
          }
        }
      } else {
        // For products without variants, save at product level
        const metafieldsData = {
          isBundle: isActuallyBundle,
          linkedProductIds: linkedProducts.map((p) => p.value),
          productQuantities
        };

        console.log('Saving metafields for main product:', JSON.stringify(metafieldsData, null, 2));

        updatePromises.push(
          fetch(`/api/productAppExtension/${productId}/metafields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metafieldsData),
          })
        );

        // Update main product
      const currentSku = product?.sku || '';
      const hasBunPrefix = currentSku.startsWith('BUN-');
      let newSku = currentSku;

      if (isActuallyBundle && !hasBunPrefix) {
        newSku = `BUN-${currentSku}`;
      } else if (!isActuallyBundle && hasBunPrefix) {
        newSku = currentSku.replace('BUN-', '');
      }

      let updateData: any = {};
      
      if (newSku !== currentSku) {
        updateData.sku = newSku;
      }

      if (isActuallyBundle) {
        const stockLevels = await Promise.all(
          linkedProducts.map(async (p) => {
            const res = await fetch(`/api/products/${p.value}`);
            if (!res.ok) {
              console.warn(`Failed to fetch stock for product ${p.value}`);
              return 0;
            }
            const data = await res.json();
            return Math.floor((data.inventory_level ?? 0) / (productQuantities[p.value] || 1));
          })
        );
        
        const minStock = Math.min(...stockLevels);
        updateData.inventory_level = minStock;
        updateData.inventory_tracking = "product";
        updateData.is_visible = true;
      } else {
        updateData.inventory_tracking = "none";
        updateData.inventory_level = null;
      }

        updatePromises.push(
          fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
          })
        );
      }

      await Promise.all(updatePromises);

      if (isActuallyBundle) {
        alert(`Product has been saved as a bundle${hasMultipleVariants ? ' with variant-level bundling' : ''}.`);
      } else {
        alert('Product has been saved as a regular product (not a bundle).');
      }
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || isProductsLoading) return <Loading />;
  if (error || productsError) return <ErrorMessage error={error || productsError} />;

  return (
    <>
      <BasicInfoPanel name={name} />
      <BundleSettingsPanel
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
      />
    </>
  );
};

export default ProductAppExtension;

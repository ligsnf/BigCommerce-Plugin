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
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({});
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
            const res = await fetch(`/api/productAppExtension/${productId}/variants/${variant.id}/metafields`);
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

          variantMetafieldsResults.forEach((data, index) => {
            if (data) {
              const variantId = variants[index].id;
              variantData[variantId] = data.isBundle;
              
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
                return match ? { ...match, quantity } : { value: productId, label: `Product ${productId}`, quantity };
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
          
          // Set isBundle based on whether any variant is a bundle
          setIsBundle(Object.values(variantData).some(isBundle => isBundle));
        } else {
          // For products without variants, fetch product metafields
          const res = await fetch(`/api/productAppExtension/${productId}/metafields`);
          const data = await res.json();
          console.log('Product metafields data:', data);
    
          if (res.ok) {
            setIsBundle(data.isBundle);
            
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
              return { ...product, quantity };
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
            linkedProductIds: isActuallyBundle ? (variantLinkedProducts[variant.id] || []).map((p) => {
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
                
                // If the product has variants and we have a variant ID, get the specific variant's stock
                if (data.variants && data.variants.length > 0 && p.variantId) {
                  const variantRes = await fetch(`/api/products/${p.value}/variants/${p.variantId}`);
                  if (!variantRes.ok) {
                    console.warn(`Failed to fetch stock for variant ${p.variantId} of product ${p.value}`);
                    return 0;
                  }
                  const variantData = await variantRes.json();
                  const key = `${p.productId}-${p.variantId}`;
                  return Math.floor((variantData.inventory_level ?? 0) / (productQuantities[key] || 1));
                }
                
                // For non-variant products or if we don't have a variant ID, use the product's stock
                const key = p.variantId ? `${p.productId}-${p.variantId}` : p.value.toString();
                return Math.floor((data.inventory_level ?? 0) / (productQuantities[key] || 1));
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
            // Use productId for fetching the product, not the variant ID
            const productId = p.productId || p.value;
            const res = await fetch(`/api/products/${productId}`);
            if (!res.ok) {
              console.warn(`Failed to fetch stock for product ${productId}`);
              return 0;
            }
            const data = await res.json();
            
            // If the product has variants and we have a variant ID, get the specific variant's stock
            if (data.variants && data.variants.length > 0 && p.variantId) {
              const variantRes = await fetch(`/api/products/${productId}/variants/${p.variantId}`);
              if (!variantRes.ok) {
                console.warn(`Failed to fetch stock for variant ${p.variantId} of product ${productId}`);
                return 0;
              }
              const variantData = await variantRes.json();
              const key = `${productId}-${p.variantId}`;
              return Math.floor((variantData.inventory_level ?? 0) / (productQuantities[key] || 1));
            }
            
            // For non-variant products or if we don't have a variant ID, use the product's stock
            const key = p.variantId ? `${productId}-${p.variantId}` : productId.toString();
            return Math.floor((data.inventory_level ?? 0) / (productQuantities[key] || 1));
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

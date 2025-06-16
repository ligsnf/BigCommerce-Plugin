import { Box, H4, Small, Text } from '@bigcommerce/big-design';
import styled from 'styled-components';

export interface Product {
  name: string;
  sku: string;
  stock: number;
  price: number;
}

interface ProductCardProps {
  bundleName: string;
  products: Product[];
  onClick?: () => void;
}

const ProductCard = ({ bundleName, products, onClick }: ProductCardProps) => {
  // Ensure products is an array
  const safeProducts = Array.isArray(products) ? products : [];
  
  const totalPrice = safeProducts.reduce((sum, p) => sum + p.price, 0);
  const minStock = safeProducts.length > 0 ? Math.min(...safeProducts.map(p => p.stock)) : 0;

  return (
    <StyledBox border="box" borderRadius="normal" padding="medium" onClick={onClick}>
      <H4 marginBottom="xxSmall">{bundleName}</H4>
      <Text as="span"><Small>SKUs:</Small> {safeProducts.map(p => p.sku).join(', ')}</Text>
      <Text as="span"><Small>Available Stock:</Small> {minStock}</Text>
      <Text as="span"><Small>Total Price:</Small> ${totalPrice.toFixed(2)}</Text>
    </StyledBox>
  );
};

const StyledBox = styled(Box)`
  width: 250px;
  min-height: 160px;
  cursor: pointer;
  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 0 0 3px #ccd;
  }
`;

export default ProductCard;

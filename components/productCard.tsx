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
  const totalPrice = products.reduce((sum, p) => sum + p.price, 0);
  const minStock = Math.min(...products.map(p => p.stock));

  return (
    <StyledBox border="box" padding="medium" onClick={onClick}>
      <H4 marginBottom="xxSmall">{bundleName}</H4>
      <Text><Small>SKUs:</Small> {products.map(p => p.sku).join(', ')}</Text>
      <Text><Small>Available Stock:</Small> {minStock}</Text>
      <Text><Small>Total Price:</Small> ${totalPrice.toFixed(2)}</Text>
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

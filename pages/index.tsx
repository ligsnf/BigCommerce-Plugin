import { Box, Flex, H1, H4, Panel } from '@bigcommerce/big-design';
import styled from 'styled-components';
import ErrorMessage from '../components/error';
import Loading from '../components/loading';
import ProductCard from '../components/productCard';
import { useProducts } from '../lib/hooks';

const Index = () => {
    const { error, isLoading, summary } = useProducts();

    if (isLoading) return <Loading />;
    if (error) return <ErrorMessage error={error} />;

    return (
        <Panel header="Homepage" id="home">
            <Flex marginBottom="medium">
                <StyledBox border="box" borderRadius="normal" marginRight="xLarge" padding="medium">
                    <H4>Inventory count</H4>
                    <H1 marginBottom="none">{summary.inventory_count}</H1>
                </StyledBox>
                <StyledBox border="box" borderRadius="normal" marginRight="xLarge" padding="medium">
                    <H4>Variant count</H4>
                    <H1 marginBottom="none">{summary.variant_count}</H1>
                </StyledBox>
                <StyledBox border="box" borderRadius="normal" padding="medium">
                    <H4>Primary category</H4>
                    <H1 marginBottom="none">{summary.primary_category_name}</H1>
                </StyledBox>
            </Flex>
            <ProductCard
                bundleName="Aussie Spirit + Travel Set"
                products={[
                    { name: 'Aussie Spirit Chess Set', sku: 'AUS-DR', stock: 2, price: 349.00 },
                    { name: 'Magnetic Travel 3-in-1 Set', sku: 'L38810DR', stock: 6, price: 39.00 }
                ]}
            />
        </Panel>
    );
};

const StyledBox = styled(Box)`
    min-width: 10rem;
`;

export default Index;

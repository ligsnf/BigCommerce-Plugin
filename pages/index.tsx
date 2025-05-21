import { Box, Flex, H1, H4, Panel, Button, Text } from '@bigcommerce/big-design';
import styled from 'styled-components';
import ErrorMessage from '../components/error';
import Loading from '../components/loading';
import { useBundles } from '../lib/hooks/use-bundles';
import { BundleQuantities } from '../components/BundleQuantities';

const Index = () => {
    const { bundles, isLoading, error, refetch } = useBundles();

    if (isLoading) return <Loading />;
    if (error) return <ErrorMessage error={error} />;

    if (bundles.length === 0) {
        return (
            <Panel>
                <Text>No bundle products found. Create a bundle product first.</Text>
            </Panel>
        );
    }

    return (
        <>
            <Panel header="Bundle Products">
                <Flex justifyContent="flex-end" marginBottom="medium">
                    <Button
                        variant="secondary"
                        onClick={refetch}
                    >
                        Refresh Bundles
                    </Button>
                </Flex>

                {bundles.map(bundle => (
                    <Box 
                        key={bundle.id} 
                        marginBottom="large" 
                        border="box" 
                        borderRadius="normal" 
                        padding="medium"
                    >
                        <H4>Bundle: {bundle.name}</H4>
                        <Text>ID: {bundle.id}</Text>
                        
                        <BundleQuantities
                            bundleId={bundle.id}
                            linkedProductIds={bundle.linkedProductIds}
                            initialQuantities={bundle.quantities}
                        />
                    </Box>
                ))}
            </Panel>
        </>
    );
};

const StyledBox = styled(Box)`
    min-width: 10rem;
`;

export default Index;

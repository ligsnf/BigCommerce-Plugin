import { Box, Button, Flex, H4, Panel, Text } from '@bigcommerce/big-design';
import { BundleQuantities } from '../components/BundleQuantities';
import ErrorMessage from '../components/error';
import Loading from '../components/loading';
import { useBundles } from '../lib/hooks/use-bundles';

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

export default Index;

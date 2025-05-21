import { useState, useEffect } from 'react';
import { Panel, FormGroup, Input, Button, Small, Box, Text, Flex, Form as BigDesignForm } from '@bigcommerce/big-design';
import { useRouter } from 'next/router';

interface BundleQuantitiesProps {
  bundleId: number;
  linkedProductIds: number[];
  initialQuantities?: number[];
}

export const BundleQuantities: React.FC<BundleQuantitiesProps> = ({ 
  bundleId, 
  linkedProductIds,
  initialQuantities = []
}) => {
  const [quantities, setQuantities] = useState<number[]>(
    initialQuantities.length ? initialQuantities : linkedProductIds.map(() => 1)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleQuantityChange = (index: number, value: string) => {
    const newQuantities = [...quantities];
    newQuantities[index] = parseInt(value) || 0;
    setQuantities(newQuantities);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/bundles/update-quantities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bundleId,
          quantities
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update quantities');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel header="Bundle Product Quantities">
      <form onSubmit={handleSubmit}>
        {linkedProductIds.map((productId, index) => (
          <Box key={productId}>
            <Text>Product ID: {productId}</Text>
            <Input
              type="number"
              min="1"
              value={quantities[index]}
              onChange={(e) => handleQuantityChange(index, e.target.value)}
            />
          </Box>
        ))}

        <Box marginTop="medium">
          <Flex>
            <Button
              type="submit"
              isLoading={loading}
              marginRight="small"
            >
              Update Quantities
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.reload()}
              isLoading={loading}
            >
              Refresh Page
            </Button>
          </Flex>
        </Box>

        {error && (
          <Box marginTop="small">
            <Text color="danger">{error}</Text>
          </Box>
        )}

        {success && (
          <Box marginTop="small">
            <Text color="success">Quantities updated successfully!</Text>
          </Box>
        )}
      </form>
    </Panel>
  );
}; 
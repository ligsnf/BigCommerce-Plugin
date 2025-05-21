import { useEffect, useState } from 'react';

interface BundleProduct {
  id: number;
  name: string;
  linkedProductIds: number[];
  quantities: number[];
}

export const useBundles = () => {
  const [bundles, setBundles] = useState<BundleProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchBundles = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/bundles');
      if (!response.ok) {
        throw new Error('Failed to fetch bundles');
      }
      const data = await response.json();
      setBundles(data);
    } catch (err: any) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBundles();
  }, []);

  return { bundles, isLoading, error, refetch: fetchBundles };
}; 
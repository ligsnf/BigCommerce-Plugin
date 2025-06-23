import Index from '@pages/index';
import { render, screen, waitFor } from '@test/utils';

jest.mock('@lib/hooks/use-bundles', () => require('@mocks/hooks'));

// Mock the session context
jest.mock('../../context/session', () => ({
    useSession: () => ({
        context: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjb250ZXh0IjoidGVzdC1zdG9yZS1oYXNoIn0.test-signature'
    })
}));

// Mock the fetch API
global.fetch = jest.fn();

describe('Homepage', () => {
    beforeEach(() => {
        // Reset the mock before each test
        (fetch as jest.Mock).mockClear();
    });

    test('renders correctly', async () => {
        // Mock the API response
        (fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                products: [
                    { id: 1, name: 'Product 1', sku: 'SKU1', variants: [] },
                    { id: 2, name: 'Product 2', sku: 'SKU2', variants: [] }
                ],
                bundles: [
                    { id: 1, name: 'Bundle 1', sku: 'BUNDLE1', isVariant: false, productCount: 2 },
                    { id: 2, name: 'Bundle 2', sku: 'BUNDLE2', isVariant: true, variantName: 'Variant', productCount: 3 }
                ]
            })
        });

        const { container } = render(<Index />);

        // Wait for the component to finish loading
        await waitFor(() => {
            expect(screen.getByText('Product Management')).toBeInTheDocument();
        });

        // Check for the main heading (H1)
        const mainHeading = screen.getByRole('heading', { level: 1 });
        expect(mainHeading).toBeInTheDocument();
        expect(mainHeading).toHaveTextContent('Product Management');

        // Check that the tabs are rendered
        expect(screen.getByText('Products')).toBeInTheDocument();
        expect(screen.getByText('Bundles')).toBeInTheDocument();

        // Check that the table is rendered with products
        expect(screen.getByText('Product 1')).toBeInTheDocument();
        expect(screen.getByText('Product 2')).toBeInTheDocument();

        expect(container.firstChild).toMatchSnapshot();
    });
});

import Index from '@pages/index';
import { render, screen } from '@test/utils';

jest.mock('@lib/hooks/use-bundles', () => require('@mocks/hooks'));

describe('Homepage', () => {
    test('renders correctly', () => {
        const { container } = render(<Index />);
        const headings = screen.getAllByRole('heading', { level: 4 });

        expect(container.firstChild).toMatchSnapshot();
        expect(headings).toHaveLength(2);
        expect(headings[0]).toBeInTheDocument();
        expect(headings[1]).toBeInTheDocument();
    });
});

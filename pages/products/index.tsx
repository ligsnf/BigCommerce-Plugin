/* eslint-disable no-console */
import { Button, Dropdown, Panel, Small, Table, TableSortDirection } from '@bigcommerce/big-design';
import { MoreHorizIcon } from '@bigcommerce/big-design-icons';
import { useRouter } from 'next/router';
import { ReactElement, useEffect, useState } from 'react';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { useSession } from '../../context/session';
import { useProductList } from '../../lib/hooks';
import { TableItem } from '../../types';

const Products = () => {
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [currentPage, setCurrentPage] = useState(1);
    const [columnHash, setColumnHash] = useState('');
    const [direction, setDirection] = useState<TableSortDirection>('ASC');
    const router = useRouter();
    const { context } = useSession();
    const storeHash = context ? JSON.parse(atob(context.split('.')[1])).context : null;

    useEffect(() => {
        // Log to browser console
        console.log('%c[Products Page]', 'color: #4CAF50; font-weight: bold');
        console.log('Environment:', process.env.NODE_ENV);
        console.log('Session Context:', context);
        console.log('Store Hash:', storeHash);
        console.log('Full URL:', window.location.href);
    }, [context, storeHash]);

    const { error, isLoading, list = [], meta = {} } = useProductList({
      page: String(currentPage),
      limit: String(itemsPerPage),
      ...(columnHash && { sort: columnHash }),
      ...(columnHash && { direction: direction.toLowerCase() }),
    });
    const itemsPerPageOptions = [10, 20, 50, 100];
    const tableItems: TableItem[] = list.map(({ id, inventory_level: stock, name, price }) => ({
        id,
        name,
        price,
        stock,
    }));

    const onItemsPerPageChange = newRange => {
        setCurrentPage(1);
        setItemsPerPage(newRange);
    };

    const onSort = (newColumnHash: string, newDirection: TableSortDirection) => {
        setColumnHash(newColumnHash === 'stock' ? 'inventory_level' : newColumnHash);
        setDirection(newDirection);
    };

    const renderName = (id: number, name: string): ReactElement => (
        <Button variant="subtle" onClick={() => window.open(`https://store-${storeHash}.mybigcommerce.com/manage/products/${id}/edit`, '_blank')}>
            {name}
        </Button>
    );

    const renderPrice = (price: number): string => (
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)
    );

    const renderStock = (stock: number): ReactElement => (stock > 0
        ? <Small>{stock}</Small>
        : <Small bold marginBottom="none" color="danger">0</Small>
    );

    const renderAction = (id: number): ReactElement => (
        <Dropdown
            items={[ { content: 'Edit product', onItemClick: () => router.push(`/products/${id}`), hash: 'edit' } ]}
            toggle={<Button iconOnly={<MoreHorizIcon color="secondary60" />} variant="subtle" />}
        />
    );

    if (isLoading) return <Loading />;
    if (error) return <ErrorMessage error={error} />;

    return (
        <Panel id="products">
            <Table
                columns={[
                    { header: 'Product name', hash: 'name', render: ({ id, name }) => renderName(id, name), isSortable: true },
                    { header: 'Stock', hash: 'stock', render: ({ stock }) => renderStock(stock), isSortable: true },
                    { header: 'Price', hash: 'price', render: ({ price }) => renderPrice(price), isSortable: true },
                    { header: 'Action', hideHeader: true, hash: 'id', render: ({ id }) => renderAction(id) },
                ]}
                items={tableItems}
                itemName="Products"
                pagination={{
                    currentPage,
                    totalItems: meta?.pagination?.total,
                    onPageChange: setCurrentPage,
                    itemsPerPageOptions,
                    onItemsPerPageChange,
                    itemsPerPage,
                }}
                sortable={{
                  columnHash,
                  direction,
                  onSort,
                }}
                stickyHeader
            />
        </Panel>
    );
};

export default Products;

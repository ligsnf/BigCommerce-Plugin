import { Badge, Box, Button, Dropdown, Flex, FormGroup, H1, Input, Panel, MultiSelect, Table } from '@bigcommerce/big-design';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/session';

type DiscountType = 'percent' | 'fixed';

interface DiscountRow {
  id: number;
  name: string;
  categories: string[];
  type: DiscountType;
  amount: number; // stores raw number; format per type in UI
  startDate?: string; // ISO strings for simplicity
  endDate?: string; // optional = ongoing
  status: 'Active' | 'Inactive';
}

export default function Discounts() {
  const { context } = useSession();
  // Discounts state (loaded from backend)
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [discountsLoading, setDiscountsLoading] = useState(false);
  const [discountsError, setDiscountsError] = useState<string | null>(null);

  const loadDiscounts = async () => {
    try {
      setDiscountsLoading(true);
      setDiscountsError(null);
      const res = await fetch(`/api/categories/discounts?context=${encodeURIComponent(context)}`);
      if (!res.ok) throw new Error('Failed to load discounts');
      const json = await res.json();
      setDiscounts((json?.data || []) as DiscountRow[]);
    } catch (err: any) {
      setDiscountsError(err?.message || 'Unable to fetch discounts');
    } finally {
      setDiscountsLoading(false);
    }
  };

  useEffect(() => {
    if (context) loadDiscounts();
  }, [context]);

  const [categoryOptions, setCategoryOptions] = useState<{ value: string; content: string }[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setCategoriesLoading(true);
        setCategoriesError(null);
        const res = await fetch(`/api/categories/list?context=${encodeURIComponent(context)}`);
        if (!res.ok) throw new Error('Failed to load categories');
        const json = await res.json();
        setCategoryOptions((json?.options || []).map((o: any) => ({ value: o.value, content: o.content })));
      } catch (err: any) {
        setCategoriesError(err?.message || 'Unable to fetch categories');
      } finally {
        setCategoriesLoading(false);
      }
    };

    if (context) fetchCategories();
  }, [context]);

  // Simple form state (UI only for now)
  const [discountName, setDiscountName] = useState('');
  const [categoriesValue, setCategoriesValue] = useState<string[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const formatValidity = (row: DiscountRow) => {
    const start = row.startDate ? new Date(row.startDate).toLocaleDateString() : '';
    const end = row.endDate ? new Date(row.endDate).toLocaleDateString() : 'Ongoing';
    return `${start} - ${end}`.trim();
  };

  const handleDeactivate = async (row: DiscountRow) => {
    try {
      const res = await fetch(`/api/categories/discounts/deactivate?context=${encodeURIComponent(context)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryIds: categoryOptions
            .filter((opt) => row.categories.includes(opt.content))
            .map((opt) => Number(opt.value)),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Failed to deactivate');
      await loadDiscounts();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  };

  const columns = [
    { header: 'Name', hash: 'name', render: ({ name }: DiscountRow) => name },
    { header: 'Category', hash: 'categories', render: ({ categories }: DiscountRow) => categories.join(', ') },
    { header: 'Type', hash: 'type', render: ({ type }: DiscountRow) => (type === 'percent' ? '%' : '$') },
    { header: 'Amount', hash: 'amount', render: ({ amount, type }: DiscountRow) => (type === 'percent' ? `${amount.toFixed(2)}%` : `$${amount.toFixed(2)}`) },
    { header: 'Validity', hash: 'validity', render: (row: DiscountRow) => formatValidity(row) },
    { header: 'Status', hash: 'status', render: ({ status }: DiscountRow) => (
      <Badge label={status} variant={status === 'Active' ? 'success' : 'secondary'} />
    ) },
    { header: '', hideHeader: true, hash: 'actions', render: (row: DiscountRow) => (
      <Dropdown
        toggle={<Button variant="subtle">Options</Button>}
        items={[
          { content: 'Deactivate', onItemClick: () => handleDeactivate(row), color: 'danger' },
        ]}
        placement="bottom-start"
      />
    )},
  ];

  const handleSave = async () => {
    try {
      const body = {
        name: discountName,
        type: discountType,
        amount: Number(amount),
        startDate: startDate || null,
        endDate: endDate || null,
        status: 'Active',
      };
      const res = await fetch(`/api/categories/discounts?context=${encodeURIComponent(context)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          categoryIds: categoriesValue.map((v) => Number(v)),
        }),
      });
      if (!res.ok) throw new Error('Failed to save discount');
      // Reset minimal fields and refresh list
      setDiscountName('');
      setCategoriesValue([]);
      setAmount('');
      setStartDate('');
      setEndDate('');
      await loadDiscounts();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  };

  return (
    <Box>
      <Panel header="Discounts">
        <Table columns={columns as any} items={discounts} stickyHeader />
        {discountsError && (
          <Box marginTop="small">{discountsError}</Box>
        )}
      </Panel>

      <Panel>
        <Flex marginBottom="medium" justifyContent="space-between" alignItems="center">
          <H1 margin="none">Create Discount</H1>
          <Button variant="primary" onClick={handleSave}>Save Discount</Button>
        </Flex>

        <Flex flexDirection="column" marginTop="none">
          <FormGroup>
            <Input
              label="Discount Name"
              name="discountName"
              placeholder="Name"
              value={discountName}
              onChange={(e) => setDiscountName(e.target.value)}
            />
          </FormGroup>

          <FormGroup>
            <MultiSelect
              label="Category"
              options={categoryOptions}
              value={categoriesValue}
              onOptionsChange={(value) => setCategoriesValue(value as string[])}
              disabled={categoriesLoading}
              description={categoriesError || undefined}
            />
          </FormGroup>

          <FormGroup>
            <Box marginBottom="xxSmall">Discount Type</Box>
            <Flex alignItems="center">
              <label style={{ display: 'flex', alignItems: 'center', marginRight: 16 }}>
                <input
                  type="radio"
                  name="discountType"
                  value="percent"
                  checked={discountType === 'percent'}
                  onChange={() => setDiscountType('percent')}
                  style={{ marginRight: 8 }}
                />
                %
              </label>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="discountType"
                  value="fixed"
                  checked={discountType === 'fixed'}
                  onChange={() => setDiscountType('fixed')}
                  style={{ marginRight: 8 }}
                />
                $
              </label>
            </Flex>
          </FormGroup>

          <FormGroup>
            <Input
              label="Discount Amount"
              name="amount"
              placeholder={discountType === 'percent' ? '%' : '$'}
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormGroup>

          <Flex>
            <FormGroup style={{ flex: 1, marginRight: 12 }}>
              <Input
                label="Start Date"
                name="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </FormGroup>
            <FormGroup style={{ flex: 1, marginLeft: 12 }}>
              <Input
                label="End Date"
                name="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </FormGroup>
          </Flex>
        </Flex>
      </Panel>
    </Box>
  );
}

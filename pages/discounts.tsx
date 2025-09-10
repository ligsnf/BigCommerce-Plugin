import { Badge, Box, Button, Dropdown, Flex, FormGroup, H1, Input, MultiSelect, Panel, Table } from '@bigcommerce/big-design';
import { MoreHorizIcon } from '@bigcommerce/big-design-icons';
import { useEffect, useState } from 'react';
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
  scheduledTime?: string; // ISO string for when discount should be activated
  endDateTime?: string; // ISO string for when discount should be deactivated
  status: 'Active' | 'Inactive' | 'Scheduled';
}

export default function Discounts() {
  const { context } = useSession();
  // Discounts state (loaded from backend)
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [discountsLoading, setDiscountsLoading] = useState(false);
  const [discountsError, setDiscountsError] = useState<string | null>(null);

  const checkAndActivateScheduledDiscounts = async () => {
    if (!context) {
      console.log('No context available, skipping scheduled discount check');
      return;
    }
    
    try {
      const res = await fetch(`/api/categories/discounts/activate-scheduled?context=${encodeURIComponent(context)}`, {
        method: 'POST',
      });
      if (res.ok) {
        const result = await res.json();
        if (result.activatedCount > 0) {
          console.log(`Activated ${result.activatedCount} scheduled discounts`);
        }
      }
    } catch (err) {
      console.error('Error checking scheduled discounts:', err);
    }
  };

  const loadDiscounts = async () => {
    try {
      console.log('Loading discounts with context:', context);
      setDiscountsLoading(true);
      setDiscountsError(null);
      
      // First check and activate any scheduled discounts that are due
      await checkAndActivateScheduledDiscounts();
      
      const res = await fetch(`/api/categories/discounts?context=${encodeURIComponent(context)}`);
      if (!res.ok) throw new Error('Failed to load discounts');
      const json = await res.json();
      console.log('Loaded discounts:', json);
      setDiscounts((json?.data || []) as DiscountRow[]);
    } catch (err: any) {
      console.error('Error loading discounts:', err);
      setDiscountsError(err?.message || 'Unable to fetch discounts');
    } finally {
      setDiscountsLoading(false);
    }
  };

  useEffect(() => {
    if (context) loadDiscounts();
  }, [context]);

  // Check for scheduled discounts every minute
  useEffect(() => {
    if (!context) return;

    // Initial check after a short delay to ensure context is fully loaded
    const initialTimeout = setTimeout(() => {
      checkAndActivateScheduledDiscounts();
    }, 1000);

    const interval = setInterval(() => {
      checkAndActivateScheduledDiscounts();
    }, 60000); // Check every minute

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
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
  const [scheduledTime, setScheduledTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [applyImmediately, setApplyImmediately] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // const formatValidity = (row: DiscountRow) => {
  //   const start = row.startDate ? new Date(row.startDate).toLocaleDateString() : '';
  //   const end = row.endDate ? new Date(row.endDate).toLocaleDateString() : 'Ongoing';
  //
  //   return `${start} - ${end}`.trim();
  // };

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

  const handleDelete = async (row: DiscountRow) => {
    try {
      const res = await fetch(`/api/categories/discounts/delete?context=${encodeURIComponent(context)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryIds: categoryOptions
            .filter((opt) => row.categories.includes(opt.content))
            .map((opt) => Number(opt.value)),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Failed to delete');
      await loadDiscounts();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  };

  const handleReuse = (row: DiscountRow) => {
    // Populate form with the selected discount's details
    setDiscountName(row.name);
    setDiscountType(row.type);
    setAmount(row.amount.toString());
    
    // Set categories - find the category IDs that match the category names
    const matchingCategoryIds = categoryOptions
      .filter(opt => row.categories.includes(opt.content))
      .map(opt => opt.value);
    setCategoriesValue(matchingCategoryIds);
    
    // Set timing based on whether it has scheduled time
    if (row.scheduledTime) {
      setApplyImmediately(false);
      setScheduledTime(new Date(row.scheduledTime).toISOString().slice(0, 16));
    } else {
      setApplyImmediately(true);
      setScheduledTime('');
    }
    
    // Set end datetime if it exists
    if (row.endDateTime) {
      setEndDateTime(new Date(row.endDateTime).toISOString().slice(0, 16));
    } else {
      setEndDateTime('');
    }
    
    // Clear start/end dates (these are legacy fields)
    setStartDate('');
    setEndDate('');
  };

  const formatScheduledTime = (scheduledTime?: string) => {
    if (!scheduledTime) return '';
    const date = new Date(scheduledTime);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const formatEndDateTime = (endDateTime?: string) => {
    if (!endDateTime) return '';
    const date = new Date(endDateTime);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const columns = [
    { header: 'Name', hash: 'name', render: ({ name }: DiscountRow) => name },
    { header: 'Category', hash: 'categories', render: ({ categories }: DiscountRow) => categories.join(', ') },
    { header: 'Type', hash: 'type', render: ({ type }: DiscountRow) => (type === 'percent' ? '%' : '$') },
    { header: 'Amount', hash: 'amount', render: ({ amount, type }: DiscountRow) => (type === 'percent' ? `${amount.toFixed(2)}%` : `$${amount.toFixed(2)}`) },
    { header: 'Scheduled For', hash: 'scheduledTime', render: ({ scheduledTime }: DiscountRow) => formatScheduledTime(scheduledTime) },
    { header: 'Ends At', hash: 'endDateTime', render: ({ endDateTime }: DiscountRow) => formatEndDateTime(endDateTime) },
    { header: 'Status', hash: 'status', render: ({ status }: DiscountRow) => (
      <Badge 
        label={status} 
        variant={
          status === 'Active' ? 'success' : 
          status === 'Scheduled' ? 'warning' : 
          'secondary'
        } 
      />
    ) },
    { header: '', hideHeader: true, hash: 'actions', render: (row: DiscountRow) => (
      <Dropdown
        items={[
          { 
            content: 'Reuse', 
            onItemClick: () => handleReuse(row), 
            hash: 'reuse',
            disabled: row.status !== 'Inactive'
          },
          { 
            content: 'Deactivate', 
            onItemClick: () => handleDeactivate(row), 
            hash: 'deactivate',
            disabled: row.status === 'Inactive'
          },
          { 
            content: 'Delete', 
            onItemClick: () => handleDelete(row), 
            hash: 'delete',
            actionType: 'destructive'
          }
        ]}
        toggle={<Button iconOnly={<MoreHorizIcon color="secondary60" />} variant="subtle" />}
      />
    )},
  ];

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      
      // Validate discount amount
      const amountValue = Number(amount);
      if (discountType === 'percent' && (amountValue < 0 || amountValue > 100)) {
        alert('Percentage discount must be between 0 and 100');
        return;
      }

      if (amountValue <= 0) {
        alert('Discount amount must be greater than 0');
        return;
      }

      // Validate scheduled time if not applying immediately
      if (!applyImmediately && !scheduledTime) {
        alert('Please select a scheduled time for the discount');
        return;
      }

      if (!applyImmediately) {
        const scheduledDate = new Date(scheduledTime);
        const now = new Date();
        if (scheduledDate <= now) {
          alert('Scheduled time must be in the future');
          return;
        }
      }

      // Validate end datetime if provided
      if (endDateTime) {
        const endDate = new Date(endDateTime);
        const now = new Date();
        if (endDate <= now) {
          alert('End datetime must be in the future');
          return;
        }
        
        // If scheduled, end datetime must be after scheduled time
        if (!applyImmediately && scheduledTime) {
          const scheduledDate = new Date(scheduledTime);
          if (endDate <= scheduledDate) {
            alert('End datetime must be after the scheduled start time');
            return;
          }
        }
      }

      // Generate automatic name if not provided
      const finalDiscountName = discountName.trim() || (() => {
        const categoryText = categoriesValue.length > 0 ? 
          (categoriesValue.length === 1 ? 
            categoryOptions.find(opt => opt.value === categoriesValue[0])?.content || 'Category' :
            `${categoriesValue.length} Categories`) : 
          'Category';
        const discountNumber = Math.floor(Math.random() * 1000) + 1;
        return `${categoryText} - ${discountNumber}`;
      })();

      const body = {
        name: finalDiscountName,
        type: discountType,
        amount: Number(amount),
        startDate: startDate || null,
        endDate: endDate || null,
        scheduledTime: applyImmediately ? null : scheduledTime,
        endDateTime: endDateTime || null,
        status: applyImmediately ? 'Active' : 'Scheduled',
      };
      
      const requestBody = {
        ...body,
        categoryIds: categoriesValue.map((v) => Number(v)),
      };
      
      console.log('Sending discount request:', requestBody);
      
      const res = await fetch(`/api/categories/discounts?context=${encodeURIComponent(context)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to apply discount');
      }
      
      const result = await res.json();
      console.log('Discount applied successfully:', result);
      
      // Reset minimal fields and refresh list
      setDiscountName('');
      setCategoriesValue([]);
      setAmount('');
      setStartDate('');
      setEndDate('');
      setScheduledTime('');
      setEndDateTime('');
      setApplyImmediately(true);
      await loadDiscounts();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error applying discount:', err);
      alert(`Error: ${err instanceof Error ? err.message : 'Failed to apply discount'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box>
      <Panel header="Discounts">
        {discountsLoading ? (
          <Box padding="large" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            Loading discounts...
          </Box>
        ) : (
          <Table columns={columns as any} items={discounts} stickyHeader />
        )}
        {discountsError && (
          <Box marginTop="small">{discountsError}</Box>
        )}
      </Panel>

      <Panel>
        <Flex marginBottom="medium" justifyContent="space-between" alignItems="center">
          <H1 margin="none">Create Discount</H1>
          <Button 
            variant="primary" 
            onClick={handleSave}
            disabled={isSubmitting}
            isLoading={isSubmitting}
          >
            {isSubmitting 
              ? (applyImmediately ? 'Applying...' : 'Scheduling...') 
              : (applyImmediately ? 'Apply Discount' : 'Schedule Discount')
            }
          </Button>
        </Flex>

        <Flex flexDirection="column" marginTop="none">
          <FormGroup>
            <Input
              label="Discount Name"
              name="discountName"
              placeholder="Leave blank for auto-generated name"
              value={discountName}
              onChange={(e) => setDiscountName(e.target.value)}
              disabled={isSubmitting}
            />
          </FormGroup>

          <FormGroup>
            <MultiSelect
              label="Category"
              options={categoryOptions}
              value={categoriesValue}
              onOptionsChange={(value) => setCategoriesValue(value as string[])}
              disabled={categoriesLoading || isSubmitting}
              description={categoriesError || undefined}
              required
            />
          </FormGroup>

          <FormGroup>
            <Box marginBottom="xxSmall" style={{ fontWeight: 'bold' }}>Discount Type</Box>
            <Flex alignItems="center">
              <label style={{ display: 'flex', alignItems: 'center', marginRight: 16 }}>
                <input
                  type="radio"
                  name="discountType"
                  value="percent"
                  checked={discountType === 'percent'}
                  onChange={() => setDiscountType('percent')}
                  disabled={isSubmitting}
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
                  disabled={isSubmitting}
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
              min={discountType === 'percent' ? 0 : undefined}
              max={discountType === 'percent' ? 100 : undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onWheel={(e) => {
                e.preventDefault();
                e.currentTarget.blur();
              }}
              disabled={isSubmitting}
              required
              style={{
                MozAppearance: 'textfield',
                WebkitAppearance: 'none',
                margin: 0
              }}
            />
          </FormGroup>

          <FormGroup>
            <Flex alignItems="center">
              <label style={{ display: 'flex', alignItems: 'center', marginRight: 16 }}>
                <input
                  type="radio"
                  name="applyTiming"
                  value="immediate"
                  checked={applyImmediately}
                  onChange={() => setApplyImmediately(true)}
                  disabled={isSubmitting}
                  style={{ marginRight: 8 }}
                />
                Apply Immediately
              </label>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="applyTiming"
                  value="scheduled"
                  checked={!applyImmediately}
                  onChange={() => setApplyImmediately(false)}
                  disabled={isSubmitting}
                  style={{ marginRight: 8 }}
                />
                Schedule for Later
              </label>
            </Flex>
          </FormGroup>

          {!applyImmediately && (
            <FormGroup>
              <Input
                label="Schedule Time"
                name="scheduledTime"
                type="datetime-local"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                description="Select when the discount should be activated"
                disabled={isSubmitting}
                required
              />
            </FormGroup>
          )}

          <FormGroup>
            <Input
              label="End Time"
              name="endDateTime"
              type="datetime-local"
              value={endDateTime}
              onChange={(e) => setEndDateTime(e.target.value)}
              description="Select when the discount should automatically end"
              disabled={isSubmitting}
            />
          </FormGroup>

          {/*
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
          */}
        </Flex>
      </Panel>
    </Box>
  );
}

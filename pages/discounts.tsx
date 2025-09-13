import { Alert, Badge, Box, Button, Dropdown, Flex, FormGroup, H1, Input, MultiSelect, Panel, Table } from '@bigcommerce/big-design';
import { MoreHorizIcon } from '@bigcommerce/big-design-icons';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../context/session';

type DiscountType = 'percent' | 'fixed';

interface DiscountRow {
  id: string; // Changed to string to handle the new format
  name: string;
  categories: string[];
  categoryIds: number[]; // Added to track category IDs
  type: DiscountType;
  amount: number; // stores raw number; format per type in UI
  startDate?: string; // ISO strings for simplicity
  endDate?: string; // optional = ongoing
  scheduledTime?: string; // ISO string for when discount should be activated
  endDateTime?: string; // ISO string for when discount should be deactivated
  status: 'Active' | 'Inactive' | 'Scheduled';
  metafieldId?: number; // Added to track the metafield ID
  categoryId?: number; // Added to track the category ID
}

export default function Discounts() {
  const { context } = useSession();
  // Discounts state (loaded from backend)
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [discountsLoading, setDiscountsLoading] = useState(false);
  const [discountsError, setDiscountsError] = useState<string | null>(null);
  const [reloadNotification, setReloadNotification] = useState<string | null>(null);

  const checkAndActivateScheduledDiscounts = useCallback(async () => {
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
          // Show notification instead of automatic reload
          setReloadNotification(`${result.activatedCount} scheduled discount(s) have been activated. Please refresh the page to see the updated status.`);
        }
      } else {
        // Handle API errors gracefully - don't log as error if it's a session issue
        const errorData = await res.json().catch(() => ({ message: 'Unknown error' }));
        if (res.status === 400 && errorData.message?.includes('Context parameter')) {
          console.log('Session not ready, skipping scheduled discount check');
        } else {
          console.error('Error checking scheduled discounts:', errorData.message);
        }
      }
    } catch (err) {
      // Only log as error if it's not a network/session issue
      if (err instanceof TypeError && err.message.includes('fetch')) {
        console.log('Network error during scheduled discount check (session may not be ready)');
      } else {
        console.error('Error checking scheduled discounts:', err);
      }
    }
  }, [context]);

  const loadDiscounts = useCallback(async () => {
    try {
      console.log('Loading discounts with context:', context);
      setDiscountsLoading(true);
      setDiscountsError(null);
      
      const res = await fetch(`/api/categories/discounts?context=${encodeURIComponent(context)}`);
      if (!res.ok) throw new Error('Failed to load discounts');
      const json = await res.json();
      console.log('Loaded discounts:', json);
      const discountsData = (json?.data || []) as DiscountRow[];
      setDiscounts(discountsData);
    } catch (err: any) {
      console.error('Error loading discounts:', err);
      setDiscountsError(err?.message || 'Unable to fetch discounts');
    } finally {
      setDiscountsLoading(false);
    }
  }, [context]);

  useEffect(() => {
    if (context) loadDiscounts();
  }, [loadDiscounts, context]);

  // Check for scheduled discounts every minute
  useEffect(() => {
    if (!context) return;

    // Initial check after a delay to ensure session is fully established
    const initialTimeout = setTimeout(() => {
      checkAndActivateScheduledDiscounts();
    }, 3000);

    const interval = setInterval(() => {
      checkAndActivateScheduledDiscounts();
    }, 60000); // Check every minute

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [context, checkAndActivateScheduledDiscounts]);


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
  const [discountType, setDiscountType] = useState<DiscountType | null>(null);
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [applyMode, setApplyMode] = useState<'create' | 'apply' | 'schedule'>('create');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // const formatValidity = (row: DiscountRow) => {
  //   const start = row.startDate ? new Date(row.startDate).toLocaleDateString() : '';
  //   const end = row.endDate ? new Date(row.endDate).toLocaleDateString() : 'Ongoing';
  //
  //   return `${start} - ${end}`.trim();
  // };

  const handleActivate = async (row: DiscountRow) => {
    try {
      const res = await fetch(`/api/categories/discounts/activate?context=${encodeURIComponent(context)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryIds: row.categoryIds || [row.categoryId].filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Failed to activate');
      
      // Check if the discount had an end time that has passed
      const now = new Date();
      const hadExpiredEndTime = row.endDateTime && new Date(row.endDateTime) <= now;
      
      if (hadExpiredEndTime) {
        setReloadNotification(`Discount "${row.name}" has been activated. The end time has been cleared since it had already passed. Please refresh the page to see the updated status.`);
      } else {
        setReloadNotification(`Discount "${row.name}" has been activated. Any existing active discount in this category has been deactivated. Please refresh the page to see the updated status.`);
      }
      
      await loadDiscounts();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  };

  const handleDeactivate = async (row: DiscountRow) => {
    try {
      const res = await fetch(`/api/categories/discounts/deactivate?context=${encodeURIComponent(context)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryIds: row.categoryIds || [row.categoryId].filter(Boolean),
          discountId: row.id, // Pass the discount ID to identify which discount to deactivate
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Failed to deactivate');
      setReloadNotification(`Discount "${row.name}" has been deactivated. Please refresh the page to see the updated status.`);
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
          categoryIds: row.categoryIds || [row.categoryId].filter(Boolean),
          discountId: row.id, // Pass the discount ID to identify which discount to delete
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Failed to delete');
      setReloadNotification(`Discount "${row.name}" has been deleted. Please refresh the page to see the updated list.`);
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
    
    // Set timing based on status and scheduled time
    if (row.status === 'Scheduled' && row.scheduledTime) {
      setApplyMode('schedule');
      // Convert UTC time to local datetime-local format
      const localScheduledTime = new Date(row.scheduledTime);
      setScheduledTime(localScheduledTime.toISOString().slice(0, 16));
    } else if (row.status === 'Active') {
      setApplyMode('apply');
      setScheduledTime('');
    } else {
      setApplyMode('create');
      setScheduledTime('');
    }
    
    // Set end datetime if it exists
    if (row.endDateTime) {
      // Convert UTC time to local datetime-local format
      const localEndTime = new Date(row.endDateTime);
      setEndDateTime(localEndTime.toISOString().slice(0, 16));
    } else {
      setEndDateTime('');
    }
    
    // Clear start/end dates (these are legacy fields)
    setStartDate('');
    setEndDate('');
  };

  const formatScheduledTime = (scheduledTime?: string) => {
    if (!scheduledTime) return '';
    // Parse UTC time and display in local timezone
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
    // Parse UTC time and display in local timezone
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
            content: 'Activate', 
            onItemClick: () => handleActivate(row), 
            hash: 'activate',
            disabled: row.status !== 'Inactive'
          },
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
      
      // Validate discount type selection
      if (!discountType) {
        alert('Please select a discount type');
        
return;
      }

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

      // Validate scheduled time if scheduling
      if (applyMode === 'schedule' && !scheduledTime) {
        alert('Please select a scheduled time for the discount');
        
return;
      }

      if (applyMode === 'schedule') {
        // Validate scheduled time (datetime-local is already in local timezone)
        const scheduledDate = new Date(scheduledTime);
        const now = new Date();
        if (scheduledDate <= now) {
          alert('Scheduled time must be in the future');
          
return;
        }
      }

      // Validate end datetime if provided
      if (endDateTime) {
        // Validate end time (datetime-local is already in local timezone)
        const endDate = new Date(endDateTime);
        const now = new Date();
        if (endDate <= now) {
          alert('End datetime must be in the future');
          
return;
        }
        
        // If scheduled, end datetime must be after scheduled time
        if (applyMode === 'schedule' && scheduledTime) {
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
        // Convert local datetime to UTC ISO string for storage
        scheduledTime: applyMode === 'schedule' ? new Date(scheduledTime).toISOString() : null,
        endDateTime: endDateTime ? new Date(endDateTime).toISOString() : null,
        status: applyMode === 'create' ? 'Inactive' : applyMode === 'apply' ? 'Active' : 'Scheduled',
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
      
      // Show success message
      const actionText = applyMode === 'create' ? 'created' : applyMode === 'apply' ? 'applied' : 'scheduled';
      setReloadNotification(`Discount "${finalDiscountName}" has been ${actionText} successfully. Please refresh the page to see the updated list.`);
      
      // Reset minimal fields and refresh list
      setDiscountName('');
      setCategoriesValue([]);
      setDiscountType(null);
      setAmount('');
      setStartDate('');
      setEndDate('');
      setScheduledTime('');
      setEndDateTime('');
      setApplyMode('create');
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
      {reloadNotification && (
        <Box marginBottom="medium">
          <Alert
            type="info"
            onClose={() => setReloadNotification(null)}
            messages={[{ text: reloadNotification }]}
          />
        </Box>
      )}
      
      <Panel header="Discounts">
        <Flex justifyContent="flex-end" marginBottom="medium">
          <Button 
            variant="secondary" 
            onClick={loadDiscounts}
            disabled={!context || discountsLoading}
            isLoading={discountsLoading}
          >
            Refresh
          </Button>
        </Flex>
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
        <H1 margin="none" marginBottom="medium">Create Discount</H1>

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
            <Flex alignItems="center">
              <Box marginRight="medium" style={{ fontWeight: 'bold' }}>Apply Mode</Box>
              <Box marginRight="small">
                <Button
                  variant={applyMode === 'create' ? "primary" : "secondary"}
                  onClick={() => setApplyMode('create')}
                  disabled={isSubmitting}
                >
                  Create Only
                </Button>
              </Box>
              <Box marginRight="small">
                <Button
                  variant={applyMode === 'apply' ? "primary" : "secondary"}
                  onClick={() => setApplyMode('apply')}
                  disabled={isSubmitting}
                >
                  Apply Now
                </Button>
              </Box>
              <Box>
                <Button
                  variant={applyMode === 'schedule' ? "primary" : "secondary"}
                  onClick={() => setApplyMode('schedule')}
                  disabled={isSubmitting}
                >
                  Schedule
                </Button>
              </Box>
            </Flex>
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
            <Flex alignItems="center">
              <Box marginRight="medium" style={{ fontWeight: 'bold' }}>Discount Type</Box>
              <Box marginRight="small">
                <Button
                  variant={discountType === 'percent' ? "primary" : "secondary"}
                  onClick={() => setDiscountType('percent')}
                  disabled={isSubmitting}
                >
                  Percentage (%)
                </Button>
              </Box>
              <Box>
                <Button
                  variant={discountType === 'fixed' ? "primary" : "secondary"}
                  onClick={() => setDiscountType('fixed')}
                  disabled={isSubmitting}
                >
                  Fixed Amount ($)
                </Button>
              </Box>
            </Flex>
          </FormGroup>

          {discountType && (
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
          )}

          {applyMode === 'schedule' && (
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

        <Flex marginTop="large" justifyContent="flex-end">
          <Button 
            variant="primary" 
            onClick={handleSave}
            disabled={isSubmitting}
            isLoading={isSubmitting}
          >
            {isSubmitting 
              ? (applyMode === 'create' ? 'Creating...' : applyMode === 'apply' ? 'Applying...' : 'Scheduling...') 
              : (applyMode === 'create' ? 'Create Discount' : applyMode === 'apply' ? 'Apply Discount' : 'Schedule Discount')
            }
          </Button>
        </Flex>
      </Panel>
    </Box>
  );
}

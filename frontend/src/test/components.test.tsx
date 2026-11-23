import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, DataTable, EmptyState, MoneyInput, Pagination, type Column } from '@/components/common';
import { Field, Input, StatusBadge } from '@/components/ui';
import { ApiError } from '@/lib/api';

describe('DataTable', () => {
  type Row = { _id: string; name: string; price: number };
  const cols: Column<Row>[] = [
    { key: 'n', header: 'Name', sort: 'name', cell: (r) => r.name },
    { key: 'p', header: 'Price', align: 'right', cell: (r) => r.price },
  ];
  it('renders rows', () => {
    render(<DataTable columns={cols} rows={[{ _id: '1', name: 'Brake pad', price: 10 }]} />);
    expect(screen.getByRole('cell', { name: 'Brake pad' })).toBeInTheDocument();
  });
  it('shows the empty state', () => {
    render(<DataTable columns={cols} rows={[]} empty={<EmptyState title="No products found" />} />);
    expect(screen.getByText('No products found')).toBeInTheDocument();
  });
  it('shows a loading skeleton before data arrives', () => {
    render(<DataTable columns={cols} rows={undefined} loading />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });
  it('shows the server error message and retries', async () => {
    const retry = vi.fn();
    render(<DataTable columns={cols} rows={undefined} error={new ApiError(403, 'FORBIDDEN', 'You do not have permission')} retry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
  it('toggles sorting from the header', async () => {
    const onSort = vi.fn();
    render(<DataTable columns={cols} rows={[{ _id: '1', name: 'A', price: 1 }]} sort="name" onSort={onSort} />);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith('-name');
  });
});

describe('Pagination', () => {
  it('disables previous on the first page and moves forward', async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} pages={3} total={60} onPage={onPage} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(2);
    expect(screen.getByText(/60 records · page 1 of 3/)).toBeInTheDocument();
  });
  it('renders nothing when there are no records', () => {
    const { container } = render(<Pagination page={1} pages={0} total={0} onPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MoneyInput', () => {
  function Harness({ onValue }: { onValue: (c: number | null) => void }) {
    const [v, setV] = useState<number | null>(null);
    return (
      <MoneyInput
        aria-label="Amount"
        value={v}
        onChange={(c) => {
          setV(c);
          onValue(c);
        }}
      />
    );
  }
  it('emits integer cents and flags invalid text', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '19.99');
    expect(onValue).toHaveBeenLastCalledWith(1999);
    expect(input).toHaveAttribute('aria-invalid', 'false');
    await userEvent.type(input, '9');
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ConfirmDialog', () => {
  it('requires a reason before confirming', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => {}} title="Void expense?" requireReason confirmLabel="Void" destructive onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: 'Void' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'Duplicate entry');
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith('Duplicate entry');
  });
});

describe('form fields', () => {
  it('associates labels with their controls automatically', () => {
    render(
      <Field label="Supplier invoice number" required>
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Supplier invoice number' })).toBeInTheDocument();
  });
  it('shows validation errors as alerts', () => {
    render(
      <Field label="SKU" error="SKU is required">
        <Input aria-invalid />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('SKU is required');
  });
  it('renders readable status badges', () => {
    render(<StatusBadge status="PARTIALLY_RECEIVED" />);
    expect(screen.getByText('Partially received')).toBeInTheDocument();
  });
});

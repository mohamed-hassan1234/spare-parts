/**
 * shadcn/ui-style primitives (Radix + Tailwind + cva), kept in one module for this app.
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/format';

/* -------------------------------- Button -------------------------------- */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
        outline: 'border border-input bg-card hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        success: 'bg-success text-white hover:bg-success/90 shadow-sm',
      },
      size: { default: 'h-9 px-4 py-2', sm: 'h-8 px-3 text-xs', lg: 'h-11 px-6 text-base', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
});
Button.displayName = 'Button';

/* --------------------------------- Inputs -------------------------------- */
/** A <Field> provides an id so its <Label> is programmatically associated with the control inside it. */
export const FieldIdContext = React.createContext<string | undefined>(undefined);
const useFieldId = (id?: string) => {
  const ctx = React.useContext(FieldIdContext);
  return id ?? ctx;
};
const fieldBase =
  'flex w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, id, ...props }, ref) => (
  <input ref={ref} id={useFieldId(id)} className={cn(fieldBase, 'h-9 py-1', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, id, ...props }, ref) => (
  <textarea ref={ref} id={useFieldId(id)} className={cn(fieldBase, 'min-h-[72px] py-2', className)} {...props} />
));
Textarea.displayName = 'Textarea';

/** Native select: accessible, keyboard friendly and works on every device. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, id, ...props }, ref) => (
  <select ref={ref} id={useFieldId(id)} className={cn(fieldBase, 'h-9 py-1 pr-8', className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn('text-sm font-medium leading-none', className)} {...props} />
));
Label.displayName = 'Label';

export function Field({
  label,
  error,
  hint,
  children,
  className,
  htmlFor,
  required,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
  required?: boolean;
}) {
  const auto = React.useId();
  const id = htmlFor ?? auto;
  return (
    <FieldIdContext.Provider value={id}>
      <div className={cn('grid gap-1.5', className)}>
        {/* The required marker is drawn with CSS so it is not part of the label's accessible name. */}
        <Label htmlFor={id} className={required ? 'required-mark' : undefined}>
          {label}
        </Label>
        {children}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </FieldIdContext.Provider>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="size-4 rounded border-input accent-[var(--primary)]" {...props} />
      {label}
    </label>
  );
}

/* --------------------------------- Card --------------------------------- */
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)} {...p} />;
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn('font-semibold leading-tight', className)} {...p} />;
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => <p className={cn('text-sm text-muted-foreground', className)} {...p} />;
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('p-5 pt-0', className)} {...p} />;

/* --------------------------------- Badge -------------------------------- */
const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'bg-primary/10 text-primary',
      secondary: 'bg-secondary text-secondary-foreground',
      success: 'bg-success/15 text-success',
      warning: 'bg-warning/20 text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning',
      destructive: 'bg-destructive/12 text-destructive',
      outline: 'border text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});
export const Badge = ({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ variant }), className)} {...p} />
);

const STATUS_VARIANT: Record<string, VariantProps<typeof badgeVariants>['variant']> = {
  PAID: 'success',
  COMPLETED: 'success',
  RECEIVED: 'success',
  POSTED: 'success',
  ACTIVE: 'success',
  APPROVED: 'success',
  RESOLVED: 'success',
  SUCCEEDED: 'success',
  IN_STOCK: 'success',
  PARTIAL: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  PARTIALLY_RETURNED: 'warning',
  PENDING: 'warning',
  ORDERED: 'default',
  OPEN: 'default',
  IN_REVIEW: 'warning',
  LOW_STOCK: 'warning',
  DRAFT: 'secondary',
  UNPAID: 'destructive',
  CANCELLED: 'secondary',
  VOIDED: 'secondary',
  RETURNED: 'secondary',
  REJECTED: 'destructive',
  FAILED: 'destructive',
  BLOCKED: 'destructive',
  OUT_OF_STOCK: 'destructive',
  INACTIVE: 'secondary',
  OVERDUE: 'destructive',
};
export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>
      {status
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}

/* -------------------------------- Skeleton ------------------------------- */
export const Skeleton = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('animate-pulse rounded-md bg-muted', className)} {...p} />;

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-muted-foreground', className)} aria-label="Loading" />;
}

/* --------------------------------- Dialog -------------------------------- */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogContent({
  className,
  children,
  title,
  description,
  wide,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string; description?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-card p-6 shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
          className,
        )}
        {...props}
      >
        <div className="flex flex-col gap-1 pr-6">
          <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
        </div>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100" aria-label="Close">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export const DialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />;

/* ---------------------------------- Tabs --------------------------------- */
export const Tabs = TabsPrimitive.Root;
export const TabsList = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn('inline-flex h-9 max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground', className)} {...p} />
);
export const TabsTrigger = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm cursor-pointer',
      className,
    )}
    {...p}
  />
);
export const TabsContent = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) => <TabsPrimitive.Content className={cn('mt-4', className)} {...p} />;

/* -------------------------------- Dropdown -------------------------------- */
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export function DropdownMenuContent({ className, ...p }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content sideOffset={6} className={cn('z-50 min-w-44 overflow-hidden rounded-md border bg-card p-1 shadow-lg', className)} {...p} />
    </DropdownPrimitive.Portal>
  );
}
export const DropdownMenuItem = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>) => (
  <DropdownPrimitive.Item
    className={cn('relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent [&_svg]:size-4', className)}
    {...p}
  />
);
export const DropdownMenuLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) => (
  <DropdownPrimitive.Label className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)} {...p} />
);
export const DropdownMenuSeparator = () => <DropdownPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;

/* ---------------------------------- Table --------------------------------- */
export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="relative w-full overflow-x-auto">
    <table className={cn('w-full caption-bottom text-sm', className)} {...p} />
  </div>
);
export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className="[&_tr]:border-b bg-muted/40" {...p} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className="[&_tr:last-child]:border-0" {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b transition-colors hover:bg-muted/40', className)} {...p} />;
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap', className)} {...p} />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-3 py-2.5 align-middle', className)} {...p} />;

export const Separator = ({ className }: { className?: string }) => <div role="separator" className={cn('h-px w-full bg-border', className)} />;

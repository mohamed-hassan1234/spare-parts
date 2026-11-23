import { Schema, model, Types } from 'mongoose';
import { MOVEMENT_TYPES, type MovementType } from '@autoparts/shared';

export interface WarehouseDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;
}
const WarehouseSchema = new Schema<WarehouseDoc>(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true },
    address: String,
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const Warehouse = model<WarehouseDoc>('Warehouse', WarehouseSchema, 'warehouses');

/**
 * Current quantity per product per location. This is a materialised projection of
 * `inventory_movements`; it is only ever changed by the inventory service in the
 * same transaction as the movement, and can be re-verified with the reconciliation check.
 */
export interface InventoryBalanceDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
  lastMovementAt?: Date;
}
const InventoryBalanceSchema = new Schema<InventoryBalanceDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    qtyOnHand: { type: Number, default: 0 },
    qtyReserved: { type: Number, default: 0, min: 0 },
    qtyAvailable: { type: Number, default: 0 },
    lastMovementAt: Date,
  },
  { versionKey: false },
);
InventoryBalanceSchema.index({ productId: 1, warehouseId: 1 }, { unique: true });
export const InventoryBalance = model<InventoryBalanceDoc>('InventoryBalance', InventoryBalanceSchema, 'inventory_balances');

/** FIFO cost layer: one per receipt (purchase, opening stock, return-to-stock, positive adjustment). */
export interface CostLayerDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  receivedAt: Date;
  sourceType: MovementType;
  sourceId?: Types.ObjectId;
  sourceRef?: string;
  originalQty: number;
  remainingQty: number;
  originalCost: number;
  remainingCost: number;
}
const CostLayerSchema = new Schema<CostLayerDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    receivedAt: { type: Date, required: true },
    sourceType: { type: String, enum: MOVEMENT_TYPES, required: true },
    sourceId: Schema.Types.ObjectId,
    sourceRef: String,
    originalQty: { type: Number, required: true, min: 1 },
    remainingQty: { type: Number, required: true, min: 0 },
    originalCost: { type: Number, required: true, min: 0 },
    remainingCost: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);
CostLayerSchema.index({ productId: 1, warehouseId: 1, remainingQty: 1, receivedAt: 1, _id: 1 });
CostLayerSchema.pre('validate', function () {
  if (this.remainingQty > this.originalQty) throw new Error('Cost layer remaining quantity exceeds original quantity');
  if (this.remainingQty === 0 && this.remainingCost !== 0) throw new Error('Exhausted cost layer must have zero remaining cost');
});
export const CostLayer = model<CostLayerDoc>('CostLayer', CostLayerSchema, 'inventory_cost_layers');

/** Immutable stock movement record. */
export interface MovementDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  type: MovementType;
  /** Signed quantity: + increases stock, − decreases stock. */
  qty: number;
  /** Signed cost impact in cents on the inventory asset. */
  costAmount: number;
  balanceAfter: number;
  sourceType: string;
  sourceId?: Types.ObjectId;
  sourceRef?: string;
  /** Unique per source line — prevents the same line being processed twice. */
  lineKey: string;
  layerAllocations?: { layerId: Types.ObjectId; qty: number; cost: number }[];
  reason?: string;
  createdBy?: Types.ObjectId;
  at: Date;
}
const MovementSchema = new Schema<MovementDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    qty: { type: Number, required: true },
    costAmount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    sourceType: { type: String, required: true },
    sourceId: Schema.Types.ObjectId,
    sourceRef: String,
    lineKey: { type: String, required: true },
    layerAllocations: [{ _id: false, layerId: Schema.Types.ObjectId, qty: Number, cost: Number }],
    reason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
MovementSchema.index({ sourceType: 1, sourceId: 1, lineKey: 1, type: 1 }, { unique: true });
MovementSchema.index({ productId: 1, at: -1 });
MovementSchema.index({ type: 1, at: -1 });
MovementSchema.index({ at: -1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne'] as const) {
  MovementSchema.pre(op, function () {
    throw new Error('Inventory movements are immutable');
  });
}
export const Movement = model<MovementDoc>('Movement', MovementSchema, 'inventory_movements');

export const ADJUSTMENT_REASONS = ['COUNT_CORRECTION', 'DAMAGE', 'THEFT_OR_LOSS', 'EXPIRED', 'FOUND', 'OPENING_BALANCE', 'DATA_CORRECTION', 'OTHER'] as const;
export interface StockAdjustmentDoc {
  _id: Types.ObjectId;
  adjustmentNo: string;
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  qtyChange: number;
  reason: (typeof ADJUSTMENT_REASONS)[number];
  notes: string;
  /** Unit cost (cents) used for stock increases. */
  unitCost?: number;
  costImpact?: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  stockCountId?: Types.ObjectId;
  requestedBy?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
}
const StockAdjustmentSchema = new Schema<StockAdjustmentDoc>(
  {
    adjustmentNo: { type: String, required: true, unique: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    qtyChange: { type: Number, required: true, validate: [(v: number) => Number.isInteger(v) && v !== 0, 'Quantity change must be a non-zero integer'] },
    reason: { type: String, enum: ADJUSTMENT_REASONS, required: true },
    notes: { type: String, required: true, minlength: 3 },
    unitCost: { type: Number, min: 0 },
    costImpact: Number,
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    stockCountId: { type: Schema.Types.ObjectId, ref: 'StockCount' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
  },
  { timestamps: true },
);
export const StockAdjustment = model<StockAdjustmentDoc>('StockAdjustment', StockAdjustmentSchema, 'stock_adjustments');

export interface StockCountDoc {
  _id: Types.ObjectId;
  countNo: string;
  warehouseId: Types.ObjectId;
  status: 'COMPLETED';
  notes?: string;
  lines: { productId: Types.ObjectId; systemQty: number; countedQty: number; difference: number; adjustmentId?: Types.ObjectId }[];
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const StockCountSchema = new Schema<StockCountDoc>(
  {
    countNo: { type: String, required: true, unique: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    status: { type: String, enum: ['COMPLETED'], default: 'COMPLETED' },
    notes: String,
    lines: [
      {
        _id: false,
        productId: { type: Schema.Types.ObjectId, ref: 'Product' },
        systemQty: Number,
        countedQty: Number,
        difference: Number,
        adjustmentId: { type: Schema.Types.ObjectId, ref: 'StockAdjustment' },
      },
    ],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const StockCount = model<StockCountDoc>('StockCount', StockCountSchema, 'stock_counts');

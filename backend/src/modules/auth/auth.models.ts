import { Schema, model, Types } from 'mongoose';
import { ROLES, type Role } from '@autoparts/shared';

export interface UserDoc {
  _id: Types.ObjectId;
  username: string;
  fullName: string;
  email?: string;
  role: Role;
  passwordHash: string;
  passwordChangedAt?: Date;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  totpSecret?: string;
  totpEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<UserDoc>(
  {
    username: { type: String, required: true, lowercase: true, trim: true, unique: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    role: { type: String, enum: ROLES, required: true },
    passwordHash: { type: String, required: true, select: false },
    passwordChangedAt: Date,
    isActive: { type: Boolean, default: true },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
    totpSecret: { type: String, select: false },
    totpEnabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const User = model<UserDoc>('User', UserSchema, 'users');

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  csrfToken: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  /** Set when password is verified but a TOTP code is still required. */
  pendingTwoFactor?: boolean;
}
const SessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    csrfToken: { type: String, required: true },
    ip: String,
    userAgent: String,
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    pendingTwoFactor: Boolean,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
// Expired sessions are purged by MongoDB 7 days after expiry (kept briefly for auditing).
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86_400 });
export const Session = model<SessionDoc>('Session', SessionSchema, 'sessions');

export interface LoginEventDoc {
  _id: Types.ObjectId;
  username: string;
  userId?: Types.ObjectId;
  success: boolean;
  reason?: string;
  ip?: string;
  userAgent?: string;
  at: Date;
}
const LoginEventSchema = new Schema<LoginEventDoc>(
  {
    username: String,
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    success: Boolean,
    reason: String,
    ip: String,
    userAgent: String,
    at: { type: Date, default: () => new Date(), index: true },
  },
  { versionKey: false },
);
export const LoginEvent = model<LoginEventDoc>('LoginEvent', LoginEventSchema, 'login_events');

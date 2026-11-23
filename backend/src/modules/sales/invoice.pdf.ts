import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import type { SaleDoc } from './sales.models.js';
import type { SettingsDoc } from '../settings/settings.model.js';
import { env } from '../../config/env.js';
import { localDateKey } from '../../utils/dates.js';

const m = (c: number) => (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function logoPath(s: SettingsDoc) {
  if (!s.logoUrl?.startsWith('/uploads/')) return null;
  const p = path.resolve(env.UPLOAD_DIR, s.logoUrl.replace('/uploads/', ''));
  return fs.existsSync(p) && /\.(png|jpe?g)$/i.test(p) ? p : null;
}

/** Render an issued invoice as PDF. Content comes only from the stored sale snapshot. */
export function renderInvoicePdf(res: Response, sale: SaleDoc, s: SettingsDoc, format: 'a4' | 'thermal', payments: { method: string; amount: number }[]) {
  const thermal = format === 'thermal';
  const width = thermal ? 226 : 595.28;
  const height = thermal ? 200 + sale.items.length * 34 + 260 : 841.89;
  const margin = thermal ? 10 : 40;
  const doc = new PDFDocument({ size: [width, height], margin });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${sale.invoiceNo}.pdf"`);
  doc.pipe(res);
  const inner = width - margin * 2;
  const date = `${localDateKey(sale.date, s.timezone)} ${sale.date.toLocaleTimeString('en-GB', { timeZone: s.timezone, hour: '2-digit', minute: '2-digit' })}`;

  const logo = logoPath(s);
  if (logo && !thermal) doc.image(logo, margin, margin, { fit: [80, 50] });
  doc
    .font('Helvetica-Bold')
    .fontSize(thermal ? 11 : 18)
    .text(s.businessName, thermal ? margin : margin + (logo ? 90 : 0), margin, { width: inner - (logo && !thermal ? 90 : 0), align: thermal ? 'center' : 'left' });
  doc.font('Helvetica').fontSize(thermal ? 7 : 9);
  const contact = [s.address, s.phone, s.email].filter(Boolean).join(' · ');
  if (contact) doc.text(contact, { width: inner - (logo && !thermal ? 90 : 0), align: thermal ? 'center' : 'left' });
  doc.moveDown(thermal ? 0.5 : 1);
  doc.x = margin;

  doc
    .font('Helvetica-Bold')
    .fontSize(thermal ? 9 : 14)
    .text(thermal ? `RECEIPT ${sale.invoiceNo}` : 'SALES INVOICE', { align: thermal ? 'center' : 'left' });
  doc.font('Helvetica').fontSize(thermal ? 7 : 9);
  if (!thermal) doc.text(`Invoice No: ${sale.invoiceNo}`);
  doc.text(`Date: ${date}`, { align: thermal ? 'center' : 'left' });
  doc.text(`Customer: ${sale.customerName}${sale.customerPhone ? ` (${sale.customerPhone})` : ''}`, { align: thermal ? 'center' : 'left' });
  if (sale.createdByName) doc.text(`Served by: ${sale.createdByName}`, { align: thermal ? 'center' : 'left' });
  doc.moveDown(0.6);

  const cols = thermal
    ? [
        { h: 'Item', w: inner * 0.5 },
        { h: 'Qty', w: inner * 0.12, r: true },
        { h: 'Price', w: inner * 0.18, r: true },
        { h: 'Total', w: inner * 0.2, r: true },
      ]
    : [
        { h: 'SKU', w: 80 },
        { h: 'Description', w: 185 },
        { h: 'Qty', w: 35, r: true },
        { h: 'Unit price', w: 70, r: true },
        { h: 'Discount', w: 60, r: true },
        { h: 'Amount', w: inner - 430, r: true },
      ];
  const row = (cells: string[], bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(thermal ? 7 : 9);
    let x = margin;
    let h = 0;
    cells.forEach((c, i) => {
      h = Math.max(h, doc.heightOfString(c, { width: cols[i].w - 3 }));
    });
    cells.forEach((c, i) => {
      doc.text(c, x, y, { width: cols[i].w - 3, align: cols[i].r ? 'right' : 'left' });
      x += cols[i].w;
    });
    doc.y = y + h + 3;
  };
  row(
    cols.map((c) => c.h),
    true,
  );
  doc
    .moveTo(margin, doc.y - 1)
    .lineTo(width - margin, doc.y - 1)
    .strokeColor('#888')
    .stroke();
  for (const it of sale.items) {
    const disc = it.discount + it.cartDiscountShare;
    const label = `${it.name}${it.partNumber ? ` [${it.partNumber}]` : ''}${it.warrantyMonths ? ` · ${it.warrantyMonths}m warranty` : ''}`;
    if (thermal) row([`${it.sku} ${label}`, String(it.qty), m(it.unitPrice), m(it.qty * it.unitPrice - disc)]);
    else row([it.sku, label, String(it.qty), m(it.unitPrice), disc ? m(disc) : '—', m(it.qty * it.unitPrice - disc)]);
  }
  doc
    .moveTo(margin, doc.y)
    .lineTo(width - margin, doc.y)
    .strokeColor('#888')
    .stroke();
  doc.moveDown(0.4);

  const tot = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(thermal ? 8 : 10);
    doc.text(label, margin, y, { width: inner * 0.6, align: 'right' });
    doc.text(value, margin + inner * 0.6, y, { width: inner * 0.4, align: 'right' });
  };
  const gross = sale.items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  const disc = sale.items.reduce((a, i) => a + i.discount + i.cartDiscountShare, 0);
  tot('Subtotal', m(gross));
  if (disc) tot('Discount', `-${m(disc)}`);
  if (sale.taxTotal) tot(`${s.taxName}${sale.pricesIncludeTax ? ' (included)' : ''} ${(sale.taxRateBps / 100).toFixed(2)}%`, m(sale.taxTotal));
  tot(`TOTAL (${s.currency})`, m(sale.total), true);
  for (const p of payments) tot(`Paid — ${p.method.replace('_', ' ').toLowerCase()}`, m(p.amount));
  if (sale.returnedAmount) tot('Returned', `-${m(sale.returnedAmount)}`);
  if (sale.refundedAmount) tot('Refunded', m(sale.refundedAmount));
  tot('Balance due', m(Math.max(0, sale.balanceDue)), true);
  if (sale.dueDate && sale.balanceDue > 0) tot('Due date', localDateKey(sale.dueDate, s.timezone));

  doc.moveDown(1);
  doc.x = margin;
  doc
    .font('Helvetica')
    .fontSize(thermal ? 6.5 : 8)
    .fillColor('#444');
  if (s.returnPolicy) doc.text(`Returns: ${s.returnPolicy}`, { width: inner, align: thermal ? 'center' : 'left' });
  if (s.warrantyPolicy) doc.text(`Warranty: ${s.warrantyPolicy}`, { width: inner, align: thermal ? 'center' : 'left' });
  if (s.receiptFooter) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text(s.receiptFooter, { width: inner, align: 'center' });
  }
  doc.end();
}

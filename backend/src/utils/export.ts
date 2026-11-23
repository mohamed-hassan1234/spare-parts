import type { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface Column<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Treat as integer cents and render as currency. */
  money?: boolean;
  width?: number;
}

const fmtMoney = (c: number) => (c / 100).toFixed(2);

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T>(columns: Column<T>[], rows: T[]) {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((r) =>
    columns
      .map((c) => {
        const v = c.value(r);
        return csvCell(c.money && typeof v === 'number' ? fmtMoney(v) : v);
      })
      .join(','),
  );
  return '﻿' + [head, ...body].join('\r\n');
}

export async function sendTable<T>(res: Response, format: 'csv' | 'xlsx' | 'pdf', filename: string, title: string, columns: Column<T>[], rows: T[], subtitle?: string) {
  const safeName = filename.replace(/[^\w.-]/g, '_');
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
    res.send(toCsv(columns, rows));
    return;
  }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AutoParts ERP';
    const ws = wb.addWorksheet(title.slice(0, 31));
    ws.columns = columns.map((c) => ({ header: c.header, key: c.header, width: c.width ?? Math.max(12, c.header.length + 2) }));
    for (const r of rows) {
      ws.addRow(
        columns.map((c) => {
          const v = c.value(r);
          return c.money && typeof v === 'number' ? v / 100 : v;
        }),
      );
    }
    columns.forEach((c, i) => {
      if (c.money) ws.getColumn(i + 1).numFmt = '#,##0.00';
    });
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
    return;
  }
  // PDF
  const doc = new PDFDocument({ size: 'A4', layout: columns.length > 6 ? 'landscape' : 'portrait', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  doc.pipe(res);
  doc.fontSize(16).text(title);
  if (subtitle) doc.fontSize(9).fillColor('#555').text(subtitle).fillColor('#000');
  doc.moveDown(0.5);
  const width = doc.page.width - 72;
  const colW = width / columns.length;
  const drawRow = (cells: string[], bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    let h = 0;
    cells.forEach((cell, i) => {
      const opts = { width: colW - 4, align: (columns[i].money ? 'right' : 'left') as 'right' | 'left' };
      h = Math.max(h, doc.heightOfString(cell, opts));
    });
    if (y + h > doc.page.height - 50) {
      doc.addPage();
      return drawRow(cells, bold);
    }
    cells.forEach((cell, i) => doc.text(cell, 36 + i * colW, y, { width: colW - 4, align: columns[i].money ? 'right' : 'left' }));
    doc.y = y + h + 4;
    doc.x = 36;
  };
  drawRow(
    columns.map((c) => c.header),
    true,
  );
  doc
    .moveTo(36, doc.y - 2)
    .lineTo(36 + width, doc.y - 2)
    .strokeColor('#999')
    .stroke();
  for (const r of rows) {
    drawRow(
      columns.map((c) => {
        const v = c.value(r);
        return v == null ? '' : c.money && typeof v === 'number' ? fmtMoney(v) : String(v);
      }),
    );
  }
  doc
    .fontSize(7)
    .fillColor('#777')
    .text(`Generated ${new Date().toISOString()} — AutoParts ERP`, 36, doc.page.height - 40);
  doc.end();
}

/** Minimal RFC 4180 CSV parser. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^\uFEFF/, ''); // strip a UTF-8 byte-order mark (Excel CSV exports)
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/**
 * Read the first worksheet of an .xlsx file into header-keyed rows. Uses each cell's displayed
 * text (not its float value) so money such as 12.50 is parsed exactly by parseToCents.
 */
export async function parseXlsx(buf: Buffer): Promise<Record<string, string>[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => (headers[col] = String(c.text ?? '').trim()));
  const out: Record<string, string>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: Record<string, string> = {};
    let any = false;
    headers.forEach((h, col) => {
      if (!h) return;
      const t = String(row.getCell(col).text ?? '').trim();
      if (t) any = true;
      rec[h] = t;
    });
    if (any) out.push(rec);
  }
  return out;
}

/** True when the buffer is a ZIP container (xlsx). */
export const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

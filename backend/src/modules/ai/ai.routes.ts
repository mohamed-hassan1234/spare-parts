import { z } from 'zod';
import { ModuleRouter } from '../../utils/http.js';
import { aiEnabled, generateMonthlyReport } from './ai.service.js';
import { audit } from '../system/audit.service.js';
import { env } from '../../config/env.js';

export const aiRoutes = new ModuleRouter('/ai', 'AI Insights (optional)');

aiRoutes.get('/status', { summary: 'Whether the optional AI provider is configured', permission: 'reports:read' }, async () => ({ enabled: aiEnabled(), model: aiEnabled() ? env.AI_MODEL : null }));

aiRoutes.post(
  '/monthly-report',
  {
    summary: 'Generate the monthly management report. Figures always come from the ledger; AI (if configured) writes only the narrative.',
    permission: 'reports:read',
    status: 200,
    body: z.object({ period: z.enum(['thisMonth', 'prevMonth']).default('thisMonth') }),
  },
  async ({ body, ctx }) => {
    const out = await generateMonthlyReport(body.period);
    await audit(ctx, 'ai.monthly_report', 'Report', null, { summary: `${body.period} via ${out.source}` });
    return out;
  },
);

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import { routeRegistry } from './utils/http.js';

/** Build an OpenAPI 3.0 document from every route registered via ModuleRouter. */
export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  const toSchema = (z: ZodTypeAny) => {
    const s = zodToJsonSchema(z, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
    delete s.$schema;
    return s;
  };
  for (const r of routeRegistry) {
    const path = `/api/v1${r.path}`;
    const params: unknown[] = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    if (r.query) {
      const qs = toSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(qs.properties ?? {})) params.push({ name, in: 'query', required: qs.required?.includes(name) ?? false, schema });
    }
    for (const h of r.headers ?? [])
      params.push({
        name: h,
        in: 'header',
        required: false,
        schema: { type: 'string', minLength: 8, maxLength: 100 },
        description: 'Unique per logical operation; retries with the same key are safe.',
      });
    paths[path] ??= {};
    paths[path][r.method] = {
      tags: [r.tag],
      summary: r.summary,
      description: [
        r.permission ? `Requires permission \`${r.permission}\`.` : r.auth ? 'Requires an authenticated session.' : 'Public endpoint.',
        r.method !== 'get' && r.auth ? 'State-changing: send header `X-CSRF-Token`.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      security: r.auth ? [{ sessionCookie: [] }] : [],
      parameters: params,
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: toSchema(r.body) } } } } : {}),
      responses: {
        [r.status]: { description: 'Success. JSON responses are wrapped as `{ "data": ... }`; list endpoints return `{ items, total, page, limit, pages }`.' },
        400: { $ref: '#/components/responses/Error' },
        401: { $ref: '#/components/responses/Error' },
        403: { $ref: '#/components/responses/Error' },
        404: { $ref: '#/components/responses/Error' },
        409: { $ref: '#/components/responses/Error' },
        422: { $ref: '#/components/responses/Error' },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'AutoParts ERP API',
      version: '1.0.0',
      description:
        'All money values are integer minor units (cents). Dates are ISO-8601 UTC. Authentication uses an HttpOnly session cookie set by POST /auth/login; state-changing requests must include the X-CSRF-Token returned by /auth/login and /auth/me.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'ap_sid' } },
      responses: {
        Error: {
          description: 'Error',
          content: {
            'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } } },
          },
        },
      },
    },
    paths,
  };
}

// Single source of truth for API path prefixes. Consumers:
//   - server/index.ts — SPA fallback must not swallow unknown API paths
//   - vite.config.ts  — dev proxy forwards these from :5173 to :3000

export const API_PREFIXES = ['/auth', '/settings', '/products', '/entries'] as const;
export type ApiPrefix = (typeof API_PREFIXES)[number];

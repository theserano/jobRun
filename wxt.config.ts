import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // The Web Store rejects `key` and assigns its own; `npm run zip` builds in "store" mode to
  // drop it. Local builds keep it so the extension ID (and the Google redirect URL) stays fixed.
  manifest: ({ mode }) => ({
    permissions: ['tabs', 'storage', 'identity', 'activeTab', 'scripting'],
    ...(mode === 'store' ? {} : { key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw+mCojRi6vozXHQKqP1P3fcLQTay/LksME5ar+AsLRNi/hj+S//DADcmxu5riU1ukWdUcsX+aCDn9cxUPXrqy7l9CKcoxaUBrKxiiHCdQ/XT+xRoRJ3ydEoNtZvtOfoUdxUdKE1RPtIcjXzEdUfrtPcoxvY3SbFPPg0TjtptZPhjTypABRYim6DnzqAEJGjfVGCv1lSlM94G6eEMChqdFKbGjaxsn2OzBSM+5BvjtAPi0BH39uI6HxE8tbP7zL6JYJeghQzbh5fQMw0nEAoUARSnrfxxV2qhrIKjLUyKrOOXGaCxM4n1Q197N5GG5tfnBavUyz9D+Mn9NR6KHhk2bQIDAQAB' }),
    name: 'JobRun',
    description: 'A browser extension to track your job applications.',
    version: '1.0.0',
  }),
});

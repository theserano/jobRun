import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['tabs', 'storage', 'identity', 'activeTab', 'scripting'],
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw+mCojRi6vozXHQKqP1P3fcLQTay/LksME5ar+AsLRNi/hj+S//DADcmxu5riU1ukWdUcsX+aCDn9cxUPXrqy7l9CKcoxaUBrKxiiHCdQ/XT+xRoRJ3ydEoNtZvtOfoUdxUdKE1RPtIcjXzEdUfrtPcoxvY3SbFPPg0TjtptZPhjTypABRYim6DnzqAEJGjfVGCv1lSlM94G6eEMChqdFKbGjaxsn2OzBSM+5BvjtAPi0BH39uI6HxE8tbP7zL6JYJeghQzbh5fQMw0nEAoUARSnrfxxV2qhrIKjLUyKrOOXGaCxM4n1Q197N5GG5tfnBavUyz9D+Mn9NR6KHhk2bQIDAQAB',
    name: 'JobRun',
    description: 'A browser extension to track your job applications.',
    version: '1.0.0', 
  }
});

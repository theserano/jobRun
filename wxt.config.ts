import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['tabs', 'storage', 'activeTab', 'scripting'],
    name: 'JobRun',
    description: 'A browser extension to track your job applications.',
    version: '1.0.0',
  },
});

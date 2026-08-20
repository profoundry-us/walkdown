import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './checks',
  reporter: [['list'], ['walkdown/reporter']],
  use: {
    baseURL: process.env.APP_HOST ?? 'http://localhost:4310',
    screenshot: 'only-on-failure', // failing checks carry evidence into the run record
    // testIdAttribute defaults to 'data-testid' — matches blueprint/walkdown.yml
  },
  webServer: {
    command: 'python3 -m http.server 4310 --directory app',
    url: 'http://localhost:4310/index.html',
    reuseExistingServer: true,
  },
});

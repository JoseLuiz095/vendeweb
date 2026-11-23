import { defineConfig } from '@playwright/test';
import base from './modules.config';
export default defineConfig(base, {
  testMatch: 'rental-operations.spec.ts',
  use: { channel: undefined, launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} },
});

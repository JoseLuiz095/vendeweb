import { defineConfig } from '@playwright/test';
import base from './marketing-seo.config';
export default defineConfig({ ...base, testMatch: ['commercial-showcase.spec.ts'], outputDir: './test-results/landing-safety' });

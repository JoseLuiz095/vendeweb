import config from './modules.config';
export default { ...config, testMatch: 'printing3d.spec.ts', use: { ...config.use, channel: process.env.PLAYWRIGHT_CHANNEL || undefined } };

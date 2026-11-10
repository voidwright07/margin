import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  runner: { disabled: true },
  manifest: ({ browser }) => ({
    name: 'Margin for Hacker News',
    description: 'A calm, readable redesign of every Hacker News page. Free, local, no tracking.',
    permissions: ['storage'],
    host_permissions: ['https://news.ycombinator.com/*'],
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'margin-for-hn@margin.local', strict_min_version: '115.0' } } }
      : {}),
  }),
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
});

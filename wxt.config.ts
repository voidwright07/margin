import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  runner: { disabled: true },
  zip: { excludeSources: ['todo.md', '.cache/**', 'fixtures/**'] },
  manifest: ({ browser }) => ({
    name: 'Margin for Hacker News',
    description: 'A calm, readable redesign of every Hacker News page. Free, local, no tracking.',
    permissions: ['storage'],
    host_permissions: ['https://news.ycombinator.com/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'margin-for-hn@margin.local',
              strict_min_version: '115.0',
              // Firefox asks every new extension to declare data collection; Margin collects nothing.
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  }),
});

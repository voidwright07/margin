import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

const read = (path: string) => readFileSync(path, 'utf8').trim();

export default defineConfig({
  srcDir: 'src',
  runner: { disabled: true },
  hooks: {
    // MIT asks for its notice in every copy, so the extension ships Margin's license and that of Preact, which it bundles.
    'build:publicAssets': (_wxt, files) => {
      files.push({
        relativeDest: 'LICENSE.txt',
        contents: `${read('LICENSE')}\n\n---\n\nThis extension includes Preact (https://preactjs.com):\n\n${read('node_modules/preact/LICENSE')}\n`,
      });
    },
  },
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

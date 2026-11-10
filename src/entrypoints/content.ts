export default defineContentScript({
  matches: ['https://news.ycombinator.com/*'],
  runAt: 'document_start',
  main() {},
});

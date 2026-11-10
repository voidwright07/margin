import '../ui/tokens.css';
import '../ui/app.css';
import '../ui/thread.css';
import { boot } from '../app/boot';

export default defineContentScript({
  matches: ['https://news.ycombinator.com/*'],
  runAt: 'document_start',
  main() {
    void boot();
  },
});

import { Component, type ComponentChildren } from 'preact';
import type { Page } from '../hn/types';
import { Header } from './Header';
import { IconSearch } from './icons';
import { ItemView } from './ItemView';
import { LibraryDrawer } from './Library';
import { usePanel } from './panels';
import { StoryIndex } from './StoryIndex';
import { Toasts } from './toast';
import { CommentListing, Passthrough, Profile } from './Views';

function Main({ page }: { page: Page }) {
  switch (page.kind) {
    case 'stories':
      return <StoryIndex page={page} />;
    case 'comments':
      return <CommentListing page={page} />;
    case 'item':
      return <ItemView page={page} />;
    case 'user':
      return <Profile page={page} />;
    case 'passthrough':
      return <Passthrough page={page} />;
    default: {
      const unreachable: never = page;
      return unreachable;
    }
  }
}

function Footer() {
  return (
    <footer class="mg-foot">
      <form class="mg-search" method="get" action="https://hn.algolia.com/" role="search">
        <IconSearch size={15} />
        <input class="mg-input" type="search" name="q" placeholder="Search Hacker News" aria-label="Search Hacker News on hn.algolia.com" />
      </form>
      <nav class="mg-foot-links">
        <a href="newsguidelines.html">Guidelines</a>
        <a href="newsfaq.html">FAQ</a>
        <a href="lists">Lists</a>
        <a href="https://github.com/HackerNews/API">API</a>
        <a href="security.html">Security</a>
        <a href="https://www.ycombinator.com/legal/">Legal</a>
        <a href="https://www.ycombinator.com/apply/">Apply to YC</a>
        <a href="mailto:hn@ycombinator.com">Contact</a>
      </nav>
    </footer>
  );
}

/** A render error must never leave a blank page: report it so the boot code restores the original. */
class Guard extends Component<{ onError: (e: unknown) => void; children: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false };
  override componentDidCatch(error: unknown) {
    this.setState({ failed: true });
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Scrim() {
  const [panel, setPanel] = usePanel();
  if (panel === null) return null;
  return <div class="mg-scrim" onClick={() => setPanel(null)} />;
}

export function App({ page, onError, extras }: { page: Page; onError: (e: unknown) => void; extras?: ComponentChildren }) {
  return (
    <Guard onError={onError}>
      <div class={`mg-app mg-kind-${page.kind}`}>
        <Header meta={page.meta} />
        <Scrim />
        <main class="mg-main" id="mg-main">
          <Main page={page} />
        </main>
        <Footer />
        <LibraryDrawer />
        <Toasts />
        {extras}
      </div>
    </Guard>
  );
}

import { Component, type ComponentChildren } from 'preact';
import type { Page, SearchQuery } from '../hn/types';
import { Header } from './Header';
import { ItemView } from './ItemView';
import { LibraryDrawer } from './Library';
import { ControlPad, HelpOverlay, HoverCard, KeyboardLayer, SelectionPopup } from './Overlays';
import { usePanel } from './panels';
import { SearchView } from './Search';
import { SearchContext, useSearchController } from './searchState';
import { StoryIndex } from './StoryIndex';
import { Toasts } from './toast';
import { CommentListing, Passthrough, Profile } from './Views';

function Main({ page }: { page: Page }) {
  switch (page.kind) {
    case 'stories':
      return <StoryIndex page={page} />;
    case 'search':
      return <SearchView />;
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

/** The search page's live state, shared by the top-bar field and the results. */
function SearchProvider({ query, children }: { query: SearchQuery; children: ComponentChildren }) {
  return <SearchContext.Provider value={useSearchController(query)}>{children}</SearchContext.Provider>;
}

export function App({ page, onError, extras }: { page: Page; onError: (e: unknown) => void; extras?: ComponentChildren }) {
  const shell = (
    <div class={`mg-app mg-kind-${page.kind}`}>
      <Header meta={page.meta} />
      <Scrim />
      <main class="mg-main" id="mg-main">
        <Main page={page} />
      </main>
      <Footer />
      <LibraryDrawer />
      <HelpOverlay />
      <HoverCard />
      <SelectionPopup />
      <KeyboardLayer />
      {page.kind !== 'passthrough' && <ControlPad />}
      <Toasts />
      {extras}
    </div>
  );
  return <Guard onError={onError}>{page.kind === 'search' ? <SearchProvider query={page.query}>{shell}</SearchProvider> : shell}</Guard>;
}

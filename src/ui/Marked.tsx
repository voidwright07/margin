import { markTerms } from '../search/match';

/** Text with search terms wrapped in <mark>. Every segment renders as a text node; nothing is parsed as HTML. */
export function Marked({ text, terms }: { text: string; terms: string[] }) {
  return <>{markTerms(text, terms).map((s) => (s.match ? <mark class="mg-match">{s.text}</mark> : s.text))}</>;
}

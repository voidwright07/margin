/** A link exactly as HN wrote it: absolute, or relative to news.ycombinator.com. */
export type Href = string & { readonly __brand: 'Href' };

export const SECTIONS = [
  'news',
  'newest',
  'front',
  'newcomments',
  'ask',
  'show',
  'jobs',
  'best',
  'active',
  'bestcomments',
  'threads',
  'submitted',
  'favorites',
  'from',
  'item',
  'user',
  'lists',
] as const;
export type Section = (typeof SECTIONS)[number];

export type Viewer = { name: string; karma: number; logout: Href } | null;

export type PageMeta = {
  viewer: Viewer;
  url: URL;
  section: Section | null;
  notice: string | null;
};

export type StoryAction =
  | 'upvote'
  | 'unvote'
  | 'downvote'
  | 'hide'
  | 'unhide'
  | 'fave'
  | 'unfave'
  | 'flag'
  | 'unflag'
  | 'past'
  | 'edit'
  | 'delete';

export type CommentAction =
  | 'upvote'
  | 'unvote'
  | 'downvote'
  | 'reply'
  | 'edit'
  | 'delete'
  | 'flag'
  | 'unflag'
  | 'fave'
  | 'unfave'
  | 'context';

export type Story = {
  type: 'story';
  id: number;
  rank: number | null;
  title: string;
  url: Href;
  site: string | null;
  score: number | null;
  by: string | null;
  /** ISO timestamp (UTC) from span.age[title]. */
  time: string;
  ageText: string;
  /** null for jobs and when there is no discuss link. */
  comments: number | null;
  /** toptext HTML (Ask HN / item page only). */
  text: string | null;
  dead: boolean;
  flagged: boolean;
  actions: Partial<Record<StoryAction, Href>>;
};

export type Comment = {
  type: 'comment';
  id: number;
  /** Empty string for [deleted] comments. */
  by: string;
  time: string;
  ageText: string;
  /** innerHTML of .commtext; HN already sanitizes it. */
  html: string;
  depth: number;
  dead: boolean;
  deleted: boolean;
  story: { id: number; title: string } | null;
  parentId: number | null;
  actions: Partial<Record<CommentAction, Href>>;
};

export type ReplyForm = {
  action: Href;
  /** Hidden inputs: parent, goto, hmac. */
  fields: Record<string, string>;
  textName: 'text';
};

export type UserProfile = {
  id: string;
  /** Unix seconds, from td[timestamp]. */
  created: number;
  createdText: string;
  karma: number;
  /** About HTML, null when empty. */
  about: string | null;
  /** True on your own profile, where HN renders the settings form. */
  editable: boolean;
};

export type Page =
  | { kind: 'stories'; meta: PageMeta; stories: Story[]; more: Href | null; heading: string | null }
  | { kind: 'comments'; meta: PageMeta; comments: Comment[]; more: Href | null }
  | {
      kind: 'item';
      meta: PageMeta;
      root: Story | Comment;
      form: ReplyForm | null;
      comments: Comment[];
      more: Href | null;
    }
  | { kind: 'user'; meta: PageMeta; user: UserProfile }
  | { kind: 'passthrough'; meta: PageMeta };

export type PageKind = Page['kind'];

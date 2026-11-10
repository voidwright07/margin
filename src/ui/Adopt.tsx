import { useLayoutEffect, useRef } from 'preact/hooks';

/**
 * Move original HN nodes (forms, settings) into the new layout, and put each back exactly where it was on
 * unmount, so switching to the original design restores an untouched page.
 */
export function Adopt({ nodes, class: cls }: { nodes: () => Node[]; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current!;
    const moved = nodes().map((node) => ({ node, parent: node.parentNode, next: node.nextSibling }));
    for (const { node } of moved) host.appendChild(node);
    return () => {
      for (const { node, parent, next } of moved.reverse()) {
        if (parent) parent.insertBefore(node, next && next.parentNode === parent ? next : null);
      }
    };
  }, []);
  return <div ref={ref} class={cls} />;
}

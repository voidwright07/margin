/**
 * Re-apply saved highlights by text match inside one rendered node. A match may span several text nodes
 * (for example across an <i>), so offsets are computed over the node's concatenated text.
 */
export const applyHighlights = (root: HTMLElement, items: Array<{ id: string; text: string }>): void => {
  for (const { id, text } of items) {
    const needle = text.trim();
    if (!needle) continue;
    const nodes: Array<{ node: Text; start: number }> = [];
    let full = '';
    const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n as Text, start: full.length });
      full += n.textContent ?? '';
    }
    const at = full.indexOf(needle);
    if (at < 0) continue;
    const end = at + needle.length;
    for (const { node, start } of nodes) {
      const len = node.data.length;
      const from = Math.max(at, start) - start;
      const to = Math.min(end, start + len) - start;
      if (to <= 0 || from >= len || from >= to) continue;
      const doc = root.ownerDocument;
      const mark = doc.createElement('mark');
      mark.className = 'mg-hl';
      mark.dataset.hl = id;
      mark.textContent = node.data.slice(from, to);
      const parts = [doc.createTextNode(node.data.slice(0, from)), mark, doc.createTextNode(node.data.slice(to))];
      for (const part of parts) node.parentNode!.insertBefore(part, node);
      node.parentNode!.removeChild(node);
    }
  }
};

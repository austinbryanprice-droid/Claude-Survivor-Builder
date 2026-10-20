/** Creates an element with an optional class name and text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A rounded key cap, as used in the HUD's key hints. */
export function keycap(label: string): HTMLElement {
  return el('kbd', 'key', label);
}

// The page's three helpers, so that drawing a list reads as the list it draws.
// Nothing here touches the SDK.

type tChild = Node | string | false | null | undefined;

/**
 * An element with its properties set and its children in it:
 * `h("li", { className: "song" }, name)`.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: tChild[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  const shown = children.filter(
    (child) => child !== false && child !== null && child !== undefined,
  );
  element.append(...shown);
  return element;
}

/**
 * A button that does `onClick` when it is pressed:
 * `button("Play", () => { play(song); })`.
 */
export function button(
  label: string,
  onClick: () => void,
  props: Partial<HTMLButtonElement> = {},
): HTMLButtonElement {
  return h("button", {
    type: "button",
    textContent: label,
    onclick: onClick,
    ...props,
  });
}

/** The element with this id in index.html, which has to be of this kind. */
export function byId<T extends HTMLElement>(id: string, kind: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof kind)) {
    throw new Error(`index.html has no ${kind.name} with the id ${id}`);
  }
  return element;
}

// The page's two helpers, so that drawing a list reads as the list it draws. Nothing here touches the SDK.

type tChild = Node | string | false | null | undefined;

/** An element with its properties set and its children in it: `h("li", { className: "song" }, name)`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: tChild[]): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children.filter((child) => child !== false && child !== null && child !== undefined));
  return element;
}

/** The element with this id in index.html, which has to be of this kind. */
export function byId<T extends HTMLElement>(id: string, kind: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof kind)) throw new Error(`index.html has no ${kind.name} with the id ${id}`);
  return element;
}

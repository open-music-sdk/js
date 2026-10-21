// A guide's code follows the reader's frameworks. A block such as `::: for client=react` … `:::` holds what one or
// more frameworks show, and CSS shows the blocks of the frameworks the reader chose. Every block is in the built
// page, and the search finds each one as a result of its own, named for its frameworks.
import container from "markdown-it-container";
import { dataAttributes, labelOf, parseFor } from "./frameworks.mjs";

/**
 * How the reader sees what a block is for, such as `Vanilla, React` or `React · Workers`. The Next app, which is
 * both, is `Next.js` once.
 */
export const labelFor = (wanted) => {
  const sides = Object.entries(wanted).map(([axis, values]) => values.map((value) => labelOf(axis, value)).join(", "));
  return [...new Set(sides)].join(" · ");
};

/**
 * The `for` container. A block's id is the heading above it and its frameworks, so a link can name the variant:
 * `#after-sign-in--react`. A second block for the same frameworks under one heading has `-2` after the heading's
 * part, or the next number no other block of the page has, which keeps the frameworks at the end of the id.
 */
export function variantBlocks(md) {
  md.use(container, "for", {
    validate: (params) => /^for(\s|$)/.test(params.trim()),
    render(tokens, idx, _options, env) {
      const token = tokens[idx];
      if (token.nesting === -1) return "</div>\n";
      const wanted = parseFor(token.info.trim().slice("for".length));
      let heading = "top";
      for (let i = idx - 1; i >= 0; i--) {
        if (tokens[i].type === "heading_open") {
          heading = tokens[i].attrGet("id") ?? heading;
          break;
        }
      }
      const frameworks = Object.values(wanted).flat().join("-");
      env.variantIds ??= new Set();
      let id = `${heading}--${frameworks}`;
      // The next number free, since another heading's id can end in one too: a second "Install" is `install-1`.
      for (let n = 2; env.variantIds.has(id); n++) id = `${heading}-${n}--${frameworks}`;
      env.variantIds.add(id);
      const label = labelFor(wanted);
      return `<div class="for" id="${id}"${dataAttributes(wanted)} data-label="${label}" style="--for-label: '${label}'">\n`;
    },
  });
}

// VitePress's own way into a page's sections: each heading with its anchor link, and what follows it.
const HEADING = /<h(\d*).*?>(.*?<a.*? href="#.*?".*?>.*?<\/a>)<\/h\1>/gi;
const HEADING_CONTENT = /(.*?)<a.*? href="#(.*?)".*?>.*?<\/a>/i;
const textOf = (html) => html.replace(/<[^>]*>/g, "");

/** The variant blocks in a stretch of HTML, each with its id, label and inner HTML, and the HTML around them. */
function variantsIn(html) {
  const variants = [];
  let shared = "";
  let from = 0;
  const opening = /<div class="for" id="([^"]*)"[^>]*? data-label="([^"]*)"[^>]*>/g;
  let match;
  while ((match = opening.exec(html)) !== null) {
    shared += html.slice(from, match.index);
    // The block ends at the </div> that closes it: code blocks inside it are divs too, but their code is escaped.
    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = opening.lastIndex;
    let depth = 1;
    let tag;
    while (depth > 0 && (tag = tags.exec(html)) !== null) depth += tag[0] === "</div>" ? -1 : 1;
    const end = tag === null ? html.length : tag.index;
    variants.push({ id: match[1], label: match[2], html: html.slice(opening.lastIndex, end) });
    from = tag === null ? html.length : tags.lastIndex;
    opening.lastIndex = from;
  }
  return { shared: shared + html.slice(from), variants };
}

/**
 * The search's sections of a page: one per heading, as VitePress makes them, with each variant taken out and made
 * a section of its own. A variant's section is titled with its frameworks, under its heading, and anchored to the
 * first block for those frameworks there: "Sign a listener in › After sign-in › React".
 */
export function* splitIntoSections(_path, html) {
  const parts = html.split(HEADING);
  parts.shift();
  let parentTitles = [];
  for (let i = 0; i < parts.length; i += 3) {
    const level = Number.parseInt(parts[i], 10) - 1;
    const heading = HEADING_CONTENT.exec(parts[i + 1]);
    const title = textOf(heading?.[1] ?? "").trim();
    const anchor = heading?.[2] ?? "";
    const content = parts[i + 2];
    if (!title || !content) continue;
    let titles = parentTitles.slice(0, level);
    titles[level] = title;
    titles = titles.filter(Boolean);

    const { shared, variants } = variantsIn(content);
    yield { anchor, titles, text: textOf(shared) };
    const byLabel = new Map();
    for (const variant of variants) {
      const section = byLabel.get(variant.label);
      if (section) section.text += textOf(variant.html);
      else byLabel.set(variant.label, { anchor: variant.id, titles: [...titles, variant.label], text: textOf(variant.html) });
    }
    yield* byLabel.values();

    if (level === 0) parentTitles = [title];
    else parentTitles[level] = title;
  }
}

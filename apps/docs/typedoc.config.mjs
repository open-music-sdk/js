// The reference for every published package, each read from its source. `typedoc` writes it as Markdown to reference/,
// with a sidebar, for VitePress to build into the site; `typedoc --emit none` is the check a pull request runs, and it
// fails on a broken link, a name that is not exported, an export with no comment, and a function that leaves out an
// argument or what it returns (the plugin).
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// TypeDoc takes its paths as globs, which may hold neither a Windows separator nor a `..`, so every path here is an
// absolute posix one.
const join = (...parts) => parts.join("/").replaceAll("\\", "/");
const root = join(resolve(import.meta.dirname, "../.."));
const packages = globSync("{packages,clients,lib,integrations}/*/package.json", { cwd: root }).map((file) => join(dirname(file)));

// Siblings are read from src, not from their built declarations: those are one rolled-up file each, which TypeDoc
// cannot trace back to where a type was declared, so a link from one package to another would not resolve. Every
// entry a package exports is mapped, so `@open-music-sdk/developer-token/fetcher` resolves like the rest. A relative
// path here is read from apps/docs and ignored without a word, so they are absolute.
const paths = {};
for (const dir of packages) {
  const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  for (const entry of Object.keys(manifest.exports)) paths[entry === "." ? manifest.name : `${manifest.name}/${entry.slice(2)}`] = [join(root, dir, "src", entry === "." ? "index.ts" : `${entry.slice(2)}.ts`)];
}

const validation = { notExported: true, invalidLink: true, rewrittenLink: true, notDocumented: true };
// TypeDoc's own list, and a namespace such as `schemas`, which it does not ask a comment of by default.
const requiredToBeDocumented = ["Enum", "EnumMember", "Variable", "Function", "Class", "Interface", "Property", "Method", "Accessor", "TypeAlias", "Namespace"];

export default {
  name: "Reference",
  readme: "none",
  entryPointStrategy: "packages",
  entryPoints: packages.map((dir) => join(root, dir)),
  packageOptions: { entryPoints: ["src/index.ts"], compilerOptions: { paths }, validation, requiredToBeDocumented },
  validation,
  requiredToBeDocumented,
  plugin: ["typedoc-plugin-markdown", "typedoc-vitepress-theme", "./typedoc.plugin.mjs"],
  out: "reference",
  // Each package's README opens its page, rather than sitting on a page of its own.
  mergeReadme: true,
  useCodeBlocks: true,
  treatValidationWarningsAsErrors: true,
  treatWarningsAsErrors: true,
};

// Three things TypeDoc does not do by itself: show a function built by a generic builder with its arguments one by
// one, hold every function to saying what each argument is and what it returns, and document a re-exported name once,
// in the package that declares it. What a function throws is not checked here: a function with no @throws throws
// nothing, and no check can tell that from a forgotten tag, so it is read for in review.
import { readFileSync } from "node:fs";
import { dirname, sep } from "node:path";
import ts from "typescript";
import { Application, Converter, ParameterReflection, ReflectionFlag, ReflectionKind, ReflectionSymbolId } from "typedoc";

/** @param {Application} app */
export function load(app) {
  // server, browser and react re-export most of the family, and the clients re-export a few of core's types. Each
  // package is converted on its own, so without this a re-exported name would get a page under every package that
  // exports it, and a link to it could land on a copy. A package keeps what is declared in its own source; a namespace
  // such as `schemas` keeps its page and loses the members another package declares.
  const moved = [];
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    const { project } = context;
    // TypeDoc takes a removed name for one hidden on purpose, and drops every link to it. These are not hidden: they are
    // documented where they are declared, and the links are to land there when the packages are merged. So the marks
    // this adds are taken back. The map is TypeDoc's own, and an upgrade that changes it has to change this too.
    if (typeof project.removedSymbolIds?.keys !== "function") throw new Error("typedoc.plugin.mjs: TypeDoc no longer has removedSymbolIds; update the re-export filter");
    const hidden = new Set([...project.removedSymbolIds.keys()].map((id) => id.getStableKey()));
    const foreign = (reflection) => packageOf(reflection.sources?.[0]?.fullFileName) !== project.packageName;
    const move = (reflection) => {
      const id = project.getSymbolIdFromReflection(reflection);
      if (id) moved.push({ id: new ReflectionSymbolId(id.toObject()), name: reflection.getFriendlyFullName(), by: project.packageName });
      project.removeReflection(reflection);
    };
    for (const reflection of project.getChildrenByKind(ReflectionKind.SomeExport)) {
      if (!reflection.sources?.length) continue;
      if (reflection.kindOf(ReflectionKind.Namespace)) {
        for (const child of [...(reflection.children ?? [])]) if (foreign(child)) move(child);
      } else if (foreign(reflection)) move(reflection);
    }
    for (const id of [...project.removedSymbolIds.keys()]) if (!hidden.has(id.getStableKey())) project.removedSymbolIds.delete(id);
  });

  // That holds only while the declaring package exports the name from its index too. One that is declared in a package
  // but reached only through another's re-export, or a subpath entry, would leave the reference with no page for it,
  // and every link to it dead. Once the packages are merged, each moved name has to be found.
  app.on(Application.EVENT_PROJECT_REVIVE, (project) => {
    for (const { id, name, by } of moved)
      if (!project.getReflectionFromSymbolId(id)) app.logger.validationWarning(`${name}, exported by ${by}, has a page in no package: export it from the index of the package that declares it`);
  });

  app.converter.on(Converter.EVENT_CREATE_SIGNATURE, (context, signature) => {
    // A const with @function is shown as a function, with the signature its type declares. That signature is core's
    // tEndpoint call signature, and TypeDoc would take the comment written there, the same for all 137, over the one
    // written on the const. The const's own comment is the function's.
    const declared = signature.parent.kindOf(ReflectionKind.Function) && signature.parent.comment && context.getSymbolFromReflection(signature.parent)?.declarations?.some((node) => ts.isVariableDeclaration(node));
    if (declared) {
      signature.comment = signature.parent.comment.clone();
      signature.comment.removeModifier("@function"); // its work is done, and it would be shown as a chip
      signature.parent.comment = undefined; // or the page shows the comment twice
    }

    // A function made by a builder takes its arguments as one rest tuple: ...args: [id: string, options?: X].
    // TypeScript shows them one by one, and so does this, which gives @param id an argument to belong to.
    const rest = signature.parameters?.at(-1);
    if (!rest?.flags.isRest || rest.type?.type !== "tuple" || !rest.type.elements.every((member) => member.type === "namedTupleMember")) return;
    signature.parameters.pop();
    context.project.removeReflection(rest);
    for (const member of rest.type.elements) {
      const parameter = new ParameterReflection(member.name, ReflectionKind.Parameter, signature);
      parameter.type = member.element;
      parameter.setFlag(ReflectionFlag.Optional, member.isOptional);
      context.project.registerReflection(parameter, undefined, undefined);
      signature.parameters.push(parameter);
    }
  });

  // Every function and method says what each argument is and, unless it returns nothing, what it returns.
  app.on(Application.EVENT_VALIDATE_PROJECT, (project) => {
    for (const signature of project.getReflectionsByKind(ReflectionKind.CallSignature)) {
      if (!signature.parent.kindOf(ReflectionKind.Function | ReflectionKind.Method)) continue;
      if (signature.parent.flags.isInherited || signature.parent.flags.isExternal) continue;
      const name = `${signature.parent.getFriendlyFullName()}, defined in ${signature.parent.sources?.[0]?.fileName ?? "an unknown file"},`;
      for (const parameter of signature.parameters ?? [])
        if (!parameter.comment?.summary.length) app.logger.validationWarning(`${name} has no @param for ${parameter.name}`);
      if (!signature.comment?.getTag("@returns") && !returnsNothing(signature.type)) app.logger.validationWarning(`${name} has no @returns`);
    }
  });
}

/** The name in the nearest package.json above a source file. */
const packages = new Map();
const packageOf = (file) => {
  if (!file) return undefined;
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    if (packages.has(dir)) return packages.get(dir);
    try {
      const name = JSON.parse(readFileSync(`${dir}${sep}package.json`, "utf8")).name;
      packages.set(dir, name);
      return name;
    } catch {
      // no package.json here; look further up
    }
  }
  return undefined;
};

/** `void`, `undefined`, or a promise of either. */
const returnsNothing = (type) =>
  (type?.type === "intrinsic" && (type.name === "void" || type.name === "undefined")) ||
  (type?.type === "reference" && type.name === "Promise" && type.typeArguments?.length === 1 && returnsNothing(type.typeArguments[0]));

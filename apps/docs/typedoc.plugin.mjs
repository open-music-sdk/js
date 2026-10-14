// Two things TypeDoc does not do by itself: show a function built by a generic builder with its arguments one by
// one, and hold every function to saying what each argument is and what it returns. What a function throws is not
// checked here: a function with no @throws throws nothing, and no check can tell that from a forgotten tag, so it
// is read for in review.
import { Application, Converter, ParameterReflection, ReflectionFlag, ReflectionKind } from "typedoc";

/** @param {Application} app */
export function load(app) {
  // A function made by a builder takes its arguments as one rest tuple: ...args: [id: string, options?: X].
  // TypeScript shows them one by one, and so does this, which gives @param id an argument to belong to.
  app.converter.on(Converter.EVENT_CREATE_SIGNATURE, (context, signature) => {
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

/** `void`, `undefined`, or a promise of either. */
const returnsNothing = (type) =>
  (type?.type === "intrinsic" && (type.name === "void" || type.name === "undefined")) ||
  (type?.type === "reference" && type.name === "Promise" && type.typeArguments?.length === 1 && returnsNothing(type.typeArguments[0]));

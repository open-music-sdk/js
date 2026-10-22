<!--
  On a page for some frameworks alone, a notice for a reader who chose others, with a button that switches to the
  page's own. It is on the page for everyone, and CSS shows it to those readers alone, from the choice the head script
  put on <html>, so it is right from the first paint, as the variants are.
-->
<script setup>
import { useData } from "vitepress";
import { computed } from "vue";
import { VALUES, labelOf, parseFor, settle } from "../frameworks.mjs";

const { frontmatter } = useData();
const scope = computed(() => (frontmatter.value.for ? parseFor(frontmatter.value.for) : undefined));
// As attributes, the frameworks the page is for: `{ "data-client": "react nextjs" }`.
const attributes = computed(() =>
  Object.fromEntries(Object.entries(scope.value ?? {}).map(([axis, values]) => [`data-${axis}`, values.join(" ")])),
);
// Each choice's first framework, which the button switches to.
const first = computed(() => Object.fromEntries(Object.entries(scope.value ?? {}).map(([axis, values]) => [axis, values[0]])));
// In words, the frameworks of a scope, or of `first`, where each choice has one: "React and Next.js".
const names = (wanted) => {
  const labels = [...new Set(Object.entries(wanted).flatMap(([axis, values]) => [values].flat().map((value) => labelOf(axis, value))))];
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};

function show() {
  const settled = settle(VALUES, location.href, first.value);
  window.dispatchEvent(new CustomEvent("frameworks", { detail: settled }));
  // The notice, and the button in it, are hidden now, so the focus goes on to the page's heading.
  const heading = document.querySelector(".vp-doc h1");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus();
}
</script>

<template>
  <div v-if="scope" class="for-notice" v-bind="attributes">
    <p>
      This guide is for {{ names(scope) }}, which you haven't picked.
      <button type="button" @click="show">Switch to {{ names(first) }}</button>
    </p>
  </div>
</template>

<!--
  The pager of a page in Guides' sidebar, in place of the theme's, which would link a guide for frameworks the reader
  didn't choose. Where the page before or after differs with the choice, it has a link for each client and server the
  reader may choose (see `neighbours` in config.mjs), and CSS shows the reader's, as it does a variant.
-->
<script setup>
import { useData, withBase } from "vitepress";

const { frontmatter } = useData();
const SIDES = { prev: "Previous page", next: "Next page" };
</script>

<template>
  <nav v-if="frontmatter.pager" class="framework-pager" aria-labelledby="framework-pager-label">
    <span id="framework-pager-label" class="visually-hidden">Pager</span>
    <div v-for="(label, side) in SIDES" :key="side" class="pager">
      <a
        v-for="target in frontmatter.pager[side]"
        :key="`${target.link} ${target.for?.client} ${target.for?.server}`"
        :class="['pager-link', side, { for: target.for }]"
        :data-client="target.for?.client"
        :data-server="target.for?.server"
        :href="withBase(target.link)"
      >
        <span class="desc">{{ label }}</span>
        <span class="title">{{ target.text }}</span>
      </a>
    </div>
  </nav>
</template>

<!--
  The reader's choice of client and server frameworks. Every copy on the page shows the same choice: a change in one
  settles it, and the `frameworks` event tells the others.
-->
<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { AXES, AXIS_LABELS, VALUES, settle } from "../frameworks.mjs";

// The server render shows the defaults; the head script has already put the reader's own on <html>. So the picker
// stays hidden, in its place, until it shows theirs, and with scripts off, where it would do nothing.
const choice = ref({ client: VALUES.client[0], server: VALUES.server[0] });
const mounted = ref(false);

function follow(event) {
  choice.value = event.detail;
}

onMounted(() => {
  const { client, server } = document.documentElement.dataset;
  choice.value = { client, server };
  mounted.value = true;
  window.addEventListener("frameworks", follow);
});

onUnmounted(() => {
  window.removeEventListener("frameworks", follow);
});

function pick(axis, value) {
  const settled = settle(VALUES, location.href, { [axis]: value });
  window.dispatchEvent(new CustomEvent("frameworks", { detail: settled }));
}
</script>

<template>
  <div class="framework-picker" :class="{ mounted }">
    <label v-for="(frameworks, axis) in AXES" :key="axis">
      <span>{{ AXIS_LABELS[axis] }}</span>
      <select
        :value="choice[axis]"
        @change="pick(axis, $event.target.value)"
      >
        <option
          v-for="framework in frameworks"
          :key="framework.value"
          :value="framework.value"
        >
          {{ framework.label }}
        </option>
      </select>
    </label>
  </div>
</template>

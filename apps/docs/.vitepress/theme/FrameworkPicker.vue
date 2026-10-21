<!--
  The reader's choice of client and server frameworks: a menu for each, drawn as the theme draws its search button
  and its menus, with each framework's logo. Every copy on the page shows the same choice: a change in one settles
  it, and the `frameworks` event tells the others.
-->
<script setup>
import { nextTick, onMounted, onUnmounted, ref, useId } from "vue";
import { AXES, AXIS_LABELS, VALUES, labelOf, settle } from "../frameworks.mjs";
import { LOGOS } from "./logos.mjs";

// The server render shows the defaults; the head script has already put the reader's own on <html>. So the picker
// stays hidden, in its place, until it shows theirs, and with scripts off, where it would do nothing.
const choice = ref({ client: VALUES.client[0], server: VALUES.server[0] });
const mounted = ref(false);
// The choice whose menu is open, if one is.
const open = ref();
const root = ref();
// The nav, the sidebar and a page can each hold a picker, so each one's ids are its own.
const id = useId();

function follow(event) {
  choice.value = event.detail;
}

// A press anywhere outside the picker closes its menu, as one outside the theme's own menus does.
function outside(event) {
  if (open.value !== undefined && !root.value.contains(event.target)) open.value = undefined;
}

onMounted(() => {
  const { client, server } = document.documentElement.dataset;
  choice.value = { client, server };
  mounted.value = true;
  window.addEventListener("frameworks", follow);
  document.addEventListener("pointerdown", outside);
});

onUnmounted(() => {
  window.removeEventListener("frameworks", follow);
  document.removeEventListener("pointerdown", outside);
});

const items = (axis) => [...root.value.querySelectorAll(`#${CSS.escape(`${id}-${axis}-menu`)} button`)];

/** Opens or closes a choice's menu; opened from the keyboard, it puts the focus on the framework chosen. */
async function toggle(axis, fromKeys) {
  open.value = open.value === axis ? undefined : axis;
  if (open.value === undefined || !fromKeys) return;
  await nextTick();
  items(axis).find((item) => item.getAttribute("aria-current") === "true")?.focus();
}

/** Closes a choice's menu, and puts the focus back on its button. */
function close(axis) {
  open.value = undefined;
  document.getElementById(`${id}-${axis}`)?.focus();
}

function pick(axis, value) {
  close(axis);
  const settled = settle(VALUES, location.href, { [axis]: value });
  window.dispatchEvent(new CustomEvent("frameworks", { detail: settled }));
}

// The theme closes the phone's sidebar on an Escape it hears when the key comes up, so the one that closed a menu
// goes no further than the picker.
let escaped = false;

// Down and Up open a menu and move through it, and Escape closes it.
function keys(event, axis) {
  if (event.key === "Escape" && open.value === axis) {
    event.preventDefault();
    escaped = true;
    close(axis);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  if (open.value !== axis) {
    toggle(axis, true);
    return;
  }
  const list = items(axis);
  const at = list.indexOf(document.activeElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  list[(at + step + list.length) % list.length].focus();
}

function keysUp(event) {
  if (event.key !== "Escape" || !escaped) return;
  escaped = false;
  event.stopPropagation();
}

// Focus that leaves a choice, by Tab, closes its menu.
function leave(event, axis) {
  if (open.value === axis && !event.currentTarget.contains(event.relatedTarget)) open.value = undefined;
}
</script>

<template>
  <div ref="root" class="framework-picker" :class="{ mounted }">
    <div
      v-for="(frameworks, axis) in AXES"
      :key="axis"
      class="framework-choice"
      :class="{ open: open === axis }"
      @keydown="keys($event, axis)"
      @keyup="keysUp"
      @focusout="leave($event, axis)"
    >
      <span :id="`${id}-${axis}-label`" class="framework-label">{{ AXIS_LABELS[axis] }}</span>
      <div class="framework-control">
        <button
          :id="`${id}-${axis}`"
          type="button"
          class="framework-button"
          aria-haspopup="true"
          :aria-expanded="open === axis"
          :aria-controls="`${id}-${axis}-menu`"
          :aria-labelledby="`${id}-${axis}-label ${id}-${axis}`"
          @click="toggle(axis, false)"
        >
          <svg class="framework-logo" viewBox="0 0 24 24" aria-hidden="true">
            <rect v-if="LOGOS[choice[axis]].ground" x="1" y="1" width="22" height="22" :fill="LOGOS[choice[axis]].ground" />
            <path :d="LOGOS[choice[axis]].path" :fill="LOGOS[choice[axis]].color" />
          </svg>
          <span>{{ labelOf(axis, choice[axis]) }}</span>
          <span class="vpi-chevron-down framework-chevron" aria-hidden="true" />
        </button>
        <ul v-show="open === axis" :id="`${id}-${axis}-menu`" class="framework-menu">
          <li v-for="framework in frameworks" :key="framework.value">
            <button
              type="button"
              class="framework-item"
              :aria-current="choice[axis] === framework.value"
              @click="pick(axis, framework.value)"
            >
              <svg class="framework-logo" viewBox="0 0 24 24" aria-hidden="true">
                <rect v-if="LOGOS[framework.value].ground" x="1" y="1" width="22" height="22" :fill="LOGOS[framework.value].ground" />
                <path :d="LOGOS[framework.value].path" :fill="LOGOS[framework.value].color" />
              </svg>
              {{ framework.label }}
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

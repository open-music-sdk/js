// The default theme, with the reader's choice of frameworks: a picker in the nav, at the top of the sidebar, and
// wherever a page puts <FrameworkPicker />, and the choice settled again before every page and anchor is shown.
import { inBrowser } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import { VALUES, settle } from "../frameworks.mjs";
import FrameworkPicker from "./FrameworkPicker.vue";
import "./frameworks.css";

/** Settles the choice for the address about to be shown, so a variant it names is showing when it's scrolled to. */
function follow(href) {
  const settled = settle(VALUES, new URL(href, location.href).href);
  window.dispatchEvent(new CustomEvent("frameworks", { detail: settled }));
}

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "nav-bar-content-before": () => h("div", { class: "framework-picker-nav" }, [h(FrameworkPicker)]),
      "sidebar-nav-before": () => h("div", { class: "framework-picker-sidebar" }, [h(FrameworkPicker)]),
    }),
  enhanceApp({ app, router }) {
    app.component("FrameworkPicker", FrameworkPicker);
    if (!inBrowser) return;
    // Before a page loads, whether a link or Back brought the reader there; and before VitePress scrolls to an
    // anchor on the same page, which it announces with a hashchange event first.
    router.onBeforePageLoad = (to) => follow(to);
    window.addEventListener("hashchange", () => follow(location.href));
  },
};

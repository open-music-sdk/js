// The page: each screen's module starts it as it loads, and the header's tabs switch between them.
import "./player";
import "./dig";
import "./sign-in";
import "./library";
import "./crate";
import "./send";

const tabs = document.querySelectorAll<HTMLButtonElement>("nav button");
for (const tab of tabs) {
  tab.onclick = () => {
    for (const each of tabs) {
      each.ariaPressed = String(each === tab);
      document.getElementById(each.value)?.toggleAttribute("hidden", each !== tab);
    }
  };
}

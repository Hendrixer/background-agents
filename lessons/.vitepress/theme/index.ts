import DefaultTheme from "vitepress/theme";
import "./workshop.css";

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof document === "undefined") return;

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button.copy");
      const block = button?.closest('div[class*="language-diff"]');
      if (!button || !block) return;

      const lines = Array.from(block.querySelectorAll("code .line"), (line) => line.textContent || "");
      const result = lines
        .filter((line) => !line.startsWith("-"))
        .map((line) => line.startsWith("+") || line.startsWith(" ") ? line.slice(1) : line)
        .join("\n");

      event.preventDefault();
      event.stopImmediatePropagation();
      void navigator.clipboard.writeText(result).then(() => {
        button.classList.add("copied");
        window.setTimeout(() => button.classList.remove("copied"), 1800);
      });
    }, true);
  },
};

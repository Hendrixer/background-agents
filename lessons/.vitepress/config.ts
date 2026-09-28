import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Background Agents",
  description: "Build AI Agents that Never Sleep — workshop notes",
  appearance: "dark",
  ignoreDeadLinks: [/^https?:\/\/localhost/, /^https?:\/\/127\.0\.0\.1/],
  themeConfig: {
    nav: [{ text: "Incident Lab", link: "http://127.0.0.1:5173" }],
    sidebar: [
      { text: "00 · Course introduction", link: "/" },
      { text: "01 · Give the agent a goal", link: "/01-goal-and-harness/" },
      { text: "02 · Make progress durable", link: "/02-durable-execution/" },
      { text: "03 · Wait for the world", link: "/03-events-and-waiting/" },
      { text: "04 · Put a human in control", link: "/04-human-approval/" },
      { text: "05 · Make retries safe", link: "/05-safe-retries/" },
      { text: "06 · Run an incident drill", link: "/06-incident-drill/" },
      { text: "Advanced lab · Earn trust", link: "/advanced-lab/" },
    ],
    search: { provider: "local" },
  },
});

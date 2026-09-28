import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { lessons, editCues } = JSON.parse(readFileSync(join(root, "scripts/lesson-data.json"), "utf8"));
const check = process.argv.includes("--check");
const teachingFiles = ["server/agent-data.ts", "server/agent-workflow.ts", "server/lab-data.ts"];

function diffBlocks(start, solution) {
  const diff = execFileSync("git", ["diff", "--unified=3", start, solution, "--", ...teachingFiles], {
    cwd: root,
    encoding: "utf8",
  });
  const blocks = [];
  let file = "";
  let hunk = null;

  function saveHunk() {
    if (hunk?.length) blocks.push({ file, lines: hunk });
  }

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      saveHunk();
      file = line.split(" b/")[1];
      hunk = null;
    } else if (line.startsWith("@@ ")) {
      saveHunk();
      hunk = [];
    } else if (hunk && /^[ +\-]/.test(line) && !line.startsWith("+++ ") && !line.startsWith("--- ")) {
      hunk.push(line);
    }
  }
  saveHunk();
  return blocks;
}

function renderLesson(lesson, number) {
  const blocks = diffBlocks(lesson.start, lesson.solution);
  const cues = editCues[number];
  if (blocks.length !== cues.length) {
    throw new Error(`Lesson ${number}: ${blocks.length} code edits but ${cues.length} location cues`);
  }

  const concept = readFileSync(join(root, `scripts/lesson-prose/${String(number).padStart(2, "0")}.md`), "utf8").trim();
  const lines = [
    `# ${String(number).padStart(2, "0")} · ${lesson.title}`,
    "",
    `Start: \`${lesson.start}\` · Finished solution: \`${lesson.solution}\``,
    "",
    `**Outcome:** ${lesson.promise}`,
    "",
    "## The engineering idea",
    "",
    concept,
    "",
    "## See it in the lab",
    "",
    lesson.opening,
    "",
    "## Live coding",
    "",
    lesson.edit,
    "",
    "These code blocks are the exact changes between the start and solution branches. A new function is shown as complete TypeScript. In a diff, unprefixed context stays, green `+` lines are added, and red `-` lines are removed.",
    "",
  ];

  blocks.forEach(({ file, lines: diff }, index) => {
    const cue = cues[index];
    lines.push(`### Edit ${index + 1} · \`${file}\``, "");
    if (number === 3 && file === "server/agent-data.ts" && diff.some((line) => line.startsWith("+export function hasRecovered"))) {
      const added = diff.filter((line) => line.startsWith("+")).map((line) => line.slice(1));
      while (added.at(-1) === "") added.pop();
      lines.push(`${cue} The \`recordDecision\` function below it stays where it is.`, "", "```ts", ...added, "```", "");
    } else {
      lines.push(cue, "", "```diff", ...diff, "```", "");
    }
  });

  lines.push(
    "Run `npm run typecheck` after all edits. The intermediate file may not typecheck while a larger handler replacement is in progress.",
    "",
    "## Verify",
    "",
    lesson.verify,
    "",
    "## Break it on purpose",
    "",
    lesson.experiment,
    "",
    "## Engineering challenge",
    "",
    lesson.challenge,
    "",
    "## Catch up",
    "",
    `Your solution is \`${lesson.solution}\`. Check your work with \`git status --short\`. If you need to switch with unfinished edits, save them first with \`git stash push -u -m "lesson ${number} progress"\`, then \`git switch ${lesson.solution}\`. A branch switch changes code, not the PostgreSQL lab state or Inngest run history; reset the simulator for a clean demo.`,
    "",
    `**Common mistake:** ${lesson.mistakes}`,
    "",
    `**Optional extension:** ${lesson.extension}`,
    "",
  );
  return lines.join("\n");
}

lessons.forEach((lesson, index) => {
  const output = join(root, "lessons", lesson.slug, "index.md");
  const rendered = renderLesson(lesson, index + 1);
  if (check) {
    if (readFileSync(output, "utf8") !== rendered) throw new Error(`Lesson notes are out of sync: ${output}`);
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, rendered);
  }
});

if (check) console.log("All six lesson pages match their sources and branch checkpoints.");

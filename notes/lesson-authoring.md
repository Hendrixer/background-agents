# Lesson notes and code authoring contract

Status: six lesson pages and checkpoints built, September 28, 2026. Code blocks are generated from branch diffs by `scripts/build-notes.mjs` and verified with `npm run notes:check`.

## Purpose

The notes are both a student reference and Scott's coding script on a small podium monitor. They are written as Scott speaking to students: his point of view and the conceptual explanation come before code, with questions and experiments addressed directly to the reader. At every step, they must answer:

1. Which file do I open?
2. Where exactly does this edit go?
3. What do I remove, retain, or replace?
4. What exact code do I type?
5. What should work when I finish this step?

Use Markdown as the source and VitePress for local browsing, following the existing course tooling. The same Markdown must remain readable in an editor or on GitHub. Keep one student-facing lesson source; do not put third-person presenter instructions in the published lesson.

## Lesson page structure

1. Outcome and start/solution branches, without a time block in the lesson header.
2. A substantial engineering explanation in Scott's voice, including opinions, tradeoffs, and primary research or technical sources.
3. A concrete lab setup that shows the behavior under discussion.
4. Exact numbered live-coding edits in teaching order.
5. Verification, deliberate failure experiment, and an advanced engineering challenge.
6. Catch-up checkpoint, common mistakes, and an optional extension.

## Every coding step

Lead with the file path and a short location cue, then show the code in a fenced Markdown block. The code block itself must make it clear which surrounding code stays, what is added, and what is removed. Do not require Scott to reconstruct the edit from a prose operation checklist.

Use a normal language-tagged block for a new file or function. Use a focused `diff` block when modifying existing code:

- Unmarked context lines already exist and stay.
- Green `+` lines are added now.
- Red `-` lines are removed now.

The examples below illustrate presentation only. Their paths and code are not an implemented application or finalized lesson content.

### New file or function

`src/harness/policy.ts` — add this new function after the existing policy helpers:

```ts
export function requiresApproval(action: Action): boolean {
  return action.type === "rollback";
}
```

For a new file, include the entire file with all imports. For a new function in an existing file, name the actual neighboring function or unique insertion anchor in the lesson and show any new imports in a separate contextual diff.

### Adding code inside existing code

`src/harness/policy.ts` — inside `requiresApproval`, add the new condition before the existing return:

```diff
 export function requiresApproval(action: Action): boolean {
+  if (action.type === "disable-feature") {
+    return true;
+  }
+
   return action.type === "rollback";
 }
```

The function signature and existing return stay visible. Only the green lines are new.

### Removing or changing existing code

`src/harness/policy.ts` — inside `requiresApproval`, change the existing return:

```diff
 export function requiresApproval(action: Action): boolean {
-  return false;
+  return action.type === "rollback";
 }
```

This is an independent example. The red line comes out; the green line goes in. The rest remains unchanged.

For a move or deletion, name the exact paths and show affected imports or call sites as diffs. Keep short explanations and verification steps next to the relevant code.

## Presentation rules

- New files: show the complete file.
- New functions: show the complete new function and identify its insertion location.
- Modifications: use contextual fenced `diff` blocks as the primary teaching view, including unchanged lines immediately around the edit.
- Removals and replacements: show red `-` lines and green `+` lines together with unchanged context.
- Keep each diff focused on one logical edit. Include the enclosing function name or a unique nearby anchor; add enough context to distinguish repeated code.
- Do not make whole-function replacement instructions or separate before/after blocks the default for an incremental edit.
- Do not use `...` or “existing code here” as a substitute for the actual neighboring code in a diff. A focused excerpt may omit unrelated parts of the file outside the shown region.
- The notes renderer should highlight additions in green and removals in red. A copy control for a diff should copy the resulting code (context plus additions, without prefixes or removed lines), not the literal patch. New-file/function blocks copy normally.
- Do not rely on line numbers as the only location cue; earlier edits and student formatting change them.
- Include imports, call sites, exported types, config changes, and required commands. No “wire it up” gaps.
- Keep rationale close to its edit. Avoid requiring scrolling between distant explanations and code.
- Name a compile checkpoint after a coherent edit group. If a sequence temporarily fails to compile, say so before it starts and identify the step that restores a working app.
- Avoid unrelated formatting changes between lesson snapshots.
- Favor narrow code blocks that fit a small monitor. Rehearse at the actual display scale before freezing notes.
- Keep the required code blocks visible. Optional instructor cues and full-file references can sit below them.

## Code example derivation and validation

The code repository is the source of truth for code blocks. Markdown prose provides the teaching sequence and explanation.

The current authoring inputs are `scripts/lesson-data.json` for lesson structure and location cues, `scripts/lesson-prose/*.md` for the teaching explanation, and the adjacent Git branches for code. The Node generator reads them and writes the six Markdown pages. It refuses to generate a lesson if the number of diff hunks differs from its location cues.

Useful metadata for future finer-grained edits would include:

- Stable edit ID and lesson ID.
- File path and operation type.
- Base and target checkpoint, with intermediate commits or snapshots when needed.
- Export/function name or unique exact-text anchor.
- Expected old content and resulting content.
- Whether this is a runnable checkpoint.

Generate normal code blocks for new files/functions and contextual diffs for existing-code edits from those sources. Keep the generated Markdown in the repository so no custom application is required to read the notes.

The automated checker regenerates the pages in memory and compares them byte-for-byte with the committed Markdown. That detects drift between branch diffs and displayed code. It does **not** prove a person can apply the snippets in order or that the resulting behavior is correct. Rehearsal must also:

1. Start from the exact lesson start snapshot in a temporary working directory.
2. Apply the documented edits in order, using only the notes and their location cues.
3. Compare the resulting teaching files with the intended solution snapshot.
4. Run the typecheck and behavioral scenario at the completed lesson checkpoint.
5. Build the notes site and check the local lesson links.

If a patch fixes code on a completed branch, regenerate its affected notes and downstream checkpoints. Do not hand-edit a displayed code block independently of the implementation.

## Branch and catch-up experience

Preserve the course convention in the page header:

| Lesson | Start here | Finished solution |
| --- | --- | --- |
| 1 | `lesson-1` | `lesson-2` |
| 2 | `lesson-2` | `lesson-3` |
| 3 | `lesson-3` | `lesson-4` |
| 4 | `lesson-4` | `lesson-5` |
| 5 | `lesson-5` | `lesson-6` |
| 6 | `lesson-6` | `complete` |

All checkpoint branches above exist. The shared notes and generator are kept on every branch.

Students can type along, copy a complete edit block, or take the next checkpoint during the break. Catch-up instructions must preserve unfinished student work, including untracked files. Do not teach `git reset --hard` or delete student work as the default recovery path.

Keep `.env`, Neon credentials, simulator state, and runtime history out of Git. Document when branch switching requires stopping a run, resetting only the lab scenario, or restarting processes. A code checkout does not roll back persisted database or workflow history.

For the local docs server, keep the port separate from the app and Inngest. The final starter should expose `npm run docs`, `npm run docs:build`, and clear restart instructions if a branch change affects the running site.

## Instructor rehearsal checklist

- Read from the podium-sized window while coding on the main display.
- Open each file using only the instruction in the notes.
- Complete every edit without inspecting the solution branch.
- Confirm that code snippets match the checkpoint exactly.
- Run the demo recipe from a fresh scenario and inspect its expected trace.
- Record actual coding time and preserve a meaningful verification segment.
- Test catch-up from a dirty working tree without losing student changes.
- Treat a lesson that overruns as a scope problem; move plumbing to the starter or an extension before cutting the break.

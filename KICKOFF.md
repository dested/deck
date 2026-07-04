# Kickoff prompts for building Deck

Two prompts. Run **Prompt 1 with Opus 4.8** to build the whole app. Run **Prompt 2 with Fable** afterward (or earlier, only in the one situation described) as the polish/verification pass.

---

## Prompt 1 — the build (run with Opus 4.8, fresh session in `G:\code\agentcommunity`)

Read SPEC.md in this repo top to bottom before writing any code — it is the complete, locked specification for Deck, a localhost mission-control app for my projects and Claude Code agents. Follow it to the letter: the stack, the protocol, the design tokens, the screens, and especially the milestone order in §13 are all locked decisions. Do not substitute libraries, do not redesign the UI, do not skip the per-milestone verification steps.

Ground rules:

1. Build milestone by milestone (M0 → M6). At the end of each milestone: run `tsc --noEmit` in both packages until clean, then actually perform that milestone's ✅ verify steps against reality — real repos in G:\code, real transcripts in ~/.claude/projects, a real `claude` process. Do not mark a milestone done on the strength of "it compiles."
2. Where SPEC.md says "verify against reality" (transcript JSONL schema §7.1, the claude spawn method §5.1, the encoded-path mapping §4.2), inspect the real files/behavior on this machine first and build against what you find. The parser must never crash on an unknown line or block type.
3. The embedded terminal (§5.4) is the make-or-break feature. Implement every item on its checklist and run its acceptance test for real. If after two genuine debugging attempts the terminal still fails the bar (laggy typing, resize garbling ConPTY output, broken reattach after refresh), STOP at M2: write what you tried and what's still broken into cliffnotes.md under "## Handoff: terminal issues", then end your final message with exactly this line so I know what to do: **"M2 needs the Fable pass — run Prompt 2 from KICKOFF.md with the Fable model before continuing."** Do not continue to M3 with a subpar terminal.
4. The visual bar is §8 "calm precision" — Linear-esque, dark, quiet, exact. Before finishing, screenshot every screen and fix anything that drifts from the tokens and feel rules. No generic-AI-slop styling, no stock component-library look.
5. Maintain cliffnotes.md as you go (create it at M0). Note any forced deviation from SPEC.md at the top of it.
6. Work autonomously through all milestones without stopping to ask questions — SPEC.md already contains every decision.

When all milestones are done: give me the commands to run it (`bun run dev` for development, `bun run build && bun start` for production on port 12345), a short tour of what to try first, and then end your final message with exactly this line: **"Build complete — now run Prompt 2 from KICKOFF.md in a fresh session with the Fable model for the polish pass."**

---

## Prompt 2 — the polish pass (run with Fable, fresh session in `G:\code\agentcommunity`)

Run this AFTER Opus finishes the build (it will tell you), OR earlier if Opus stopped at M2 and asked for it.

Read SPEC.md and cliffnotes.md in this repo. Deck was built by another agent following SPEC.md; your job is a skeptical verification and polish pass — assume nothing works until you've seen it work. If cliffnotes.md contains a "Handoff: terminal issues" section, fixing the terminal to the §5.4 bar is your first and only priority before anything else.

Do these in order, fixing everything you find:

1. **Terminal feel (§5.4)** — start the app, open a shell terminal, and run the full acceptance test yourself: type at speed, run `claude` interactively inside it, resize the pane repeatedly while output streams, run a `bun dev` server, refresh the browser and confirm the screen restores perfectly. Fix any input latency, resize garbling, reattach loss, ANSI color drift from §8.4, or scrollback jank. This is the make-or-break feature; hold it to "indistinguishable from Windows Terminal."
2. **Milestone verification sweep (§13)** — re-run every milestone's ✅ verify steps against reality: live-tail an external Claude session's transcript into the feed, open a 1000+ event historical transcript and scroll, spawn a claude session from Deck and message it from the composer, stage individual hunks and confirm `git diff --cached` matches byte-exactly, trigger an attention notification with the tab backgrounded. Fix every failure at its root — no papering over.
3. **Transcript parser hardening (§7)** — run the parser across EVERY jsonl file in ~/.claude/projects (all projects, hundreds of sessions). Zero crashes allowed; unknown line/block types must degrade gracefully. Check the rendered feed for the ugliest real transcripts you can find (huge tool results, images, subagent chains).
4. **Design QA (§8)** — screenshot every screen and state (empty, loading, error, attention) and audit against the tokens and feel rules with fresh eyes: exact hex values, 4px grid, hairline borders only, focus rings everywhere, the single permitted pulse animation, no stock-component look, no layout shift in the feed. Fix drift; when SPEC.md's tokens and what looks right conflict, make it look right and note the token change in cliffnotes.md.
5. **Keyboard-only run (§10)** — complete a full session (spawn agent, send message, review diff, commit) without the mouse.

Work autonomously; don't ask questions. When done, update cliffnotes.md and give me: what you found and fixed (worst issues first), anything you deliberately left alone, and the final run commands.

# claude-code-mods

Four mods for [Claude Code](https://claude.com/claude-code):

- **prompt-enhancer** turns a rough prompt into a specific one, using what Claude already knows about your project, before you send it.
- **design-picker** shows design-direction questions as visual mockups you pick from, instead of a plain list.
- **assumption-tracker** has Claude write down each assumption it makes while it works, so you can mark them right or wrong and send corrections back.
- **idea-shelf** parks side-ideas mid-task without Claude seeing them, and sends any of them later as a prompt.

## Install

Type these at the prompt of a Claude Code session in a terminal:

```
/plugin install prompt-enhancer --marketplace aravindsriraj/claude-code-mods
/plugin install design-picker --marketplace aravindsriraj/claude-code-mods
/plugin install assumption-tracker --marketplace aravindsriraj/claude-code-mods
/plugin install idea-shelf --marketplace aravindsriraj/claude-code-mods
```

The first time, Claude Code asks whether to add the marketplace (`github:aravindsriraj/claude-code-mods`): answer `y`. Then choose a scope; the user scope is listed first, and Enter picks it. The mod starts working in that session right away, and with the user scope in every session after.

Mods built on Claude Code's hooks API need a recent Claude Code; the API is in early access and may change between releases.

## prompt-enhancer

A one-line bar above the prompt box with an **✨ Enhance** button.

1. Type a rough prompt as usual, e.g. `fix the export bug`.
2. Press **✨ Enhance**: click it (fullscreen terminal), or press `ctrl+x tab`, then `e`. The bar shows "Enhancing…", then your draft is replaced with a rewritten prompt.
3. Read it, edit it if you like, then press **Send** (`s`) or just Enter. **Undo** (`u`) puts your original draft back.

The rewrite sees what the main model sees: your CLAUDE.md and memory files, the installed skills, and the conversation so far, so "the bug" can become a real file and function. On the first prompt of a new session, before there is a conversation, it reads your instruction files and skill names directly.

Good to know:

- The rewrite uses your session's model, so it takes a few seconds.
- The **Send** button doesn't expand `@file` mentions or pasted images, and the transcript shows the message as sent by the mod. For those prompts, press Enter instead.
- The bar is always shown, even when the prompt box is empty.

## design-picker

When Claude asks you to choose a design direction with its `AskUserQuestion` tool (often while using the frontend-design skill), each option is drawn as a mockup above the usual list:

- **Desktop app:** an SVG card per option. If the option's `preview` is an SVG it is shown as is; otherwise the card shows the label, description, color swatches for any hex colors mentioned, and the preview text.
- **Terminal:** a Pick button per option with its color swatches, and the first lines of its preview under it.

Press **Pick** on a mockup, or answer in the list below it as usual; whichever you do first is the answer Claude gets.

Which questions it takes: single-pick questions whose header or text mentions design, direction, aesthetic, visual, theme, palette, colour, typography, layout, mockup, UI or UX, when every question in the call is one. Everything else, including a call that mixes design and other questions, is drawn exactly as before.

Good to know:

- Claude Code allows 12 rows around this dialog, counting every line, button and image label. That fits one question with up to 4 options on desktop, or two such questions on the terminal. A larger set of questions gets the normal dialog, unchanged.
- On the terminal, the preview lines share what is left of those rows: 1 line each with 4 options, 4 each with 2. The normal list still shows the full preview of the option you move to.
- Terminal Pick buttons have no hotkeys, so they don't clash with the dialog's number keys. Click them in a fullscreen terminal, or answer in the list.

## assumption-tracker

While Claude works, it records each assumption it acts on: a requirement nobody stated, a project convention, a fact about the code it hasn't checked. It does this by calling the mod's `record_assumption` tool, which the mod lists in Claude's tools and tells it about in the system prompt, then keeps working without stopping to ask.

1. Once there is at least one, a line above the prompt shows **Assumptions (3), 2 to review [Show]**.
2. Press **Show**: click it, or press `ctrl+x tab`, then `a`. That opens a side pane listing every assumption, with Claude's reason when it gave one.
3. For each, press **✓ Right** or **✗ Wrong**, or type what is actually true in its **Correction** field and press Enter (that marks it wrong).
4. Press **Send feedback** to send your verdicts to Claude now, as a message from the mod. Or just carry on: verdicts you haven't sent go along with your next prompt, unseen in the transcript. Each verdict is sent once; the pane shows which ones Claude has.

Good to know:

- How often Claude records depends on the model following the instruction; it is a prompt, not a guarantee.
- **Send feedback** starts a new turn once Claude is idle. If Claude is mid-task, sending your next prompt carries the verdicts too.
- A `/clear` starts the list over.
- In the mobile app there is no Correction field: Right and Wrong only.

## idea-shelf

Park a side-idea without derailing what Claude is doing, and send it later.

| Command | What it does |
| --- | --- |
| `/idea <text>` | Puts the idea on the shelf with a timestamp. Runs at once, even while Claude is working, and shows a 💡 toast. |
| `/ideas` | Opens the shelf in a side pane, numbered, with a **Send** button per idea. Press its number (or click Send) to run it. Esc closes. |
| `/idea-send <n>` | Sends idea n as a prompt and takes it off the shelf. |

A sent idea is submitted as your own prompt (the transcript labels it "Prompt from the idea-shelf plugin"). If Claude is busy it waits its turn. If the send is refused (by a hook, say), the idea goes back where it was on the shelf and a toast says why.

An idea that starts with `/` or `!` would run a command or a shell line, so it is never submitted for you: it goes into your prompt box instead, and runs only if you press Enter.

### What Claude can see

Your idea's text is kept out of the conversation. The mod passes your `/idea` command on with its text replaced by `[shelved for later; hidden from Claude]`, so Claude only learns that something was shelved, and `/ideas` draws the list in a pane outside the conversation. With Claude Code 2.1.308, the session file's records of the command (the queue entry and the command record) and your prompt history (up-arrow) get the placeholder too. Older versions can still write the text there.

Limits:

- The shelf is a plain file. Claude can't see it on its own, but its file tools can open `~/.claude/idea-shelf.md` if you ask, as with any file.
- A sent idea is an ordinary prompt from then on: it's in the conversation like anything you type.

### Where it lives

The shelf lives in `~/.claude/idea-shelf.md`, one idea per line (`- [2026-10-09 14:32] your idea`), shared by every project and session. The mod keeps it readable by you alone (`chmod 600`, as Claude Code does for `settings.json`; not on Windows). You can edit it by hand: control characters and escape sequences are stripped when an idea is shelved and when the file is read. If `HOME` isn't set, `/idea` refuses rather than writing somewhere else.

## Development

Each mod is a folder with `.claude-plugin/plugin.json`, `hooks/hooks.json` and the hooks module `hooks/register.tsx`; `.claude-plugin/marketplace.json` at the root lists them all.

```
claude plugin validate .
claude plugin validate ./prompt-enhancer
claude plugin test ./prompt-enhancer
claude plugin validate ./design-picker
claude plugin test ./design-picker
claude plugin validate ./assumption-tracker
claude plugin test ./assumption-tracker
claude plugin validate ./idea-shelf
claude plugin test ./idea-shelf
```

To try a change, start a session with the mod loaded from your working copy: `claude --plugin-dir ./prompt-enhancer`. Claude Code then writes the API's type declarations into `.claude-plugin/types/` and a `tsconfig.json` beside them, so `tsc -p ./prompt-enhancer` type-checks it; both are gitignored.

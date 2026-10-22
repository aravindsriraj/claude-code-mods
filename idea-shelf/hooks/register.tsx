import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Idea } from '../types'

const PANE = 'idea-shelf'
const HIDDEN = '[shelved for later; hidden from Claude]'
const NO_HOME = 'Not shelved: HOME is not set, so there is no ~/.claude to keep the shelf in.'

const ideas = atom({ plugin: 'idea-shelf', key: 'ideas' } as const, [] as Idea[])

/** The shelf file: plain markdown in ~/.claude, so it outlives sessions and can be edited by hand. Undefined without HOME. */
const shelfPath = async ($: EngineInterface) => {
  const home = await $.env.get('HOME')
  return home ? `${home}/.claude/idea-shelf.md` : undefined
}

/** Text safe to keep and draw: escape sequences dropped, control and bidi characters spaced out, whitespace collapsed. */
const clean = (s: string) =>
  s
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const LINE = /^- \[([^\]]+)\] (.*)$/

const parse = (file: string): Idea[] =>
  file.split('\n').flatMap(line => {
    const m = LINE.exec(line)
    const at = clean(m?.[1] ?? '')
    const text = clean(m?.[2] ?? '')
    return at && text ? [{ at, text }] : []
  })

const format = (list: readonly Idea[]) => `# Idea shelf\n\n${list.map(i => `- [${i.at}] ${i.text}\n`).join('')}`

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Reads the shelf file (empty when there is none yet) and mirrors it into state for the pane. */
async function load($: EngineInterface): Promise<Idea[]> {
  const path = await shelfPath($)
  const list = path && (await $.fs.exists(path)) ? parse(await $.fs.read(path)) : []
  await update($, ideas, () => list)
  return list
}

// ponytail: read-modify-write, so two sessions shelving in the same instant can lose one; fine for one person.
async function save($: EngineInterface, list: readonly Idea[]) {
  const path = await shelfPath($)
  if (!path) throw new Error(NO_HOME)
  await $.fs.write(path, format(list))
  // Ideas can be private: owner-only, as Claude Code keeps settings.json. No chmod (Windows) leaves it as written.
  await $.process.run(['chmod', '600', path]).catch(() => undefined)
  await update($, ideas, () => [...list])
}

const isSame = (a: Idea, b: Idea) => a.at === b.at && a.text === b.text

/** An idea that would run a command or shell line goes to the prompt box, for the person to send. */
const isCommand = (idea: Idea) => /^[/!]/.test(idea.text)

/**
 * Takes `idea` off the shelf and sends it as the person's own prompt, or for a `/` or `!` idea puts it in
 * the prompt box. A refused send puts it back where it was. Resolves to what to tell the person, if anything.
 */
async function sendIdea($: EngineInterface, idea: Idea): Promise<string | undefined> {
  const list = await load($)
  const at = list.findIndex(i => isSame(i, idea))
  if (at === -1) return 'That idea is no longer on the shelf.'
  await save($, list.filter((_, i) => i !== at))

  const putBack = async (why: string) => {
    const now = await load($)
    if (!now.some(i => isSame(i, idea))) await save($, [...now.slice(0, at), idea, ...now.slice(at)])
    return `Not sent (${why}); the idea is back on the shelf.`
  }

  try {
    if (isCommand(idea)) {
      const filled = await $.prompt.fill({ text: idea.text })
      if (!filled.isFilled) return putBack(filled.refusal ?? 'the prompt box is busy')
      return `It starts with "${idea.text[0]}", so it's in your prompt box: press Enter to run it.`
    }
    const sent = await $.prompt.submit({ text: idea.text, asUser: true })
    return sent.drop === undefined ? undefined : putBack(sent.drop)
  } catch (error) {
    return putBack(error instanceof Error ? error.message : 'the send failed')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'idea',
      description: "Park a side-idea on the shelf for later, kept out of Claude's conversation",
      argumentHint: '<text>',
      immediate: true,
    })
    await $.command.register({ name: 'ideas', description: 'Show the idea shelf, with a Send button per idea', immediate: true })
    await $.command.register({ name: 'idea-send', description: 'Send shelved idea n as a prompt and take it off the shelf', argumentHint: '<n>' })
    await load($)
    return next(e)
  })

  on('command.run', { command: 'idea' }, async ($, e, next) => {
    const text = clean(e.args)
    if (!text) return { text: 'Usage: /idea <text>' }
    if (!(await shelfPath($))) return { text: NO_HOME }

    const list = [...(await load($)), { at: stamp(await $.clock.now()), text }]
    await save($, list)
    $.ui.toast(`💡 Shelved #${list.length}: ${text}`)
    // Passed on masked, so the engine's records of this run (the transcript's command row) hold no idea text.
    await next({ ...e, args: HIDDEN })
    return { text: `Shelved as idea #${list.length}. Parked for later, not part of the current task.` }
  }).catch(($, e, next) =>
    // Failed before passing the masked args on: answer here, so the command never runs with the idea in it.
    next.called ? next(e) : { text: 'Not shelved: idea-shelf hit an error. Your idea was not saved.' },
  )

  on('command.run', { command: 'ideas' }, async $ => {
    await load($)
    await $.ui.open({ id: PANE, title: 'Idea shelf', focus: true, closeOnEscape: true })
    return {}
  })

  on('command.run', { command: 'idea-send' }, async ($, e) => {
    const n = Number(e.args.trim())
    const list = await load($)
    const idea = Number.isInteger(n) ? list[n - 1] : undefined
    if (idea === undefined) {
      return { text: list.length === 0 ? 'The idea shelf is empty.' : `Usage: /idea-send <n>, n from 1 to ${list.length}. /ideas lists them.` }
    }
    // A command's own hook may not submit (the prompt would wait on the turn it holds): send just after.
    $.clock.after(0, () => void sendIdea($, idea).then(note => note && $.ui.toast(note)))
    return { text: isCommand(idea) ? `Putting idea #${n} in the prompt box.` : `Sending idea #${n} as a prompt.` }
  })

  // Where the idea text would still reach the conversation or the transcript: the `/idea <text>` command row,
  // and the message queue's record of the line as typed. Both keep the command, not the idea.
  on('session.append', async ($, e, next) => {
    const mask = (text: string) =>
      e.door === 'queue'
        ? text.replace(/^\/idea\s[\s\S]*$/, `/idea ${HIDDEN}`)
        : text.replace(/(<command-name>\/idea<\/command-name>[\s\S]*?<command-args>)[\s\S]*?(<\/command-args>)/, `$1${HIDDEN}$2`)

    let isMasked = false
    const content = e.message.content.map(b => {
      if (b.type !== 'text' || typeof b.text !== 'string') return b
      const text = mask(b.text)
      if (text === b.text) return b
      isMasked = true
      return { ...b, text }
    })
    return next(isMasked ? { ...e, message: { ...e.message, content } } : e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, ideas)

    const sendOne = async (idea: Idea) => {
      await $.ui.close({ id: PANE }) // first: the prompt box takes no fill while the pane holds the keys
      const note = await sendIdea($, idea)
      if (note) $.ui.toast(note)
    }

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>{'The shelf is empty. Park an idea with /idea <text>.'}</Text>}
        {list.map((idea, i) => (
          <Box key={`idea:${i}`} flexDirection="row">
            <Button
              key={`send:${i}`}
              label="Send"
              {...(i < 9 ? { hotkey: String(i + 1) } : {})}
              onPress={() => sendOne(idea)}
            />
            <Text>
              {' '}
              <Text bold>{i + 1}.</Text> {idea.text} <Text dimColor>({idea.at})</Text>
            </Text>
          </Box>
        ))}
        {list.length > 0 && <Text dimColor>Press a number or click Send to run that idea as a prompt. Esc closes.</Text>}
      </Box>
    )
  })
}

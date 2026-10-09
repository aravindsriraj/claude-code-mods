import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Idea } from '../types'

const PANE = 'idea-shelf'
const HIDDEN = '[shelved for later; hidden from Claude]'

const ideas = atom({ plugin: 'idea-shelf', key: 'ideas' } as const, [] as Idea[])

/** The shelf file: plain markdown in ~/.claude, so it outlives sessions and can be edited by hand. */
const shelfPath = async ($: EngineInterface) => `${(await $.env.get('HOME')) ?? '.'}/.claude/idea-shelf.md`

const LINE = /^- \[([^\]]+)\] (.*)$/

const parse = (file: string): Idea[] =>
  file.split('\n').flatMap(line => {
    const m = LINE.exec(line)
    return m?.[1] && m[2] ? [{ at: m[1], text: m[2] }] : []
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
  const list = (await $.fs.exists(path)) ? parse(await $.fs.read(path)) : []
  await update($, ideas, () => list)
  return list
}

// ponytail: read-modify-write, so two sessions shelving in the same instant can lose one; fine for one person.
async function save($: EngineInterface, list: readonly Idea[]) {
  await $.fs.write(await shelfPath($), format(list))
  await update($, ideas, () => [...list])
}

/** Takes `idea` off the shelf; false when it is no longer there (sent already, or edited out of the file). */
async function take($: EngineInterface, idea: Idea): Promise<boolean> {
  const list = await load($)
  const at = list.findIndex(i => i.at === idea.at && i.text === idea.text)
  if (at === -1) return false
  await save($, list.filter((_, i) => i !== at))
  return true
}

/** The idea as the person's own prompt: a turn of its own once Claude is idle. */
const submit = ($: EngineInterface, idea: Idea) => $.prompt.submit({ text: idea.text, asUser: true })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'idea',
      description: 'Park a side-idea on the shelf for later; Claude never sees it',
      argumentHint: '<text>',
      immediate: true,
    })
    await $.command.register({ name: 'ideas', description: 'Show the idea shelf, with a Send button per idea', immediate: true })
    await $.command.register({ name: 'idea-send', description: 'Send shelved idea n as a prompt and take it off the shelf', argumentHint: '<n>' })
    await load($)
    return next(e)
  })

  on('command.run', { command: 'idea' }, async ($, e) => {
    const text = e.args.replace(/\s+/g, ' ').trim()
    if (!text) return { text: 'Usage: /idea <text>' }

    const list = [...(await load($)), { at: stamp(await $.clock.now()), text }]
    await save($, list)
    $.ui.toast(`💡 Shelved #${list.length}: ${text}`)
    return { text: `Shelved as idea #${list.length}. Parked for later, not part of the current task.` }
  })

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
    await take($, idea)
    // A command's own hook may not submit (the prompt would wait on the turn it holds): submit just after.
    $.clock.after(0, () => void submit($, idea))
    return { text: `Sent idea #${n} as a prompt.` }
  })

  // The `/idea <text>` record would show Claude the idea: keep its text out of the conversation.
  on('session.append', async ($, e, next) => {
    const content = e.message.content
    const isIdea = content.some(b => b.type === 'text' && typeof b.text === 'string' && b.text.includes('<command-name>/idea</command-name>'))
    if (!isIdea) return next(e)

    return next({
      ...e,
      message: {
        ...e.message,
        content: content.map(b =>
          b.type === 'text' && typeof b.text === 'string'
            ? { ...b, text: b.text.replace(/(<command-args>)[\s\S]*?(<\/command-args>)/, `$1${HIDDEN}$2`) }
            : b,
        ),
      },
    })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, ideas)

    const sendOne = async (idea: Idea) => {
      if (!(await take($, idea))) return $.ui.toast('That idea is no longer on the shelf.')
      await $.ui.close({ id: PANE })
      await submit($, idea)
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

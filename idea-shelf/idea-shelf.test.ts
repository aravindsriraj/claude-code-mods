import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SHELF = '/home/me/.claude/idea-shelf.md'
const OCT_9_14_32 = new Date(2026, 9, 9, 14, 32).getTime()
const run = (command: string, args = '') =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const

/** A shelf file in memory, a fixed clock and HOME, and what reaches the prompt and the toasts. */
function world(on: On) {
  const files = new Map<string, string>()
  const prompts: { text: string; asUser?: true }[] = []
  const toasts: string[] = []
  mock.env(on, { HOME: '/home/me' })
  const clock = mock.clock(on, { now: OCT_9_14_32 })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => {
    prompts.push({ text: e.text, ...(e.origin.kind === 'plugin' && e.origin.asUser ? { asUser: true } : {}) })
    return { text: e.text }
  })
  return { files, prompts, toasts, clock }
}

test('/idea shelves the idea with a timestamp and only confirms', async ($, on) => {
  const { files, prompts, toasts } = world(on)

  const first = await $.command.run(run('idea', 'write a haiku about tea'))
  await $.command.run(run('idea', '  list three primes   above 100 '))

  expect(files.get(SHELF)).toBe(
    '# Idea shelf\n\n- [2026-10-09 14:32] write a haiku about tea\n- [2026-10-09 14:32] list three primes above 100\n',
  )
  expect(first.text).toBe('Shelved as idea #1. Parked for later, not part of the current task.')
  expect(first.text).not.toContain('haiku') // what Claude reads names no idea
  expect(toasts[0]).toBe('💡 Shelved #1: write a haiku about tea')
  expect(prompts).toHaveLength(0)
})

test('the /idea record reaches the conversation without the idea text', async ($, on) => {
  world(on)
  const session = mock.session(on)
  const record = '<command-name>/idea</command-name>\n<command-message>idea</command-message>\n<command-args>write a haiku about tea</command-args>'

  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: record }] },
    door: 'command',
    origin: { kind: 'composer' },
    uuid: 'row-1',
  })

  const stored = JSON.stringify(session.appended().at(-1)?.message.content)
  expect(stored).not.toContain('haiku')
  expect(stored).toContain('<command-args>[shelved for later; hidden from Claude]</command-args>')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/ideas lists the shelf and Send runs one as a prompt (${surface})`, async ($, on) => {
    const { files, prompts } = world(on)
    await $.command.run(run('idea', 'write a haiku about tea'))
    await $.command.run(run('idea', 'list three primes above 100'))

    const listed = await $.command.run(run('ideas'))
    expect(listed.text).toBeUndefined() // the list is in the pane, never in the conversation

    const ui = await $.ui.mount({
      plugin: 'idea-shelf',
      surface,
      component: 'Pane',
      requestId: 'idea-shelf',
      props: { title: 'Idea shelf', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await ui.find({ text: /1\. write a haiku about tea/ })).toBeDefined()
    expect(await ui.find({ text: /2\. list three primes above 100/ })).toBeDefined()

    await ui.press({ key: 'send:1' })
    expect(prompts).toEqual([{ text: 'list three primes above 100', asUser: true }])
    expect(files.get(SHELF)).toBe('# Idea shelf\n\n- [2026-10-09 14:32] write a haiku about tea\n')
    expect(await ui.find({ text: /list three primes/ })).toBeUndefined()
  })
}

test('/idea-send n sends idea n and takes it off the shelf', async ($, on) => {
  const { files, prompts, clock } = world(on)
  await $.command.run(run('idea', 'write a haiku about tea'))
  await $.command.run(run('idea', 'list three primes above 100'))

  const sent = await $.command.run(run('idea-send', '1'))
  expect(sent.text).toBe('Sent idea #1 as a prompt.')
  await clock.advance(0) // the submit waits for the command to return
  expect(prompts).toEqual([{ text: 'write a haiku about tea', asUser: true }])
  expect(files.get(SHELF)).toBe('# Idea shelf\n\n- [2026-10-09 14:32] list three primes above 100\n')

  expect((await $.command.run(run('idea-send', '5'))).text).toBe('Usage: /idea-send <n>, n from 1 to 1. /ideas lists them.')
  expect(prompts).toHaveLength(1)
})

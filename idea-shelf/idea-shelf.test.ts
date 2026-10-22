import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SHELF = '/home/me/.claude/idea-shelf.md'
const HIDDEN = '[shelved for later; hidden from Claude]'
const OCT_9_14_32 = new Date(2026, 9, 9, 14, 32).getTime()
const run = (command: string, args = '') =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const
const pane = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'idea-shelf',
    surface,
    component: 'Pane',
    requestId: 'idea-shelf',
    props: { title: 'Idea shelf', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  }) as const

/**
 * The engine beneath the plugin: a shelf file in memory, a fixed clock, HOME (unless `home` is null), and a
 * record of what reached the prompt, the prompt box, the toasts, chmod and the `/idea` command's own run.
 */
function world(on: On, { home = '/home/me' as string | null, drop = undefined as string | undefined } = {}) {
  const files = new Map<string, string>()
  const prompts: { text: string; asUser?: true }[] = []
  const filled: string[] = []
  const toasts: string[] = []
  const chmods: (readonly string[])[] = []
  const ideaRuns: string[] = []
  mock.env(on, home === null ? {} : { HOME: home })
  const clock = mock.clock(on, { now: OCT_9_14_32 })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    chmods.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.run', { command: 'idea' }, ($, e) => {
    ideaRuns.push(e.args) // the args the engine records the run with
    return { text: '' }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', ($, e) => {
    prompts.push({ text: e.text, ...(e.origin.kind === 'plugin' && e.origin.asUser ? { asUser: true } : {}) })
    return drop === undefined ? { text: e.text } : { drop }
  })
  return { files, prompts, filled, toasts, chmods, ideaRuns, clock }
}

test('/idea shelves the idea with a timestamp, owner-only, and only confirms', async ($, on) => {
  const { files, prompts, toasts, chmods, ideaRuns } = world(on)

  const first = await $.command.run(run('idea', 'write a haiku about tea'))
  await $.command.run(run('idea', '  list three primes   above 100 '))

  expect(files.get(SHELF)).toBe(
    '# Idea shelf\n\n- [2026-10-09 14:32] write a haiku about tea\n- [2026-10-09 14:32] list three primes above 100\n',
  )
  expect(first.text).toBe('Shelved as idea #1. Parked for later, not part of the current task.')
  expect(toasts[0]).toBe('💡 Shelved #1: write a haiku about tea')
  expect(prompts).toHaveLength(0)
  expect(chmods.at(-1)).toEqual(['chmod', '600', SHELF])
  expect(ideaRuns).toEqual([HIDDEN, HIDDEN]) // the engine records the run without the idea
})

test('control characters are stripped when shelving and when reading the file back', async ($, on) => {
  const { files } = world(on)
  await $.command.run(run('idea', 'red \u001b[31malert\u001b[0m and\u0007 bell ‮evil'))
  expect(files.get(SHELF)).toBe('# Idea shelf\n\n- [2026-10-09 14:32] red alert and bell evil\n')

  files.set(SHELF, '# Idea shelf\n\n- [2026-10-09 14:32] planted \u001b[2Jwipe\u0000 text\n')
  await $.command.run(run('ideas'))
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ text: /1\. planted wipe text/ })).toBeDefined()
})

test('with HOME unset nothing is written anywhere', async ($, on) => {
  const { files, ideaRuns } = world(on, { home: null })
  const r = await $.command.run(run('idea', 'write a haiku about tea'))
  expect(r.text).toBe('Not shelved: HOME is not set, so there is no ~/.claude to keep the shelf in.')
  expect(files.size).toBe(0)
  expect(ideaRuns).toHaveLength(0) // answered without running the command, so no record of the text
})

test('the transcript keeps the command, not the idea: command row and queue record', async ($, on) => {
  world(on)
  const session = mock.session(on)
  const append = (door: 'command' | 'queue', text: string, uuid: string) =>
    $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'text', text }] }, door, origin: { kind: 'composer' }, uuid })

  await append('command', '<command-name>/idea</command-name>\n<command-message>idea</command-message>\n<command-args>write a haiku about tea</command-args>', 'row-1')
  await append('queue', '/idea write a haiku about tea', 'row-2')
  await append('queue', '/ideas', 'row-3')

  const stored = session.appended().map(r => JSON.stringify(r.message.content))
  expect(stored.join('\n')).not.toContain('haiku')
  expect(stored[0]).toContain(`<command-args>${HIDDEN}</command-args>`)
  expect(stored[1]).toContain(`/idea ${HIDDEN}`)
  expect(stored[2]).toContain('"/ideas"') // other commands untouched
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/ideas lists the shelf and Send runs one as a prompt (${surface})`, async ($, on) => {
    const { files, prompts } = world(on)
    await $.command.run(run('idea', 'write a haiku about tea'))
    await $.command.run(run('idea', 'list three primes above 100'))

    const listed = await $.command.run(run('ideas'))
    expect(listed.text).toBeUndefined() // the list is in the pane, never in the conversation

    const ui = await $.ui.mount(pane(surface))
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
  expect(sent.text).toBe('Sending idea #1 as a prompt.')
  await clock.advance(0) // the send waits for the command to return
  expect(prompts).toEqual([{ text: 'write a haiku about tea', asUser: true }])
  expect(files.get(SHELF)).toBe('# Idea shelf\n\n- [2026-10-09 14:32] list three primes above 100\n')

  expect((await $.command.run(run('idea-send', '5'))).text).toBe('Usage: /idea-send <n>, n from 1 to 1. /ideas lists them.')
  expect(prompts).toHaveLength(1)
})

test('an idea starting with / or ! goes to the prompt box for the person to send', async ($, on) => {
  const { files, prompts, filled, toasts, clock } = world(on)
  files.set(SHELF, '# Idea shelf\n\n- [2026-10-09 14:32] /clear\n- [2026-10-09 14:32] !rm -rf ~\n')

  expect((await $.command.run(run('idea-send', '1'))).text).toBe('Putting idea #1 in the prompt box.')
  await clock.advance(0)
  const ui = await $.ui.mount(pane('terminal'))
  await ui.press({ key: 'send:0' })

  expect(prompts).toHaveLength(0) // nothing submitted on the shelf's say-so
  expect(filled).toEqual(['/clear', '!rm -rf ~'])
  expect(toasts.at(-1)).toBe(`It starts with "!", so it's in your prompt box: press Enter to run it.`)
})

test('a refused send puts the idea back where it was', async ($, on) => {
  const { files, prompts, toasts, clock } = world(on, { drop: 'blocked by a hook' })
  files.set(SHELF, '# Idea shelf\n\n- [2026-10-09 14:00] first\n- [2026-10-09 14:01] second\n- [2026-10-09 14:02] third\n')

  await $.command.run(run('idea-send', '2'))
  await clock.advance(0)

  expect(prompts).toEqual([{ text: 'second', asUser: true }])
  expect(files.get(SHELF)).toBe('# Idea shelf\n\n- [2026-10-09 14:00] first\n- [2026-10-09 14:01] second\n- [2026-10-09 14:02] third\n')
  expect(toasts.at(-1)).toBe('Not sent (blocked by a hook); the idea is back on the shelf.')
})

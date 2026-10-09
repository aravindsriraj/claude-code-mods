import { expect, test } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`enhance replaces the draft, send submits it (${surface})`, async ($, on) => {
    let box = 'fix the bug'
    let forked = ''
    let submitted: { text: string; asUser?: boolean } | undefined

    on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
    on('prompt.fill', ($, e) => {
      box = e.text
      return { isFilled: true }
    })
    on('model.fork', ($, e) => {
      forked = e.prompt
      return { value: { isAnswered: true, text: '  Fix the null crash in src/app.ts and add a test.\n', usage } }
    })
    on('prompt.submit', ($, e) => {
      submitted = { text: e.text, asUser: e.origin?.kind === 'plugin' ? e.origin.asUser : undefined }
      return { text: e.text }
    })

    const ui = await $.ui.mount({
      plugin: 'prompt-enhancer',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 3,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 1 },
        view: {},
      },
    })

    await ui.press({ key: 'enhance' })
    expect(forked).toContain('<draft>\nfix the bug\n</draft>')
    expect(box).toBe('Fix the null crash in src/app.ts and add a test.')
    expect(await ui.find({ key: 'enhance' })).toBeUndefined()

    await ui.press({ key: 'undo' })
    expect(box).toBe('fix the bug')

    await ui.press({ key: 'enhance' })
    await ui.press({ key: 'send' })
    expect(submitted).toEqual({ text: 'Fix the null crash in src/app.ts and add a test.', asUser: true })
    expect(box).toBe('')
    expect(await ui.find({ key: 'enhance' })).toBeDefined()
  })
}

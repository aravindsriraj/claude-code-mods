import { expect, test } from 'claude-code/testing'

const design = {
  question: 'Which visual direction should the landing page take?',
  header: 'Direction',
  multiSelect: false,
  options: [
    { label: 'Editorial', description: 'Serif headlines, #1a1a1a on #f5f0e8', preview: '+----------+\n|  HERO    |\n|  ~~~~    |\n+----------+' },
    { label: 'Brutalist', description: 'Raw grid, #000000 and #ff3b00' },
  ],
}

const plain = {
  question: 'Which test runner should we use?',
  header: 'Tests',
  multiSelect: false,
  options: [
    { label: 'Vitest', description: 'Fast, Vite-native' },
    { label: 'Jest', description: 'Familiar' },
  ],
}

// What core answers beneath a ui.render on the dialog: its own drawing, one engine node.
const ENGINE = { type: 'engine', ref: 0 } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a design question is drawn as mockups and a pick answers it (${surface})`, async ($, on) => {
    let opened = () => {}
    const isOpen = new Promise<void>(resolve => (opened = resolve))
    let isDialogAborted = false

    // The engine: its dialog stays open until the call beneath is abandoned.
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) => {
      opened()
      return new Promise(resolve =>
        next.signal.addEventListener('abort', () => {
          isDialogAborted = true
          resolve({ deny: 'dialog closed' })
        }),
      )
    })

    on('ui.render', { component: 'AskUserQuestion' }, () => ENGINE)

    const call = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'tu-design', questions: [design] })
    await isOpen

    const ui = await $.ui.mount({
      plugin: 'design-picker',
      surface,
      component: 'AskUserQuestion',
      requestId: 'tu-design',
      props: { tool: 'AskUserQuestion', questions: [design] },
    })

    if (surface === 'terminal') expect(await ui.find({ type: 'Code' })).toBeDefined()
    else expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
    expect(JSON.stringify(await ui.drawn())).toContain('"type":"engine"') // the real dialog stays below

    await ui.press({ key: 'pick:0:1' })

    const r = await call
    expect(r.result).toEqual({ questions: [design], answers: { [design.question]: 'Brutalist' } })
    expect(isDialogAborted).toBe(true)
  })

  test(`a question that is not about design is left unchanged (${surface})`, async ($, on) => {
    const engineAnswer = { questions: [plain], answers: { [plain.question]: 'Vitest' } }
    let release = () => {}
    const isReleased = new Promise<void>(resolve => (release = resolve))
    let opened = () => {}
    const isOpen = new Promise<void>(resolve => (opened = resolve))
    let seen: unknown

    on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => {
      seen = e.questions
      opened()
      await isReleased
      return { result: engineAnswer }
    })

    on('ui.render', { component: 'AskUserQuestion' }, () => ENGINE)

    const call = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'tu-plain', questions: [plain] })
    await isOpen

    const ui = await $.ui.mount({
      plugin: 'design-picker',
      surface,
      component: 'AskUserQuestion',
      requestId: 'tu-plain',
      props: { tool: 'AskUserQuestion', questions: [plain] },
    })
    expect(await ui.drawn()).toEqual(ENGINE) // the engine's own dialog, not wrapped
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.find({ type: surface === 'terminal' ? 'Code' : 'Svg' })).toBeUndefined()

    release()
    const r = await call
    expect(seen).toEqual([plain])
    expect(r.result).toEqual(engineAnswer)
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the gallery fits the rows around the dialog, else the dialog is left as is (${surface})`, async ($, on) => {
    const tall = Array.from({ length: 20 }, (_, i) => `| row ${i} |`).join('\n')
    const q = (n: number) => ({
      question: `Which colour palette for section ${n}?`,
      header: `Palette ${n}`,
      multiSelect: false,
      options: ['A', 'B', 'C', 'D'].map(label => ({ label, description: '#112233 and #ddeeff', preview: tall })),
    })
    let opened = () => {}
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) => {
      opened()
      return new Promise(resolve => next.signal.addEventListener('abort', () => resolve({ deny: 'closed' })))
    })
    on('ui.render', { component: 'AskUserQuestion' }, () => ENGINE)

    const mount = async (id: string, questions: ReturnType<typeof q>[]) => {
      const isOpen = new Promise<void>(resolve => (opened = resolve))
      void $.tool.call({ tool: 'AskUserQuestion', tool_use_id: id, questions }).catch(() => undefined)
      await isOpen
      return $.ui.mount({ plugin: 'design-picker', surface, component: 'AskUserQuestion', requestId: id, props: { tool: 'AskUserQuestion', questions } })
    }

    const one = await mount('tu-one', [q(1)])
    expect(await one.findAll({ type: 'Button' })).toHaveLength(4)

    const four = await mount('tu-four', [q(1), q(2), q(3), q(4)])
    expect(await four.drawn()).toEqual(ENGINE)
  })
}

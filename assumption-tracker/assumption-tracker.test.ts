import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__assumption-tracker__record_assumption'

const band = {
  plugin: 'assumption-tracker',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 1 }, view: {} },
} as const

const pane = {
  plugin: 'assumption-tracker',
  component: 'Pane',
  requestId: 'assumptions',
  props: { title: 'Assumptions', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a recorded assumption shows up in the pane (${surface})`, async $ => {
    const r = await $.tool.call({
      tool: TOOL,
      tool_use_id: 'tu-1',
      assumption: 'Dates are stored in UTC',
      basis: 'the schema uses timestamptz',
    })
    expect(r.result).toContain('#1')

    const ui = await $.ui.mount({ ...pane, surface })
    expect(await ui.find({ text: /Dates are stored in UTC/ })).toBeDefined()
    expect(await ui.find({ text: /because the schema uses timestamptz/ })).toBeDefined()
    expect(await ui.find({ key: 'right:1' })).toBeDefined()
  })

  test(`the band entry opens the pane on click (${surface})`, async ($, on) => {
    let opened: { id: string; focus?: true } | undefined
    on('ui.open', ($, e) => {
      opened = e
      return { value: { isPlaced: true } }
    })

    await $.tool.call({ tool: TOOL, tool_use_id: 'tu-1', assumption: 'Use pnpm, not npm' })
    await $.tool.call({ tool: TOOL, tool_use_id: 'tu-2', assumption: 'Target Node 22' })

    const ui = await $.ui.mount({ ...band, surface })
    expect(await ui.find({ text: /Assumptions \(2\), 2 to review/ })).toBeDefined()

    await ui.press({ key: 'show' })
    expect(opened).toMatchObject({ id: 'assumptions', focus: true })
  })

  test(`confirming and correcting send the verdicts to Claude (${surface})`, async ($, on) => {
    const prompts: { text: string; context?: readonly string[] }[] = []
    on('prompt.submit', ($, e) => {
      prompts.push({ text: e.text, context: e.context })
      return { text: e.text }
    })

    await $.tool.call({ tool: TOOL, tool_use_id: 'tu-1', assumption: 'Use pnpm, not npm' })
    await $.tool.call({ tool: TOOL, tool_use_id: 'tu-2', assumption: 'Dates are stored in UTC' })
    await $.tool.call({ tool: TOOL, tool_use_id: 'tu-3', assumption: 'The API is public' })

    const ui = await $.ui.mount({ ...pane, surface })
    await ui.press({ key: 'right:1' })
    await ui.input({ key: 'fix:2', text: 'Dates are local time' })
    expect(await ui.find({ text: /✗ wrong: Dates are local time/ })).toBeDefined()

    // Send now: one prompt to Claude carrying both verdicts.
    await ui.press({ key: 'send' })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.text).toContain('#1 "Use pnpm, not npm": right')
    expect(prompts[0]?.text).toContain('#2 "Dates are stored in UTC": wrong. Correction: Dates are local time')
    expect(prompts[0]?.context).toBeUndefined()
    expect(await ui.find({ key: 'send' })).toBeUndefined()

    // A verdict not sent yet rides along with the person's next prompt.
    await ui.press({ key: 'wrong:3' })
    await $.prompt.submit({ text: 'carry on', wait: false, origin: { kind: 'composer' } })
    expect(prompts[1]?.text).toBe('carry on')
    expect(prompts[1]?.context?.join('\n')).toContain('#3 "The API is public": wrong (no correction given)')
    expect(prompts[1]?.context?.join('\n')).not.toContain('#1')
  })
}

test('the system prompt tells Claude to record assumptions with the tool', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))

  const { sections } = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [TOOL],
    outputStyle: { name: 'default', isKeepingCodingInstructions: true },
    traits: [],
  })
  expect(sections.map(s => s.id)).toEqual(['intro', 'assumption-tracker:assumptions'])
  expect(sections[1]).toMatchObject({ scope: 'session' })
  expect(sections[1]?.text).toContain(TOOL)
})

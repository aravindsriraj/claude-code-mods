import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { Phase } from '../types'

const phase = atom({ plugin: 'prompt-enhancer', key: 'phase' } as const, 'idle' as Phase)
const original = atom({ plugin: 'prompt-enhancer', key: 'original' } as const, '')

const ask = (draft: string) => `Rewrite the draft prompt below into a clear, specific prompt for you (Claude Code) to act on in this project.
Ground it in what you know: this conversation, the project's instructions (CLAUDE.md, rules, memory) and the skills and tools available.
- Keep the person's intent; do not invent requirements or widen the scope.
- Resolve vague references ("it", "the bug", "that page") to concrete files, functions or features when the context makes them clear.
- Name the skill, command or project convention that applies when one clearly does.
- Say what done looks like (how to verify) when it is not obvious.
- Be concise: a few sentences or a short list, never an essay.
Reply with the rewritten prompt only: no preamble, no quotes, no code fence.

<draft>
${draft}
</draft>`

// The fork sees exactly what the main model sees: system prompt, CLAUDE.md, skill listing, conversation.
async function rewrite($: EngineInterface, draft: string): Promise<ModelForkResult> {
  const forked = await $.model.fork({ prompt: ask(draft) })
  if (forked.isAnswered || forked.reason !== 'nothing-to-fork') return forked

  // Fresh session, nothing to fork yet: hand over the instruction files and skill names ourselves.
  const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
  const files = await Promise.all(
    (breakdown?.memoryFiles ?? []).map(
      async f => `<file path="${f.path}">\n${await $.fs.read(f.path).catch(() => '')}\n</file>`,
    ),
  )
  const skills = (breakdown?.skills?.skillFrontmatter ?? []).map(s => s.name).join(', ')

  return $.model.complete({
    model: await $.session.model(),
    system: `Project instructions:\n${files.join('\n')}\n\nInstalled skills: ${skills || 'none'}`,
    prompt: ask(draft),
  })
}

export const register: Register = on => {
  // Sent by Enter instead of the band's Send: back to idle.
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, phase)) === 'ready') await update($, phase, () => 'idle')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await read($, phase)

    const enhance = async () => {
      const { text } = await $.prompt.read()
      if (!text.trim()) return $.ui.toast('Type a prompt first, then Enhance.')

      await update($, phase, () => 'working')
      const r = await rewrite($, text)
      if (!r.isAnswered) {
        await update($, phase, () => 'idle')
        return $.ui.toast(`Enhance failed: ${r.reason}`)
      }
      await update($, original, () => text)
      await $.prompt.fill({ text: r.text.trim() })
      await update($, phase, () => 'ready')
    }

    const send = async () => {
      const { text } = await $.prompt.read()
      if (!text.trim()) return
      await $.prompt.fill({ text: '' })
      await update($, phase, () => 'idle')
      await $.prompt.submit({ text, asUser: true })
    }

    const undo = async () => {
      await $.prompt.fill({ text: await read($, original) })
      await update($, phase, () => 'idle')
    }

    if (now === 'working') {
      return (
        <Box>
          <Text dimColor>✨ Enhancing with project context…</Text>
        </Box>
      )
    }

    if (now === 'ready') {
      return (
        <Box>
          <Text dimColor>✨ Enhanced, review it below </Text>
          <Button key="send" label="Send" hotkey="s" variant="primary" onPress={send} />
          <Text> </Text>
          <Button key="undo" label="Undo" hotkey="u" onPress={undo} />
        </Box>
      )
    }

    return (
      <Box>
        <Button key="enhance" label="✨ Enhance" hotkey="e" onPress={enhance} />
        <Text dimColor> rewrite the draft with project context</Text>
      </Box>
    )
  })
}

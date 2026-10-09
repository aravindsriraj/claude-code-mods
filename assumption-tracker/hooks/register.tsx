import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Assumption } from '../types'

const PANE = 'assumptions'
const TOOL = 'mcp__assumption-tracker__record_assumption'

const assumptions = atom({ plugin: 'assumption-tracker', key: 'assumptions' } as const, [] as Assumption[])

const SECTION = {
  id: 'assumption-tracker:assumptions',
  scope: 'session',
  text: `# Assumptions
Whenever you act on an assumption, something about what the person wants, a project convention, or a fact about the code or environment that you were not told and have not checked, call \`${TOOL}\` with it in one sentence. Then keep working; do not stop to ask. The person reviews these in a side pane, and their verdicts come back to you: follow every correction, and stop relying on any assumption marked wrong.`,
} as const

const verdictLine = (a: Assumption) =>
  a.verdict === 'right'
    ? `- #${a.id} "${a.text}": right, keep it.`
    : a.correction
      ? `- #${a.id} "${a.text}": wrong. Correction: ${a.correction}`
      : `- #${a.id} "${a.text}": wrong (no correction given), so stop relying on it.`

/** The verdicts that have not reached Claude yet, as one message, and their ids. */
function feedback(list: readonly Assumption[]): { text: string; ids: number[] } | undefined {
  const unsent = list.filter(a => a.verdict !== undefined && !a.isSent)
  if (unsent.length === 0) return undefined
  return {
    text: `The person reviewed assumptions you recorded:\n${unsent.map(verdictLine).join('\n')}\nAdjust your work to match.`,
    ids: unsent.map(a => a.id),
  }
}

const markSent = ($: EngineInterface, ids: number[]) =>
  update($, assumptions, list => list.map(a => (ids.includes(a.id) ? { ...a, isSent: true } : a)))

const judge = ($: EngineInterface, id: number, verdict: 'right' | 'wrong', correction?: string) =>
  update($, assumptions, list =>
    list.map(a => {
      if (a.id !== id) return a
      const { correction: _, ...rest } = a
      return { ...rest, verdict, isSent: false, ...(verdict === 'wrong' && correction ? { correction } : {}) }
    }),
  )

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'record_assumption',
      description:
        'Record an assumption you are acting on (one you were not told and have not verified) so the person can confirm or correct it. Call it each time, then carry on without waiting.',
      inputSchema: {
        type: 'object',
        properties: {
          assumption: { type: 'string', description: 'The assumption in one sentence, e.g. "Dates are stored in UTC".' },
          basis: { type: 'string', description: 'Optional: why you assumed it, in a few words.' },
        },
        required: ['assumption'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { ...composed, sections: [...composed.sections, SECTION] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const text = typeof e.assumption === 'string' ? e.assumption.trim() : ''
    if (!text) return { deny: 'Pass `assumption`: the assumption in one sentence.' }
    const basis = typeof e.basis === 'string' ? e.basis.trim() : ''

    const list = await update($, assumptions, l => [
      ...l,
      { id: (l[l.length - 1]?.id ?? 0) + 1, text, isSent: false, ...(basis ? { basis } : {}) },
    ])
    return { result: `Recorded as assumption #${list[list.length - 1]?.id}. Keep going; the person will confirm or correct it.` }
  })

  // Verdicts not sent yet ride along with the next prompt, unseen by the person.
  on('prompt.submit', async ($, e, next) => {
    const pending = feedback(await read($, assumptions))
    if (pending === undefined) return next(e)

    const submitted = await next({ ...e, context: [...(e.context ?? []), pending.text] })
    if (submitted.drop === undefined) await markSent($, pending.ids)
    return submitted
  })

  // A /clear starts a new conversation: its assumptions start over too.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, assumptions, () => [])
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, assumptions)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const toReview = list.filter(a => a.verdict === undefined).length

    return (
      <Box>
        <Text dimColor>
          Assumptions ({list.length}){toReview > 0 ? `, ${toReview} to review` : ''}{' '}
        </Text>
        <Button
          key="show"
          label="Show"
          hotkey="a"
          onPress={() => $.ui.open({ id: PANE, title: 'Assumptions', focus: true, closeOnEscape: true })}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, assumptions)
    const { Box, Button, Text } = $.ui.resolve(e)
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const pending = feedback(list)

    const send = async () => {
      const now = feedback(await read($, assumptions))
      if (now === undefined) return
      await markSent($, now.ids) // first, so the prompt.submit hook doesn't attach them again
      await $.prompt.submit({ text: now.text })
    }

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No assumptions recorded yet.</Text>}
        {list.map(a => (
          <Box key={`a:${a.id}`} flexDirection="column" marginBottom={1}>
            <Text>
              <Text bold>#{a.id}</Text> {a.text}
            </Text>
            {a.basis ? <Text dimColor>because {a.basis}</Text> : null}
            {a.verdict === undefined ? null : (
              <Text color={a.verdict === 'right' ? 'success' : 'error'}>
                {a.verdict === 'right' ? '✓ right' : `✗ wrong${a.correction ? `: ${a.correction}` : ''}`}
                <Text dimColor>{a.isSent ? ' (sent to Claude)' : ' (not sent yet)'}</Text>
              </Text>
            )}
            <Box>
              <Button
                key={`right:${a.id}`}
                label="✓ Right"
                variant={a.verdict === 'right' ? 'primary' : 'secondary'}
                onPress={() => judge($, a.id, 'right')}
              />
              <Text> </Text>
              <Button
                key={`wrong:${a.id}`}
                label="✗ Wrong"
                variant={a.verdict === 'wrong' ? 'primary' : 'secondary'}
                onPress={() => judge($, a.id, 'wrong', a.correction)}
              />
            </Box>
            {Input === undefined ? null : (
              <Input
                key={`fix:${a.id}`}
                label="Correction: "
                placeholder="what is actually true"
                submitLabel="mark wrong"
                value={a.correction ?? ''}
                onSubmit={value => judge($, a.id, 'wrong', value.trim())}
              />
            )}
          </Box>
        ))}
        {pending === undefined ? null : (
          <Box>
            <Button key="send" label={`Send feedback (${pending.ids.length})`} variant="primary" onPress={send} />
            <Text dimColor> or it goes with your next prompt</Text>
          </Box>
        )}
      </Box>
    )
  })
}

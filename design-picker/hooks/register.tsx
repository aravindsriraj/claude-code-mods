import { atom, read, update } from 'claude-code'
import type { BuiltinToolInputs, Register } from 'claude-code'

import type { Picks } from '../types'

type Question = BuiltinToolInputs['AskUserQuestion']['questions'][number]
type Option = Question['options'][number]

const picks = atom({ plugin: 'design-picker', key: 'picks' } as const, {} as Picks)

// One resolver per open design question call, by tool_use_id: the gallery's Pick settles the call.
// ponytail: module memory, so a hot reload mid-question falls back to the engine's own dialog.
const pending = new Map<string, (answers: Record<string, string>) => void>()

// ponytail: keyword heuristic on header + question; widen the list if real design questions slip past.
const DESIGN =
  /\b(design|direction|aesthetic|visual|look and feel|look & feel|vibe|mood|theme|palette|colou?rs?|typography|fonts?|layout|mockups?|ui|ux)\b/i

const isDesign = (q: Question) =>
  !q.multiSelect && q.options.length >= 2 && DESIGN.test(`${q.header} ${q.question}`)

/** A call the gallery takes: every question is a single-pick design question. */
const isDesignCall = (questions: readonly Question[]) => questions.length > 0 && questions.every(isDesign)

// The engine lets a tree draw 12 rows around its AskUserQuestion dialog, counted by adding up every line
// of text, every preview line, and each Button label and Svg alt (a row, plus one per 40 columns).
const DIALOG_ROWS = 12
const rowsOf = (text: string) => 1 + Math.floor(text.length / 40)
const pickText = (o: Option) => `✓ ${o.label}${' ██'.repeat(swatches(o).length)}`
const altText = (o: Option) => `${o.label} mockup`

/** Rows the gallery needs before any preview line: the hint, then per question its header and its options. */
const fixedRows = (questions: readonly Question[], isTerminal: boolean) =>
  1 +
  questions.reduce(
    (n, q) => n + 1 + q.options.reduce((m, o) => m + rowsOf(pickText(o)) + (isTerminal ? 0 : rowsOf(altText(o))), 0),
    0,
  )

const hexes = (o: Option) => [
  ...new Set(`${o.description} ${o.preview ?? ''}`.match(/#[0-9a-f]{6}\b/gi) ?? []),
].slice(0, 8)

const swatches = (o: Option) => hexes(o).slice(0, 4)

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const wrap = (s: string, n: number) =>
  s.split(/\s+/).reduce<string[]>((lines, word) => {
    const last = lines[lines.length - 1]
    if (last !== undefined && `${last} ${word}`.length <= n) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
    return lines
  }, [])

/** One option as an SVG card: its own SVG preview when it has one, else title, palette and preview text. */
function card(o: Option, isPicked: boolean): string {
  if (o.preview?.trimStart().startsWith('<svg')) return o.preview

  const W = 360
  const desc = wrap(o.description, 52).slice(0, 4)
  const colors = hexes(o)
  const body = (o.preview ?? '').split('\n').slice(0, 18)
  let y = 30
  const parts = [`<text x="16" y="${y}" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="#1f1f1f">${esc(o.label)}</text>`]
  for (const line of desc) {
    y += 17
    parts.push(`<text x="16" y="${y}" font-family="system-ui,sans-serif" font-size="12" fill="#5f5f5f">${esc(line)}</text>`)
  }
  if (colors.length > 0) {
    y += 12
    colors.forEach((c, i) =>
      parts.push(`<rect x="${16 + i * 40}" y="${y}" width="34" height="24" rx="4" fill="${c}" stroke="#0002"/>`),
    )
    y += 24
  }
  if (body.some(l => l.trim())) {
    y += 12
    parts.push(`<rect x="12" y="${y}" width="${W - 24}" height="${body.length * 14 + 12}" rx="6" fill="#f4f4f2"/>`)
    body.forEach((line, i) =>
      parts.push(`<text x="20" y="${y + 18 + i * 14}" font-family="ui-monospace,monospace" font-size="11" fill="#2b2b2b" xml:space="preserve">${esc(line)}</text>`),
    )
    y += body.length * 14 + 12
  }
  const H = y + 16
  const stroke = isPicked ? 'stroke="#d97757" stroke-width="3"' : 'stroke="#d6d6d2" stroke-width="1"'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10" fill="#ffffff" ${stroke}/>${parts.join('')}</svg>`
}

export const register: Register = on => {
  // Holds a design question open and answers it with the gallery's picks; the engine's dialog stays live beneath.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const id = e.tool_use_id
    if (!id || !isDesignCall(e.questions)) return next(e)

    const picked = new Promise<Record<string, string>>(resolve => pending.set(id, resolve))
    const answered = next(e)
    answered.catch(() => undefined) // aborted beneath once the gallery wins

    try {
      const winner = await Promise.race([answered, picked.then(answers => ({ answers }))])
      if (!('answers' in winner)) return winner
      return { result: { questions: e.questions, answers: winner.answers } }
    } finally {
      pending.delete(id)
      await update($, picks, ({ [id]: _, ...rest }) => rest)
    }
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = e.props.questions as Question[]
    if (!pending.has(e.requestId) || !isDesignCall(questions)) return next(e)

    const id = e.requestId
    const engine = await next(e)
    const isTerminal = e.surface === 'terminal'
    const fixed = fixedRows(questions, isTerminal)
    if (fixed > DIALOG_ROWS) return engine // too many options to draw around the dialog: its own list alone
    const chosen = (await read($, picks))[id] ?? {}

    const pick = async (question: string, label: string) => {
      const all = await update($, picks, p => ({ ...p, [id]: { ...p[id], [question]: label } }))
      const mine = all[id] ?? {}
      if (questions.every(q => mine[q.question] !== undefined)) pending.get(id)?.(mine)
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    // Drawn as pickText says, so the row budget counts what is drawn.
    const pickButton = (qi: number, oi: number, q: Question, o: Option) => (
      <Button
        key={`pick:${qi}:${oi}`}
        label={o.label}
        variant={chosen[q.question] === o.label ? 'primary' : 'secondary'}
        onPress={() => pick(q.question, o.label)}
      >
        {chosen[q.question] === o.label ? '✓ ' : ''}
        {o.label}
        {swatches(o).map(c => (
          <Text color={c}> ██</Text>
        ))}
      </Button>
    )
    const hint = <Text dimColor>Pick a mockup, or answer in the list below.</Text>

    if (e.surface === 'terminal') {
      const { Code } = $.ui.resolve(e)
      const withPreview = questions.flatMap(q => q.options).filter(o => o.preview?.trim()).length
      const previewRows = withPreview === 0 ? 0 : Math.floor((DIALOG_ROWS - fixed) / withPreview)
      return (
        <Box flexDirection="column">
          {questions.map((q, qi) => (
            <Box key={`q:${qi}`} flexDirection="column">
              <Text bold wrap="truncate-end">
                {q.header}: {q.question}
              </Text>
              <Box flexDirection="row">
                {q.options.map((o, oi) => {
                  const lines = (o.preview ?? '').split('\n').filter(l => !l.startsWith('```')).slice(0, previewRows)
                  return (
                    <Box key={`card:${qi}:${oi}`} flexDirection="column" marginRight={2}>
                      {pickButton(qi, oi, q, o)}
                      {lines.length > 0 ? <Code source={lines.join('\n')} language="text" wrap="truncate-end" /> : null}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ))}
          {hint}
          {engine}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {questions.map((q, qi) => (
          <Box key={`q:${qi}`} flexDirection="column">
            <Text bold wrap="truncate-end">
              {q.header}: {q.question}
            </Text>
            <Box flexDirection="row" flexWrap="wrap">
              {q.options.map((o, oi) => (
                <Box key={`card:${qi}:${oi}`} flexDirection="column">
                  <Svg source={card(o, chosen[q.question] === o.label)} alt={altText(o)} />
                  {pickButton(qi, oi, q, o)}
                </Box>
              ))}
            </Box>
          </Box>
        ))}
        {hint}
        {engine}
      </Box>
    )
  })
}

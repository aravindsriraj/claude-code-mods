/** One assumption Claude recorded, and the person's verdict on it once given. */
export type Assumption = {
  id: number
  text: string
  /** Why Claude assumed it, when it said. */
  basis?: string
  verdict?: 'right' | 'wrong'
  /** What is actually true, when the person typed it. */
  correction?: string
  /** Whether the verdict has reached Claude. */
  isSent: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'assumption-tracker': { assumptions: Assumption[] }
  }
}

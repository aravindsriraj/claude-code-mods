/** Picks made in the gallery so far: tool_use_id -> question text -> option label. */
export type Picks = Record<string, Record<string, string>>

declare module 'claude-code' {
  interface PluginState {
    'design-picker': { picks: Picks }
  }
}

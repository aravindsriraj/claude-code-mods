/** One shelved idea: when it was parked (local time, `YYYY-MM-DD HH:MM`) and its text. */
export type Idea = { at: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    /** The shelf as last read from its file, for the pane to draw. */
    'idea-shelf': { ideas: Idea[] }
  }
}

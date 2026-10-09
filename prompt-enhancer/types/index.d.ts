export type Phase = 'idle' | 'working' | 'ready'

declare module 'claude-code' {
  interface PluginState {
    'prompt-enhancer': { phase: Phase; original: string }
  }
}

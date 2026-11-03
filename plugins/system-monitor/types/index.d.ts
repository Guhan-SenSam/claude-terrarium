export type Gpu = {
  name: string
  percent: number
  memUsedBytes: number
  memTotalBytes: number
  tempC: number
}

export type Usage = {
  /** Epoch ms of the sample. */
  at: number
  /** Null on the first sample, before there is a delta to measure. */
  cpu: { percent: number; threads: number; load1: number } | null
  memory: {
    usedBytes: number
    totalBytes: number
    swapUsedBytes: number
    swapTotalBytes: number
  }
  /** `asleep` while the GPU is runtime-suspended; empty with no NVIDIA GPU. */
  gpus: Gpu[] | 'asleep'
}

declare module 'claude-code' {
  interface PluginState {
    'system-monitor': { usage: Shaped<Usage | null> }
  }
}

import type { Gpu, Usage } from '../types'

/** Every /proc file a sample needs, in one child, sections split by `@@`. */
export const PROC_SCRIPT =
  'exec 2>/dev/null; cat /proc/stat; echo @@; cat /proc/meminfo; echo @@; cat /proc/loadavg; true'

/** The PCI folders of NVIDIA display controllers, one per line. */
export const FIND_NVIDIA =
  'for d in /sys/bus/pci/devices/*; do [ "$(cat "$d/vendor")" = 0x10de ] && case "$(cat "$d/class")" in 0x03*) echo "$d";; esac; done 2>/dev/null; true'

export const GPU_ARGV = [
  'nvidia-smi',
  '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
  '--format=csv,noheader,nounits',
] as const

export type ProcSample = {
  /** Jiffies summed over every CPU, and the idle share of them. */
  cpuTotal: number
  cpuIdle: number
  threads: number
  load1: number
  memory: Usage['memory']
}

export function parseProc(text: string): ProcSample {
  const [stat = '', meminfo = '', loadavg = ''] = text.split('\n@@\n')

  let cpuTotal = 0
  let cpuIdle = 0
  let threads = 0
  for (const line of stat.split('\n')) {
    if (line.startsWith('cpu ')) {
      // user nice system idle iowait irq softirq steal; guest is already in user.
      const f = line.trim().split(/\s+/).slice(1, 9).map(Number)
      cpuTotal = f.reduce((sum, n) => sum + n, 0)
      cpuIdle = (f[3] ?? 0) + (f[4] ?? 0)
    } else if (/^cpu\d+ /.test(line)) {
      threads++
    }
  }

  const kib = new Map<string, number>()
  for (const line of meminfo.split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(line)
    if (m) kib.set(m[1]!, Number(m[2]))
  }
  const bytes = (key: string) => (kib.get(key) ?? 0) * 1024

  return {
    cpuTotal,
    cpuIdle,
    threads,
    load1: Number(loadavg.split(' ')[0]) || 0,
    memory: {
      usedBytes: bytes('MemTotal') - bytes('MemAvailable'),
      totalBytes: bytes('MemTotal'),
      swapUsedBytes: bytes('SwapTotal') - bytes('SwapFree'),
      swapTotalBytes: bytes('SwapTotal'),
    },
  }
}

export function cpuPercent(prev: ProcSample, next: ProcSample): number {
  const total = next.cpuTotal - prev.cpuTotal
  if (total <= 0) return 0

  return (1 - (next.cpuIdle - prev.cpuIdle) / total) * 100
}

/** `name, util, mem used MiB, mem total MiB, temp` per line; `[N/A]` reads as 0. */
export function parseGpus(text: string): Gpu[] {
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split(',').map(part => part.trim())
      const [percent, used, total, temp] = parts.slice(-4).map(n => Number(n) || 0)

      return {
        name: parts.slice(0, -4).join(',').replace(/^NVIDIA (GeForce )?/, ''),
        percent: percent ?? 0,
        memUsedBytes: (used ?? 0) * 1024 ** 2,
        memTotalBytes: (total ?? 0) * 1024 ** 2,
        tempC: temp ?? 0,
      }
    })
}

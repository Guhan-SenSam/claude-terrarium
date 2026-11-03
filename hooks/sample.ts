import type { App, Disk, Gpu, Usage } from '../types'

const GIB = 1024 ** 3

/** Every /proc file a sample needs, in one child, sections split by `@@`. */
export const PROC_SCRIPT =
  'exec 2>/dev/null; cat /proc/stat; echo @@; cat /proc/meminfo; echo @@; cat /proc/loadavg; echo @@; cat /proc/[0-9]*/stat; true'

/** The PCI folders of NVIDIA display controllers, one per line. */
export const FIND_NVIDIA =
  'for d in /sys/bus/pci/devices/*; do [ "$(cat "$d/vendor")" = 0x10de ] && case "$(cat "$d/class")" in 0x03*) echo "$d";; esac; done 2>/dev/null; true'

export const GPU_ARGV = [
  'nvidia-smi',
  '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
  '--format=csv,noheader,nounits',
] as const

export const DF_ARGV = [
  'df',
  '-B1',
  '--output=source,target,size,used',
  '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'efivarfs', '-x', 'squashfs', '-x', 'overlay',
] as const

export type Proc = { pid: number; name: string; ticks: number; rssPages: number }

export type ProcSample = {
  /** Jiffies summed over every CPU, and the idle share of them. */
  cpuTotal: number
  cpuIdle: number
  threads: number
  load1: number
  memory: Usage['memory']
  procs: Proc[]
}

export function parseProc(text: string): ProcSample {
  const [stat = '', meminfo = '', loadavg = '', procs = ''] = text.split('\n@@\n')

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
  const memory = {
    usedBytes: bytes('MemTotal') - bytes('MemAvailable'),
    totalBytes: bytes('MemTotal'),
    swapUsedBytes: bytes('SwapTotal') - bytes('SwapFree'),
    swapTotalBytes: bytes('SwapTotal'),
  }

  return {
    cpuTotal,
    cpuIdle,
    threads,
    load1: Number(loadavg.split(' ')[0]) || 0,
    memory,
    procs: procs.split('\n').flatMap(parseProcStat),
  }
}

/** One `/proc/<pid>/stat` line; the name sits in parentheses and may hold spaces. */
function parseProcStat(line: string): Proc[] {
  const open = line.indexOf('(')
  const close = line.lastIndexOf(')')
  if (open < 0 || close < open) return []
  // Fields from the state (field 3) on: utime is 14, stime 15, rss 24.
  const rest = line.slice(close + 2).split(' ')
  const ticks = Number(rest[11]) + Number(rest[12])
  const rssPages = Number(rest[21])
  if (!Number.isFinite(ticks) || !Number.isFinite(rssPages)) return []

  return [{ pid: parseInt(line, 10), name: line.slice(open + 1, close), ticks, rssPages }]
}

export function cpuPercent(prev: ProcSample, next: ProcSample): number {
  const total = next.cpuTotal - prev.cpuTotal
  if (total <= 0) return 0

  return (1 - (next.cpuIdle - prev.cpuIdle) / total) * 100
}

/**
 * Processes grouped by name, CPU as a share of the whole machine since `prev`.
 * Kernel threads (no resident memory) are left out.
 */
export function apps(prev: ProcSample | undefined, next: ProcSample, pageSize: number): App[] {
  const before = new Map(prev?.procs.map(p => [p.pid, p.ticks]))
  const total = prev ? next.cpuTotal - prev.cpuTotal : 0
  const byName = new Map<string, App>()
  for (const proc of next.procs) {
    if (proc.rssPages === 0) continue
    // A pid not seen last time started since, so all of its time is new.
    const used = Math.max(0, proc.ticks - (before.get(proc.pid) ?? 0))
    const app = byName.get(proc.name) ?? { name: proc.name, count: 0, cpuPercent: 0, rssBytes: 0 }
    app.count++
    app.cpuPercent += total > 0 ? (used / total) * 100 : 0
    app.rssBytes += proc.rssPages * pageSize
    byName.set(proc.name, app)
  }

  return [...byName.values()]
}

export function topBy(list: App[], field: 'cpuPercent' | 'rssBytes', count: number): App[] {
  return list
    .filter(app => app[field] > 0)
    .sort((a, b) => b[field] - a[field])
    .slice(0, count)
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

/** One row per device (btrfs subvolumes share one), skipping boot and tiny ones. */
export function parseDisks(text: string): Disk[] {
  const seen = new Set<string>()
  const disks: Disk[] = []
  for (const line of text.split('\n').slice(1)) {
    const [source, mount, size, used] = line.trim().split(/\s+/)
    if (!source || !mount || seen.has(source)) continue
    if (mount.startsWith('/boot') || Number(size) < GIB) continue
    seen.add(source)
    disks.push({ mount, usedBytes: Number(used), totalBytes: Number(size) })
  }

  return disks
}

export function pushHistory(list: number[] | undefined, value: number, keep: number): number[] {
  return [...(list ?? []), value].slice(-keep)
}

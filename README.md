# System Monitor for Claude Code

A Claude Code mod that keeps an eye on the machine while you work: live CPU, RAM, GPU and disk
usage, plus the apps using the most CPU and memory. It's built for running heavy jobs (big builds,
local models, emulators) and checking on them from the desktop app or your phone while Claude works.

## What it shows

**A band above the prompt**, always up in the desktop app and the terminal:

```
CPU ████░░░░░░  42%  RAM ██████░░░░  63%  GPU █░░░░░░░░░  12%
/ 39%  /mnt/Dev 35% · RAM chrome×20 3.1G, java 1.9G · CPU chrome×20 2.5%
```

**A detail pane**, opened with `/sysmon`:

- CPU, RAM and GPU bars with a sparkline of the last few minutes
- load average, used/total memory and swap, VRAM and GPU temperature
- every real disk with its free space (btrfs subvolumes and `/boot` are folded away)
- the top 5 apps by CPU and by memory, with processes grouped by name (`chrome ×20`)
- in the desktop and phone apps, a soft animated background that turns from teal to amber to red and
  speeds up as the machine gets busier

Bars turn amber at 70% and red at 90%. Numbers refresh every 2 seconds, and disks every 30.

## Install

At the prompt of a terminal session:

```
/plugin install system-monitor --marketplace Guhan-SenSam/claude-system-monitor
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install system-monitor --marketplace Guhan-SenSam/claude-system-monitor
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `Guhan-SenSam/claude-system-monitor`, then **Add plugin**.

## Use

- The band appears on its own once a session starts. Its `[-]` collapses it, and it steps aside
  when Claude shows a survey there.
- `/sysmon` opens the detail pane, and closes it when it's open.
- The phone app doesn't draw the band yet, so open the pane with `/sysmon` to watch from your phone.
- Claude Code decides where the pane goes (beside the conversation, or above the prompt in a
  narrow terminal); a mod can't pin it to one side.

## Requirements

- Linux: it reads `/proc` and runs `df`.
- An NVIDIA GPU is optional and read through `nvidia-smi`. A GPU that has runtime-suspended (hybrid
  graphics laptops) is left asleep rather than woken every two seconds.

Everything stays on your machine. The mod runs `sh`, `cat`, `df`, `getconf` and `nvidia-smi`
locally and sends nothing anywhere.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

`hooks/sample.ts` holds the parsers, `hooks/register.tsx` the band, the pane and the sampling
timer, and `tests/` runs both against fixed sample output on the terminal, desktop and mobile
surfaces.

## License

MIT

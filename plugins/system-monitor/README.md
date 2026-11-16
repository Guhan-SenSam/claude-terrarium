# System Monitor for Claude Code

A Claude Code mod that keeps an eye on the machine while you work: short live bars for CPU, RAM
and GPU. It's built for running heavy jobs (big builds, local models, emulators) and checking on
them from the desktop app or your phone while Claude works.

## What it shows

**One row above the prompt**, always up in the desktop app and the terminal:

```
CPU ████░░░░  42%   RAM █████░░░  63%   GPU █░░░░░░░  12%
```

That is how the terminal draws it. In the desktop app the band is pixel art to match
[thinking-weather](../thinking-weather): a little chip, memory stick and graphics card for icons,
each followed by a game-style bar of chunky segments in a dark frame and its reading. The bars use
the weather scene's colours (meadow green, wheat gold from 70%, lantern orange from 90%), and the
lit segments carry a stepped pixel glow, brighter the higher the reading. The band follows the time of day
like the weather scene: warmer at dawn and dusk, dimmer at night with a lantern-amber glow. A
sleeping GPU shows its card dimmed with a little "z". On a narrow prompt the bars shrink, then drop out, and the icons and
percentages stay.

**A detail pane**, opened with `/terrarium-monitor`: the same three bars at full width, each with a detail
line (threads and load average, used memory and swap, VRAM and GPU temperature). In the desktop and
phone apps it has a soft animated background that turns from teal to amber to red and speeds up as
the machine gets busier.

Bars turn amber at 70% and red at 90%, and refresh every 2 seconds.

## Install

At the prompt of a terminal session:

```
/plugin install system-monitor --marketplace Guhan-SenSam/claude-terrarium
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install system-monitor --marketplace Guhan-SenSam/claude-terrarium
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `Guhan-SenSam/claude-terrarium`, then **Add plugin**.

## Use

- The band appears on its own once a session starts. Its `[-]` collapses it, and it steps aside
  when Claude shows a survey there.
- `/terrarium-monitor` opens the detail pane, and closes it when it's open.
- The phone app doesn't draw the band yet, so open the pane with `/terrarium-monitor` to watch from your phone.
- Claude Code decides where the pane goes (beside the conversation, or above the prompt in a
  narrow terminal); a mod can't pin it to one side.

## Requirements

- Linux: it reads `/proc`.
- An NVIDIA GPU is optional and read through `nvidia-smi`. A GPU that has runtime-suspended (hybrid
  graphics laptops) is left asleep rather than woken every two seconds.

Everything stays on your machine. The mod runs `sh`, `cat` and `nvidia-smi` locally and sends
nothing anywhere.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

`hooks/sample.ts` holds the parsers, `hooks/pixel.ts` the desktop band's pixel art,
`hooks/register.tsx` the band, the pane and the sampling timer, and `tests/` runs both against fixed sample output on the terminal, desktop and mobile
surfaces.

## License

MIT

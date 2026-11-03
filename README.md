# claude-mods

The Claude Code mods I use on my own setup. Each one lives in `plugins/<name>/` with its own
README and tests, and this repository is a marketplace that lists them all, so any one of them
installs on its own.

| Mod | What it does |
|---|---|
| [system-monitor](plugins/system-monitor) | Short live CPU, RAM and GPU bars above the prompt, each glowing brighter as it rises; `/sysmon` opens a detail pane |
| [turn-receipt](plugins/turn-receipt) | A one-line receipt under each finished reply: time taken, tool calls, agents, files edited, tokens |
| [pins](plugins/pins) | Pin replies into a Pinned pane; hover a reply and press Pin, or `/pin` from the phone |

## Install

At the prompt of a terminal session, for any mod in the table:

```
/plugin install <mod> --marketplace Guhan-SenSam/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install <mod> --marketplace Guhan-SenSam/claude-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `Guhan-SenSam/claude-mods`, then **Add plugin** and pick the
mod.

## Develop

Each mod is checked on its own:

```bash
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

## License

MIT

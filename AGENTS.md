# AGENTS.md

Guidance for AI coding agents working on this repository. People installing the mods want
[README.md](README.md) or the [docs site](https://guhan-sensam.github.io/claude-mods/).

## What this is

A Claude Code plugin marketplace of mods: hooks modules in TypeScript that run inside the Claude
Code engine. `.claude-plugin/marketplace.json` lists every mod; each lives in `plugins/<name>/`:

```
plugins/<name>/
  .claude-plugin/plugin.json   name, version, description, userConfig, types
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           export const register: Register = (on, options) => { ... }
  types/index.d.ts             the mod's $.state contract
  tests/*.test.ts(x)           run by `claude plugin test`
  README.md
```

`docs/` is the GitHub Pages site (plain HTML, `llms.txt` and `llms-full.txt` for agents).

## Checks before any commit

```bash
claude plugin validate plugins/<name>
claude plugin test plugins/<name>
```

Type-check with a tsconfig that includes the engine's `claude-code.d.ts` (the plugin-authoring
skill writes it) and the mod's `hooks` and `types`. Bump the mod's `version` in `plugin.json` for
every release; installed copies update with `claude plugin update <name>@claude-mods`.

## thinking-weather

- `hooks/art.ts` is generated. Never edit it by hand: change `tools/gen_art.py` and run
  `python3 tools/gen_art.py . /tmp/preview` from the mod's folder (numpy, pillow). The generator is
  seeded; check that unrelated layers come out byte-for-byte unchanged.
- The desktop app strips embedded images from a backdrop SVG. All art is vector: one
  stroke-width-1 path per colour run, darkest colour first, each colour reaching one cell under
  lighter neighbours, at most 64 runs per path.
- A scene must stay under 131,072 characters. `scene()` drops the oldest bolts to fit; the tests
  check the worst case in every era.
- Every animation step redraws the whole backdrop. Keep loops on the shared half-second clock
  (`loop(now, ms)`), time them from `now` at draw time, and never animate something always on
  screen faster than that.
- Do not name a variable `h` in a `.tsx` module: it shadows the JSX factory and the render hook is
  skipped.
- `turn.start` and `turn.complete` fire for subagents too (`e.agentId`). A mod tool's arguments sit
  beside `tool` on the `tool.call` input, not under `input`.
- In auto mode every Bash call's `tool.check` answers `ask`, and the desktop leaves the mode labels
  empty, so a permission ask cannot be told from the classifier: only `AskUserQuestion` and
  `ExitPlanMode` count as waiting on the person.
- The working-row replacement (`Spinner`) only reaches the bottom row; the live tool-step row's
  orb is the desktop's own.
- `$.audio.play` is silent when the engine runs on Linux behind the desktop app.

## system-monitor

The band is drawn in `hooks/pixel.ts` (Svg surfaces) and as text bars on the terminal. Tests pin
the clock to local noon so colours do not shift with the time of day.

## Commits and releases

One mod per commit where possible, message `<mod> <version>: <what changed>`. Push to `main` only
when asked.

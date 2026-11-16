# thinking-weather

A pixel-art valley behind the conversation in the desktop and mobile apps, whose weather follows
what Claude is doing.

- **Idle:** a clear sky over fields, a farm with a windmill, a pond and a small town.
- **Claude working:** storm clouds glide in from the corners and the top, the sky darkens, and
  once they are in, rain falls from under them.
- **Every tool call:** a lightning strike from the clouds. A busy turn is a proper storm; strikes
  close together go out in one redraw.
- **Waiting on you** (a question, or a plan to approve): the rain stops and the lantern by the
  road blinks.
- **Turn done:** the clouds roll back out and sunbeams break through for a while.

The sky follows your local clock: dawn, day, dusk and night blend into each other, the sun and
moon cross the sky, stars come out, and after dark the town's windows, streetlamps and lantern
glow. By day birds cross the sky; at night fireflies blink in the meadow; chimneys smoke, the
windmill turns and the pond glints all the time.

| Command | |
|---|---|
| `/weather-cycle [seconds]` | Play a whole day in under a minute (default 48 s) |
| `/weather-time HH:MM` | Show the sky at a time of day; `/weather-time auto` follows the clock again |
| `/weather-test` | Fire a burst of test lightning |
| `/weather-off` | Clear the background for this session |

Claude can also play the day itself with the `weather_cycle` tool.

The terminal and editors draw no backgrounds, so there the mod does nothing.

## How it is drawn

The desktop app strips embedded images from a background, so every layer is vector: a 320x180
grid of pixel cells written as one-cell-wide stroke runs, one path per colour, with each colour
reaching one cell under its lighter neighbours so no hairlines show at fractional window sizes
(the method of [BackdropKit](https://github.com/winchxyz/backdropkit), MIT). The sky is a single
gradient. Each scene is held under the app's 131,072-character limit, dropping the oldest bolts
in a burst if it must.

Every loop steps on one shared half-second clock and is timed from the clock at draw time, so the
scene redraws at most twice a second and carries on where it was after a resize or a state change.

`hooks/art.ts` is generated: `python3 tools/gen_art.py . /tmp/weather-preview` (numpy and pillow)
redraws it and writes preview PNGs.

## Permission prompts

The desktop app does not tell a mod which permission mode is on, so a permission check is not
counted as waiting on you unless the terminal footer names a mode that asks. In auto mode,
nothing ever waits on a permission prompt; in a mode that asks, the lantern shows for questions
and plan approvals only.

## Install

```
/plugin install thinking-weather --marketplace Guhan-SenSam/claude-mods
```

In the desktop app: **+** next to the prompt box, then **Plugins**, **Add marketplace** with
`Guhan-SenSam/claude-mods`, then **Add plugin**.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

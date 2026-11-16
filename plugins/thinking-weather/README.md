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

While Claude works, the desktop's working row shows a little pixel storm cloud in place of the
orb, doing what the turn does: billowing while it thinks, dots lighting in turn while a request
goes out, lightning while a tool runs, rain while the reply is written. Beside it, what the step
is doing and how long the turn has run.

The sky follows your local clock: dawn, day, dusk and night blend into each other, the sun and
moon cross the sky, stars come out, and after dark the town's windows, streetlamps and lantern
glow. By day birds cross the sky; at night fireflies blink in the meadow; chimneys smoke, the
windmill turns and the pond glints all the time.

## Society advances with the context

The valley is a timeline. A fresh conversation is a Stone Age settlement: round thatched huts in a
palisade, a campfire, standing stones and a mammoth grazing. As the conversation's context fills,
society moves up an era for each fifth of the window, and near a full context the valley is a
sci-fi city of spires and skybridges under a ringed planet, with a space elevator, hovercraft, an
aurora at night, and an ion storm in place of Claude's rain clouds. Compacting the conversation
rolls fog in, and behind it society falls back to the Stone Age: the fog lifts on the basics.

| Context | Era |
|---|---|
| 0-20% | Stone Age |
| 20-40% | Village |
| 40-60% | Industrial (drawn as the village for now) |
| 60-80% | Modern (drawn as the village for now) |
| 80-100% | Sci-fi |

`/weather-era <era>` previews one; `/weather-era` says where society stands.

## The session in the weather

- **A slash command you run** strikes lightning too, even between turns.
- **A failed tool call** strikes red.
- **Subagents** each fly a kite over the town while they work; it comes down when they finish.
- **A git commit or push** sets off a firework over the church.
- **Compacting the conversation** rolls fog through the valley until it is done.
- **A long turn** grows the storm: heavier rain after two minutes, a darker sky after five.

`/weather-demo` shows them all in about 20 seconds.

## Sun, moon and holidays

With a town set, dawn and dusk land on its real sunrise and sunset each day. The moon shows its
real phase, worked out locally. The town decorates itself: pumpkins on the doorsteps through late
October, string lights on the eaves and a tree by the path in December, fireworks after dark on New
Year's Eve and the Fourth of July (with bunting by day). `/weather-holiday <name>` previews one.

## Seasons and real weather

The valley follows the seasons: blossom in spring, golden wheat in summer, orange trees and fallen
leaves in autumn, a muted winter. Set your town and the idle sky follows the real weather there:
clear, a few clouds, overcast, rain, snow, fog or a thunderstorm. Snow lies on the ground and roofs
only when there really is snow; with no town set, winter is snowy, storybook style. While Claude
works, its own storm still rolls in over whatever the weather is.

The weather comes from [Open-Meteo](https://open-meteo.com) (free, no key) every 30 minutes. The
town's name is sent once to look it up; after that only its coordinates, rounded to about 10 km.
With no town set, nothing is sent anywhere. Set it with `/weather-place Tampa` (or `Town, Region`
to choose between towns of the same name), or in the plugin's settings; `/weather-place off`
turns it off.

| Command | |
|---|---|
| `/weather-place <town>` | Follow the real weather in a town; `off` stops |
| `/weather-sky <sky>` | Preview a sky: `clear`, `partly`, `overcast`, `rain`, `snow`, `fog`, `thunder`; `auto` follows the weather |
| `/weather-season <season>` | Preview `spring`, `summer`, `autumn`, `winter` or `snow`; `auto` follows the calendar |
| `/weather-now` | Say what the background shows and why |
| `/weather-tour` | A 40-second slideshow of the seasons and skies |
| `/weather-holiday <name>` | Preview `halloween`, `christmas`, `newyear` or `july4`; `none` or `auto` |
| `/weather-demo` | Show the session events: kites, a firework, a red strike, fog |
| `/weather-era <era>` | Preview `stone`, `village`, `industrial`, `modern` or `scifi`; `auto` follows the context |
| `/weather-cycle [seconds]` | Play a whole day in under a minute (default 48 s) |
| `/weather-time HH:MM` | Show the sky at a time of day; `/weather-time auto` follows the clock again |
| `/weather-test` | Fire a burst of test lightning |
| `/weather-off` | Clear the background for this session |

Claude can also play the day itself with the `weather_cycle` tool, preview skies and seasons with
`weather_preview`, and set the town with `weather_place`.

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
/plugin install thinking-weather --marketplace Guhan-SenSam/claude-terrarium
```

In the desktop app: **+** next to the prompt box, then **Plugins**, **Add marketplace** with
`Guhan-SenSam/claude-terrarium`, then **Add plugin**.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

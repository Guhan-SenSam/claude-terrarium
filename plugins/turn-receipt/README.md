# turn-receipt

A one-line receipt under each of Claude's finished replies, so you can tell at a glance which
turns did real work when you come back to a long session:

```
4m 12s · 23 tool calls · 2 agents · edited register.tsx, sample.ts +4 · 3.2k tokens out
```

- **Time:** how long the turn took. A turn you stopped reads `interrupted after 1m 3s`, and one an
  error ended reads `stopped on an error after …`.
- **Tool calls:** every tool call in the turn, its subagents' included, plus how many agents it
  started.
- **Files edited:** the first two files Claude edited or wrote, then a count of the rest.
- **Tokens out:** what the model wrote in the turn.

Receipts show in the desktop app, the terminal and the phone app. They're kept for the last 30
sessions, so they come back when you reopen one.

## Install

```
/plugin install turn-receipt --marketplace Guhan-SenSam/claude-terrarium
```

In the desktop app: **+** next to the prompt box, then **Plugins**, **Add marketplace** with
`Guhan-SenSam/claude-terrarium`, then **Add plugin**.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

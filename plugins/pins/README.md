# pins

Keep the replies that matter. In a long session the useful plan, command or answer has usually
scrolled away an hour ago; pin it and it stays in a **Pinned** pane for the rest of the session.

- **Desktop app:** hover any reply and press **Pin** at its bottom-right. A pinned reply keeps an
  **Unpin** button, and the Pinned pane opens with it.
- **Phone and terminal:** type `/pin` to pin Claude's last reply. The Pinned pane shows on the phone
  too.
- `/pins` shows or hides the pane. Each pinned reply is drawn in full, newest first, with the time
  it was pinned and its own **Unpin**.

Pins are kept for the last 30 sessions, so they come back when you reopen one.

## Install

```
/plugin install pins --marketplace Guhan-SenSam/claude-mods
```

In the desktop app: **+** next to the prompt box, then **Plugins**, **Add marketplace** with
`Guhan-SenSam/claude-mods`, then **Add plugin**.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

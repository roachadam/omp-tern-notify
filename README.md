# omp-desktop-notify

macOS desktop notifications for [omp](https://github.com/can1357/oh-my-pi). You get one when the agent needs you: a tool call waits for approval, a question waits for an answer, a plan waits for review, or a turn finishes or fails. Notifications are sent only while you're away from the terminal, and they get out of the way once you're back.

Built for [Tern](https://stencil.so/tern), where notifications show up under Tern's name and icon, and clicking one jumps to the exact omp pane. It also works in iTerm, Terminal, Ghostty, WezTerm, Warp, kitty and VS Code.

## What it does

| Event | Notification |
|---|---|
| A tool call needs approval | `Approval needed: bash` |
| The `ask` tool waits for an answer | `Waiting for input: <question>` |
| A plan is ready for review | `Plan ready for review: <title>` |
| A turn finishes (10 s or longer by default) | `Complete` |
| A run stops with an error | `Stopped with error` |

Each notification shows the terminal's name as its title, with the session name below it.

- **Away only.** If the terminal is the frontmost app, nothing is posted. If an approval, question or plan review is still unanswered when you switch away, it's posted then.
- **Grace delay.** Each event waits 3 seconds first. If you answer or come back in that time, nothing is sent.
- **Cleans up after itself.** A notification is removed once you answer in omp, start a new prompt, quit omp or switch back to the terminal. If an approval or question is still unanswered and you leave again, it's posted again.
- **Click to return.** Clicking brings the terminal forward. In Tern it also focuses the pane that sent the notification.
- **No duplicates in Tern.** Tern already shows its own banners and inbox entries for omp's status (OSC 7501). Under Tern, omp's built-in notifications (OSC 99) would repeat them, so the plugin switches those off for the session. Other terminals keep them, because there they're the only signal inside the terminal.

## Requirements

- macOS 13 or later
- omp 18.12 or later
- A network connection on first use, to fetch [alerter](#how-notifications-are-posted)

## Install

```sh
omp plugin install github:roachadam/omp-desktop-notify
```

New omp sessions load it automatically; restart any open ones. The first notification makes macOS ask whether your terminal may send notifications. Allow it, or turn it on later in **System Settings › Notifications › <your terminal>**.

If you previously copied a `desktop-notify.ts` into `~/.omp/agent/extensions/`, delete it. Otherwise both copies run and every notification is sent twice.

## Settings

Run `/notifications` in omp. Selecting a row moves it to its next value. Values are saved to `~/.omp/agent/config.yml`, so you can also edit them there:

```yaml
desktopNotify:
  enabled: true          # master switch
  when: away             # away | always
  approval: true
  question: true
  plan: true
  complete: true
  error: true
  delay: 3               # seconds to wait before notifying
  minTurnSeconds: 10     # skip "Complete" for shorter turns
  replaceBuiltin: true   # Tern only: turn off omp's duplicate OSC 99 notifications
```

Setting `PI_NOTIFICATIONS=off` in the environment turns all notifications off, the same as omp's built-in ones.

## How notifications are posted

macOS only shows notifications from properly signed apps, and it won't let a command-line process post under another app's name by itself. This plugin uses [alerter](https://github.com/vjeantet/alerter) (MIT), a small notifier that its author signs with an Apple Developer ID.

- On first use the plugin downloads alerter **v26.5** from its GitHub release, checks the zip against a pinned SHA-256, and stores the binary in `~/Library/Caches/omp-desktop-notify/`.
- Notifications are posted with `--sender <terminal bundle id>`, so they carry the terminal's name, icon and notification permission.
- To find out which app is in front, the plugin runs `lsappinfo` while a notification is pending or showing.
- Clicking a notification runs `open -b <terminal>`, and under Tern also `tern focus <pane>`.

Nothing else touches the network, and no data leaves your machine.

## Limitations

- Posting under the terminal's name with `--sender` relies on an old macOS feature that Apple no longer documents. It works on macOS 13 through 27, but a future release could remove it.
- If the terminal can't be identified (see the list above), notifications are always sent, under Terminal's name, and they aren't removed when you come back.
- The plugin does nothing over SSH, because the notification would appear on the remote Mac.
- The plugin doesn't see omp's other dialogs, such as those opened by other extensions.

## Uninstall

```sh
omp plugin uninstall omp-desktop-notify
rm -rf ~/Library/Caches/omp-desktop-notify
```

Then remove the `desktopNotify:` block from `~/.omp/agent/config.yml` if you changed any settings.

## Development

```sh
git clone https://github.com/roachadam/omp-desktop-notify
cd omp-desktop-notify
bun install            # type definitions only; nothing is bundled
bun run typecheck
omp plugin link .      # load this checkout into omp
```

`src/index.ts` handles omp's events and decides when to notify. `src/macos.ts` detects the terminal and posts through alerter. `src/settings.ts` defines the settings and the `/notifications` menu. omp writes the plugin's debug messages (`desktop-notify: …`) to `~/.omp/logs/`.

## License

MIT

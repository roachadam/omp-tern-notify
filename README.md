# omp-desktop-notify

macOS desktop notifications for [omp](https://github.com/can1357/oh-my-pi), with optional push to your phone. You get one when the agent needs you: a tool call waits for approval, a question waits for an answer, a plan waits for review, or a turn finishes or fails. Notifications are sent only while you're away from the terminal, and they get out of the way once you're back. Leave the Mac entirely and they can follow you to your phone.

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
- **Phone, when you've left the Mac (optional).** Through [ntfy](https://ntfy.sh). An unanswered approval, question or plan review goes to your phone once the screen locks or you've been idle for 2 minutes. A finished turn or error goes there only if you were already away when it happened. See [Phone notifications](#phone-notifications).

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
  phone: false           # also push to your phone through ntfy
  phoneAfterMinutes: 2   # Mac idle time that counts as away (a locked screen counts at once)
  ntfyServer: https://ntfy.sh
  ntfyTopic: ""          # generated on first use
  ntfyToken: ""          # for servers that require an access token
```

Setting `PI_NOTIFICATIONS=off` in the environment turns all notifications off, the same as omp's built-in ones.

## Phone notifications

[ntfy](https://ntfy.sh) is a free, open-source push service with [iOS](https://apps.apple.com/app/ntfy/id1625396347) and [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) apps. The plugin posts to a topic, and your phone subscribes to the same topic.

1. Install the ntfy app on your phone.
2. In omp, run `/notifications` and turn on **Phone notifications (ntfy)**. A QR code and a link appear above the prompt.
3. Scan the code or open the link on your phone, then subscribe to the topic in the ntfy app. You can also add the topic by hand in the app.
4. Confirm the test notification, and check it arrives.

**When the phone gets one:** you count as away from the Mac when the screen is locked, or when there has been no keyboard or mouse input for `phoneAfterMinutes`. An approval, question or plan review is pushed as soon as you're away and it's still unanswered, at high priority. A finished turn or error is pushed only if you were already away when it happened. Each event goes to the phone at most once, and the per-event switches apply here too.

**Privacy:** each push contains the session name and the notification text (tool names, question text), and it goes through ntfy's servers. Anyone who knows a topic name can read it, so the plugin generates a random 30-character topic; keep it private. For full control, [self-host ntfy](https://docs.ntfy.sh/install/), set `ntfyServer`, and set `ntfyToken` if your server requires an access token.

Tapping a phone notification opens the ntfy app. Tern's mobile app has no link that opens a particular pane, so a tap can't take you to the session.

## How notifications are posted

macOS only shows notifications from properly signed apps, and it won't let a command-line process post under another app's name by itself. This plugin uses [alerter](https://github.com/vjeantet/alerter) (MIT), a small notifier that its author signs with an Apple Developer ID.

- On first use the plugin downloads alerter **v26.5** from its GitHub release, checks the zip against a pinned SHA-256, and stores the binary in `~/Library/Caches/omp-desktop-notify/`.
- Notifications are posted with `--sender <terminal bundle id>`, so they carry the terminal's name, icon and notification permission.
- To find out which app is in front, the plugin runs `lsappinfo` while a notification is pending or showing. With the phone channel on, it also reads the Mac's idle time and lock state (`ioreg`) while an event is unanswered.
- Clicking a notification runs `open -b <terminal>`, and under Tern also `tern focus <pane>`.

Apart from the one-time alerter download, nothing touches the network unless you turn on phone notifications, which post to your ntfy server.

## Limitations

- Posting under the terminal's name with `--sender` relies on an old macOS feature that Apple no longer documents. It works on macOS 13 through 27, but a future release could remove it.
- If the terminal can't be identified (see the list above), notifications are always sent, under Terminal's name, and they aren't removed when you come back.
- The plugin does nothing over SSH, because the notification would appear on the remote Mac.
- Phone notifications can't be withdrawn once sent, so an event you answer later stays in the ntfy app.
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
bun install
bun run typecheck
omp plugin link .      # load this checkout into omp
```

`src/index.ts` handles omp's events and decides when to notify. `src/macos.ts` detects the terminal, checks whether you're at the Mac, and posts through alerter. `src/phone.ts` sends to ntfy. `src/settings.ts` defines the settings. omp writes the plugin's debug messages (`desktop-notify: …`) to `~/.omp/logs/`. The only runtime dependency is [uqr](https://github.com/unjs/uqr), which draws the setup QR code; omp's packages are used for types only.

## License

MIT

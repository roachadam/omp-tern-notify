# omp-tern-notify

Get a notification when [omp](https://github.com/can1357/oh-my-pi) needs you: when it wants approval to run something, asks you a question, has a plan ready, or finishes. Notifications go to your Mac, and to your phone too if you turn that on.

It's made for **omp running inside [Tern](https://stencil.so/tern)** on a Mac. That's where it works best: notifications show up as coming from Tern, and clicking one takes you straight to the right pane. It works in other Mac terminals too, with a few things missing (see [Other terminals](#other-terminals)).

This is a community plugin. It isn't made by the omp or Tern teams.

It's meant as a stopgap. Tern already shows its own alerts inside the app, and once it can send them to your desktop and phone itself, this plugin won't be needed. I wanted it until then.

## What it does

| When | You get |
|---|---|
| omp wants approval to run a tool | `Approval needed: bash` |
| omp asks you a question | `Waiting for input: <the question>` |
| A plan is ready for review | `Plan ready for review` |
| omp finishes something that took 10 seconds or more | `Complete` |
| omp stops with an error | `Stopped with error` |

It tries not to bother you:

- **Only when you're not looking.** If Tern is the app in front, you won't get a Mac notification; Tern's own banner already shows it. If omp is still waiting on you when you switch away, the notification shows up then.
- **A short wait first.** It waits 3 seconds before notifying. If you answer in that time, nothing is sent.
- **It cleans up.** The notification disappears once you answer, start a new message, or come back to Tern. If omp is still waiting and you leave again, it comes back.
- **Click to go back.** Clicking a notification brings Tern to the front and opens the pane that sent it.

## Install

You need:

- A Mac running macOS 13 or later
- omp 18.12 or later
- An internet connection the first time (it downloads a small helper app, see [How it works](#how-it-works))

Run:

```sh
omp plugin install github:roachadam/omp-tern-notify
```

Then restart any omp sessions you have open. New sessions pick it up on their own.

The first time a notification goes out, macOS asks whether Tern (or your terminal) can send notifications. Click **Allow**. If you missed it, turn it on in **System Settings › Notifications › Tern**.

### Or ask omp to do it

Paste this into omp:

> Install the omp plugin from github:roachadam/omp-tern-notify with `omp plugin install`, then confirm it shows up in `omp plugin list`. When you're done, tell me to restart my omp sessions and to allow notifications for my terminal when macOS asks. If I want notifications on my phone too, explain the steps in the plugin's README under "Phone notifications".

## Phone notifications (optional)

Phone notifications go through [ntfy](https://ntfy.sh), a free, open-source notification app for iPhone and Android. You don't need an account.

Your phone only gets one when you've stepped away from the Mac, meaning the screen is locked or you haven't touched the keyboard or mouse for 2 minutes. If omp is waiting on an answer, it reaches your phone as soon as you're away. A "Complete" or error only goes to your phone if you were already away when it happened.

To set it up:

1. Install the ntfy app on your phone ([iPhone](https://apps.apple.com/app/ntfy/id1625396347), [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
2. In omp, type `/notifications` and turn on **Phone notifications (ntfy)**. The menu closes and setup instructions appear above where you type.
3. Subscribe your phone:
   - **iPhone:** the topic name is already copied on your Mac. In ntfy, tap **+** and paste. This works through Apple's Universal Clipboard, which needs the same Apple ID on both devices and Handoff turned on (Mac: **System Settings › General › AirDrop & Handoff**; iPhone: **Settings › General › AirPlay & Continuity**). No Handoff? Just type it in. It's a few short words, like `omp-cider-flock-mango-perch-vigor-4821`.
   - **Android:** scan the QR code with your camera. It opens ntfy and subscribes for you.
4. Type `/notifications` again and pick **Send test notification** to check it works.

Tapping a phone notification opens the Tern app (your phone asks first). If you click or dismiss the Mac notification before you leave, the phone won't get that one; you've already seen it.

## Settings

Type `/notifications` in omp to change settings. Pick a line to change it.

| Setting | Default | What it does |
|---|---|---|
| Notifications | on | Turns the whole plugin on or off, phone included |
| When | away | `away`: only when Tern isn't in front. `always`: every time |
| Tool approvals, Questions, Plan reviews, Finished turns, Errors | on | Turn each kind of notification on or off |
| Delay | 3 seconds | How long to wait before notifying |
| Minimum turn length | 10 seconds | Skip "Complete" for quick replies |
| Replace terminal notifications | on | In Tern only, turns off omp's own built-in alerts so you don't see everything twice |
| Sound | default | Sound for Mac notifications: your Mac's alert sound, Glass, Ping, Pop, Submarine, Tink, or off. Picking one plays it so you can hear it |
| Phone notifications | off | Also send to your phone through ntfy |
| Phone sound | on | Off makes phone notifications arrive silently |
| Phone after Mac idle | 2 minutes | How long without keyboard or mouse before you count as away |

Settings are saved in `~/.omp/agent/config.yml` under `ternNotify:`, so you can edit them there too. For the Mac sound you can use any name from `/System/Library/Sounds`, like `sound: Hero`. To turn off all notifications for one session, start omp with `PI_NOTIFICATIONS=off`.

With phone sound on, approvals and questions use ntfy's high priority, which on iPhone also gets through Focus modes. On Android you can pick ntfy's sounds per priority in the app's settings.

## Things to know

- **Mac only.** On Linux and Windows the plugin does nothing. Contributions for Linux or Windows are welcome; see [Development](#development).
- **It leans on an old macOS feature.** Showing notifications as Tern (with Tern's name and icon) uses a trick Apple no longer documents. It works today (tested on macOS 27), but a future macOS update could break it.
- **Clicking only works while omp is running.** If you quit omp, its notifications are removed too.
- **Phone notifications can't be taken back.** Once one is sent, it stays in the ntfy app even after you answer on the Mac.
- **Tapping a phone notification can't open the right pane.** It opens the Tern app, and that's it. Tern doesn't have a link that opens a specific pane yet.
- **Not over SSH.** If you run omp on a Mac over SSH, the plugin turns itself off, because the notifications would show up on that Mac and not in front of you.
- **Only omp's own prompts.** It doesn't know about pop-ups that other omp plugins show.

### Other terminals

iTerm, Terminal, Ghostty, WezTerm, Warp, kitty and VS Code (including Cursor and other VS Code-based editors) work, with these differences:

- Clicking a notification brings the terminal to the front, but can't pick the right tab.
- omp's built-in alerts stay on, so depending on your terminal you might get two alerts for the same thing.
- If your terminal isn't recognised, notifications show up as coming from Terminal, and you get them even while you're looking at it.
- Tapping a phone notification opens the ntfy app, not your terminal.

## Privacy

- Nothing is sent anywhere unless you turn on phone notifications.
- With phone notifications on, each alert (the session name and the message, such as the question omp is asking) goes through ntfy's servers to your phone.
- ntfy topics don't have passwords. Anyone who knows your topic name could read your alerts or send fake ones to your phone. That's why the plugin makes up a long random name (about 65 bits, far too many combinations to guess). Don't share it. If it gets out, use `/notifications` › **New phone topic** to switch to a new one.
- If you want more control, you can [run your own ntfy server](https://docs.ntfy.sh/install/) and point the plugin at it with the `ntfyServer` and `ntfyToken` settings.

## How it works

macOS only shows notifications from apps it trusts. This plugin uses [alerter](https://github.com/vjeantet/alerter), a small, signed helper that sends notifications on behalf of another app (here, Tern). On first use the plugin downloads alerter v26.5 from GitHub, checks that the file is exactly the expected one, and keeps it in `~/Library/Caches/omp-tern-notify/`.

To decide when to notify, the plugin checks which app is in front, and how long it's been since you touched the keyboard or mouse. It only checks while something is waiting.

## Uninstall

```sh
omp plugin uninstall omp-tern-notify
rm -rf ~/Library/Caches/omp-tern-notify
```

If you changed any settings, also delete the `ternNotify:` section from `~/.omp/agent/config.yml`.

## Development

Linux and Windows support would be a welcome contribution. Most of the plugin already works anywhere; the parts that need a version per platform are in `src/macos.ts`: showing and removing a notification, telling whether Tern is in front, and telling whether you're away from the computer. Phone notifications only need the last one. If you take this on, please test it on the real platform and open a pull request.

```sh
git clone https://github.com/roachadam/omp-tern-notify
cd omp-tern-notify
bun install
bun run typecheck
omp plugin link .
```

`omp plugin link .` makes omp load your local copy. Restart omp after you change something. The plugin writes debug lines starting with `tern-notify:` to omp's logs in `~/.omp/logs/`.

| File | What's in it |
|---|---|
| `src/index.ts` | Listens to omp and decides when to notify |
| `src/macos.ts` | Finds your terminal, checks if you're around, shows Mac notifications |
| `src/phone.ts` | Sends to ntfy |
| `src/settings.ts` | The settings |

## Credits

- [alerter](https://github.com/vjeantet/alerter) by Valère Jeantet (MIT)
- [ntfy](https://ntfy.sh) by Philipp Heckel
- [uqr](https://github.com/unjs/uqr) for the QR code (MIT)
- Topic words from the [EFF Short Wordlist](https://www.eff.org/dice), by the Electronic Frontier Foundation ([CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/))

## License

MIT

# Changelog

## 0.1.0

First release.

- Notifies for tool approvals, `ask` questions, plan reviews, finished turns and errors, through alerter v26.5 (downloaded on first use and checked against a pinned SHA-256).
- Only while the terminal app isn't in front, after a 3-second delay. Approvals, questions and plan reviews that come up while you're in the terminal are held and posted if you leave without answering.
- Notifications are removed once their event is handled, when omp exits, or when you return to the terminal.
- Clicking a notification brings the terminal forward; in Tern it also focuses the omp pane.
- Under Tern, notifications carry Tern's name and icon, and omp's duplicate built-in notifications are switched off.
- Optional phone notifications through ntfy once you're away from the Mac (screen locked, or idle for 2 minutes). Setup shows a QR code and sends a test push.
- `/notifications` menu and `desktopNotify.*` settings.

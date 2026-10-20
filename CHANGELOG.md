# Changelog

## 0.1.0

First release.

- Mac notifications when omp wants approval, asks a question, has a plan ready, finishes, or stops with an error.
- Only while Tern (or your terminal) isn't in front, after a 3-second wait. If omp is still waiting on you when you switch away, the notification shows up then.
- Notifications disappear once you answer, start a new message, quit omp, or come back to Tern.
- Clicking a notification brings Tern forward and opens the pane that sent it.
- In Tern, notifications show Tern's name and icon, and omp's own built-in alerts are turned off so you don't see everything twice.
- Optional phone notifications through ntfy once you've left the Mac (screen locked, or 2 minutes without keyboard or mouse). Easy setup: the topic is copied for iPhone, and Android gets a QR code. Includes a test button and a way to switch to a new topic. Tapping one opens the Tern app.
- `/notifications` menu for all settings.

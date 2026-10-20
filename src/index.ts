/**
 * omp-desktop-notify: macOS desktop notifications for omp, plus optional phone push via ntfy.
 *
 * Notifies when a tool call waits for approval, the ask tool waits for an answer, a plan waits
 * for review, a turn finishes, or a run stops with an error, by default only while the
 * terminal app is not frontmost:
 *   - Every event waits `delay` seconds first; nothing is posted if it is handled meanwhile.
 *   - A waiting event (approval, question, plan) that comes due while the terminal is in front is
 *     held and posted when you leave. A finished turn or error is dropped: you already saw it.
 *   - A posted notification is retracted once its event is handled, or when you return to the
 *     terminal; a waiting event is then held again in case you leave without answering.
 *   - With the phone channel on, an event also goes to the phone once you are away from the Mac
 *     (screen locked, or idle for `phoneAfterMinutes`): a waiting event as soon as you leave
 *     while it is unanswered, a finished turn or error only if you were already away.
 * Settings: `/notifications`.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { renderUnicodeCompact } from "uqr";
import { awayFromMac, ensureAlerter, isTern, post, terminal, terminalIsFrontmost } from "./macos.ts";
import { ntfyServer, ntfyTopic, sendToPhone, subscribeUrl } from "./phone.ts";
import { BUILTIN_TERMINAL_NOTIFY, cycle, type MenuRow, settings } from "./settings.ts";

/** How often a held or posted notification checks whether the terminal is frontmost. */
const POLL_MS = 2000;
/** How often an unanswered event checks whether you have left the Mac. */
const PHONE_POLL_MS = 5000;
/** Slot key for finished-turn and error notifications. */
const TURN_KEY = "turn";
const QR_WIDGET = "desktop-notify-qr";

function truncate(text: string, max = 180): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function firstAskQuestion(args: unknown): string | undefined {
	if (!args || typeof args !== "object" || !("questions" in args) || !Array.isArray(args.questions)) return undefined;
	const first: unknown = args.questions[0];
	if (!first || typeof first !== "object" || !("question" in first)) return undefined;
	return typeof first.question === "string" ? first.question : undefined;
}

function notificationsSuppressed(): boolean {
	const value = Bun.env.PI_NOTIFICATIONS;
	return value === "off" || value === "0" || value === "false";
}

export default function desktopNotify(pi: ExtensionAPI) {
	if (process.platform !== "darwin") return;
	// Over SSH the notification would appear on the remote Mac, not in front of you.
	if (Bun.env.SSH_CONNECTION || Bun.env.SSH_TTY) return;
	pi.setLabel("Desktop Notifications");

	const scope = pi.pi.settings;

	/** Live events by key (`approval:<toolCallId>`, `ask:<toolCallId>`, `plan:<reviewId>`, `turn`). */
	const slots = new Map<string, { cancel: () => void }>();
	let posts = 0;
	let turnStartedAt = Date.now();
	/** Set by an agent_end that will continue, so the next agent_start keeps the turn's start time. */
	let continuing = false;
	let overridingBuiltins = false;
	let warned = false;

	const warnOnce = (ctx: ExtensionContext, error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		pi.logger.warn("desktop-notify", { message });
		if (warned) return;
		warned = true;
		ctx.ui.notify(`Desktop notifications: ${message}`, "warning");
	};

	/** The event was handled: drop its queued or held notification and retract a posted one. */
	const cancel = (key: string) => {
		slots.get(key)?.cancel();
		slots.delete(key);
	};
	const cancelAll = () => {
		for (const slot of slots.values()) slot.cancel();
		slots.clear();
	};

	/** Tracks one event from its delay until it is handled, clicked, dismissed, or retracted. */
	const schedule = (ctx: ExtensionContext, key: string, enabled: boolean, body: string, waiting: boolean) => {
		if (!enabled || !settings.enabled.get(scope)) return;
		if (ctx.mode !== "tui" || !ctx.hasUI || notificationsSuppressed()) return;
		cancel(key);

		let cancelled = false;
		/** Undoes the current stage: clears its timer or retracts its notification. */
		let stop = () => {};
		/** Stops waiting to escalate the event to the phone. */
		let stopPhone = () => {};
		const slot = {
			cancel: () => {
				cancelled = true;
				stop();
				stopPhone();
			},
		};
		slots.set(key, slot);
		const finish = () => {
			stop();
			if (waiting) stopPhone(); // dismissed or clicked at the Mac: you have seen it
			if (slots.get(key) === slot) slots.delete(key);
		};
		// Session titles may lead with Nerd Font icons (Unicode private-use code points), which
		// Notification Center's system font and phone fonts draw as a "?" box.
		const sessionName = () => ctx.sessionManager.getSessionName()?.replace(/\p{Co}/gu, "").trim() || "omp";

		/**
		 * Phone stage, independent of the Mac stages. A waiting event goes to the phone once you
		 * leave the Mac while it is unanswered; a finished turn or error only if you were already away.
		 */
		const escalateToPhone = async () => {
			if (!settings.phone.get(scope)) return;
			const idleSeconds = Math.max(0, settings.phoneAfterMinutes.get(scope)) * 60;
			const send = () => {
				pi.logger.debug("desktop-notify: sending to phone", { body });
				sendToPhone(scope, { title: sessionName(), message: truncate(body), urgent: waiting }).catch(error =>
					warnOnce(ctx, error),
				);
			};
			const away = await awayFromMac(idleSeconds);
			if (cancelled) return;
			if (away) return send();
			if (!waiting) return;
			let checking = false;
			const timer = ctx.setInterval(async () => {
				if (cancelled) {
					ctx.clearTimer(timer);
					return;
				}
				if (checking) return;
				checking = true;
				const nowAway = await awayFromMac(idleSeconds).finally(() => {
					checking = false;
				});
				if (cancelled || !nowAway) return;
				ctx.clearTimer(timer);
				send();
			}, PHONE_POLL_MS);
			stopPhone = () => ctx.clearTimer(timer);
		};

		/**
		 * Ends the current stage, then polls until the terminal's frontmost state equals `front`
		 * and runs `next`. Ending the previous stage first matters when a clicked notification
		 * goes back to being held: its return-watch must not keep running.
		 */
		const waitUntil = (front: boolean, next: () => void) => {
			stop();
			let checking = false;
			const timer = ctx.setInterval(async () => {
				if (cancelled) {
					ctx.clearTimer(timer);
					return;
				}
				if (checking) return;
				checking = true;
				const isFront = await terminalIsFrontmost().finally(() => {
					checking = false;
				});
				if (cancelled || isFront !== front) return;
				ctx.clearTimer(timer);
				next();
			}, POLL_MS);
			stop = () => ctx.clearTimer(timer);
		};

		const hold = () => {
			pi.logger.debug("desktop-notify: holding until you leave the terminal", { body });
			waitUntil(false, () => show(true));
		};

		const show = (away: boolean) => {
			const subtitle = sessionName();
			const message = truncate(body);
			const group = `omp-${ctx.sessionManager.getSessionId()}-${++posts}`;
			const controller = new AbortController();
			let returned = false;
			// Posted while away: retract once you are back in the terminal, whose own record of the
			// event is then the only one.
			if (away) {
				waitUntil(true, () => {
					returned = true;
					controller.abort();
				});
			}
			const stopWatching = stop;
			stop = () => {
				stopWatching();
				controller.abort();
			};
			pi.logger.debug("desktop-notify: posting", { subtitle, message });
			post({ subtitle, message, group }, controller.signal).then(
				outcome => {
					pi.logger.debug("desktop-notify: outcome", { message, outcome });
					if (cancelled) return;
					// Back at the terminal (returned, or clicked through) with the event still
					// unanswered: hold it again in case you leave. Dismissing it ends tracking.
					const back = returned || outcome === "contentsClicked" || outcome === "actionClicked";
					if (back && waiting && terminal) hold();
					else finish();
				},
				error => {
					warnOnce(ctx, error);
					finish();
				},
			);
		};

		const delayMs = Math.max(0, settings.delay.get(scope)) * 1000;
		const timer = ctx.setTimeout(async () => {
			escalateToPhone().catch(error => warnOnce(ctx, error));
			// An unidentified terminal cannot be checked, so it is notified as if `when` were "always".
			const front = terminal ? await terminalIsFrontmost() : false;
			if (cancelled) return;
			if (!terminal) show(false);
			else if (!front || settings.when.get(scope) === "always") show(!front);
			else if (waiting) hold();
			else finish();
		}, delayMs);
		stop = () => ctx.clearTimer(timer);
	};

	/**
	 * Tern turns omp's OSC 7501 program status into its own banners and inbox entries, so there
	 * omp's built-in OSC 99 notifications are duplicates and are switched off for this process.
	 * Other terminals keep them: there they are the only in-terminal signal.
	 */
	const applyBuiltinOverride = () => {
		const replace =
			isTern &&
			lookup("terminal.programStatus")?.get(scope) !== false &&
			settings.enabled.get(scope) &&
			settings.replaceBuiltin.get(scope);
		if (replace === overridingBuiltins) return;
		overridingBuiltins = replace;
		for (const id of BUILTIN_TERMINAL_NOTIFY) {
			const builtin = lookup(id);
			if (replace) builtin?.override(scope, "off");
			else builtin?.clearOverride(scope);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		applyBuiltinOverride();
		// Fetch alerter now, so the first notification is not held up by the download.
		if (settings.enabled.get(scope) && ctx.mode === "tui") ensureAlerter().catch(error => warnOnce(ctx, error));
	});
	pi.on("session_shutdown", cancelAll);

	/** Shows how to subscribe a phone (link and QR code above the prompt), then offers a test push. */
	const phoneSetup = async (ctx: ExtensionCommandContext) => {
		const url = subscribeUrl(scope);
		const qr = renderUnicodeCompact(url, { border: 1 }).split("\n");
		ctx.ui.setWidget(QR_WIDGET, [
			"Phone notifications: install the ntfy app (iOS or Android), then scan this or open the link on your phone,",
			`or add topic ${ntfyTopic(scope)} on server ${ntfyServer(scope)} in the app.`,
			url,
			...qr,
		]);
		try {
			const test = await ctx.ui.confirm("Phone notifications", "Subscribed? Send a test notification to your phone now?");
			if (!test) return;
			await sendToPhone(scope, { title: "omp", message: "Test notification from omp-desktop-notify", urgent: false });
			ctx.ui.notify("Test notification sent", "info");
		} catch (error) {
			ctx.ui.notify(`Phone test failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			ctx.ui.setWidget(QR_WIDGET, undefined);
		}
	};

	// omp's /settings panel lists only built-in settings, so this command is the settings UI.
	pi.registerCommand("notifications", {
		description: "Configure desktop and phone notifications",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const menu: MenuRow[] = [
				cycle("Desktop notifications", settings.enabled, [true, false], applyBuiltinOverride),
				cycle("When", settings.when, ["away", "always"]),
				cycle("Tool approvals", settings.approval, [true, false]),
				cycle("Questions", settings.question, [true, false]),
				cycle("Plan reviews", settings.plan, [true, false]),
				cycle("Finished turns", settings.complete, [true, false]),
				cycle("Errors", settings.error, [true, false]),
				cycle("Delay (seconds)", settings.delay, [0, 3, 10, 30]),
				cycle("Minimum turn length (seconds)", settings.minTurn, [0, 10, 30, 60]),
				cycle("Replace terminal notifications (Tern only)", settings.replaceBuiltin, [true, false], applyBuiltinOverride),
				{
					label: "Phone notifications (ntfy)",
					display: s => (settings.phone.get(s) ? "on" : "off"),
					select: async s => {
						const on = !settings.phone.get(s);
						settings.phone.set(s, on);
						if (on) await phoneSetup(ctx);
					},
				},
				cycle("Phone after Mac idle (minutes)", settings.phoneAfterMinutes, [1, 2, 5, 10]),
				{ label: "Phone setup and test", display: () => "QR code, link, test push", select: () => phoneSetup(ctx) },
			];
			for (;;) {
				const options = menu.map(row => `${row.label}: ${row.display(scope)}`);
				const picked = await ctx.ui.select("Notifications (select to change, Esc to close)", options);
				const row = picked === undefined ? undefined : menu[options.indexOf(picked)];
				if (!row) return;
				await row.select(scope);
			}
		},
	});

	pi.on("tool_approval_requested", (event, ctx) => {
		const reason = event.reason ? ` — ${event.reason}` : "";
		const body = `Approval needed: ${event.toolName}${reason}`;
		schedule(ctx, `approval:${event.toolCallId}`, settings.approval.get(scope), body, true);
	});
	// Answering is a fresh start for "Complete": the minimum turn length counts the work after it,
	// not the time spent waiting on you.
	const answered = (key: string) => {
		cancel(key);
		turnStartedAt = Date.now();
	};
	pi.on("tool_approval_resolved", event => answered(`approval:${event.toolCallId}`));

	pi.on("tool_execution_start", (event, ctx) => {
		if (event.toolName !== "ask") return;
		const question = firstAskQuestion(event.args);
		const body = question ? `Waiting for input: ${question}` : "Waiting for input";
		schedule(ctx, `ask:${event.toolCallId}`, settings.question.get(scope), body, true);
	});
	pi.on("tool_execution_end", event => {
		if (event.toolName === "ask") answered(`ask:${event.toolCallId}`);
	});

	pi.on("plan_review_requested", (event, ctx) => {
		const body = `Plan ready for review${event.title ? `: ${event.title}` : ""}`;
		schedule(ctx, `plan:${event.reviewId}`, settings.plan.get(scope), body, true);
	});
	pi.on("plan_review_resolved", event => cancel(`plan:${event.reviewId}`));

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		cancel(TURN_KEY);
		if (!continuing) turnStartedAt = Date.now();
		continuing = false;
	});

	pi.on("agent_end", (event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		continuing = event.willContinue === true;
		if (continuing) return;
		const last = event.messages.findLast(m => m.role === "assistant");
		const stopReason = last && "stopReason" in last ? last.stopReason : undefined;
		if (stopReason === "aborted") return;
		if (stopReason === "error") {
			schedule(ctx, TURN_KEY, settings.error.get(scope), "Stopped with error", false);
			return;
		}
		if (Date.now() - turnStartedAt < settings.minTurn.get(scope) * 1000) return;
		schedule(ctx, TURN_KEY, settings.complete.get(scope), "Complete", false);
	});
}

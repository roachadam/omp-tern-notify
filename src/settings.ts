import {
	type AnySetting,
	type DefinitionValue,
	lookup,
	register,
	type ScopeLike,
	type Setting,
	type SettingDefinition,
} from "@oh-my-pi/pi-coding-agent/config/registry";

/**
 * Registers a setting once per process. When another copy of this plugin already registered the
 * id (for example a leftover file in ~/.omp/agent/extensions), that registration is reused.
 */
function define<const D extends SettingDefinition>(definition: D): Setting<DefinitionValue<D>, D["id"]> {
	// lookup() is untyped; these ids belong to this plugin, so an existing entry has this definition's type.
	const existing = lookup(definition.id) as Setting<DefinitionValue<D>, D["id"]> | undefined;
	return existing ?? register(definition);
}

/** Persisted under `desktopNotify.*` in the global config.yml; edited with `/notifications`. */
export const settings = {
	enabled: define({ id: "desktopNotify.enabled", type: "boolean", default: true }),
	/** away: only while the terminal app is not frontmost; always: every time. */
	when: define({ id: "desktopNotify.when", type: "enum", values: ["away", "always"], default: "away" }),
	approval: define({ id: "desktopNotify.approval", type: "boolean", default: true }),
	question: define({ id: "desktopNotify.question", type: "boolean", default: true }),
	plan: define({ id: "desktopNotify.plan", type: "boolean", default: true }),
	complete: define({ id: "desktopNotify.complete", type: "boolean", default: true }),
	error: define({ id: "desktopNotify.error", type: "boolean", default: true }),
	/** Seconds to wait before notifying; nothing is sent if the event is handled first. */
	delay: define({ id: "desktopNotify.delay", type: "number", default: 3 }),
	/** Finished turns shorter than this many seconds are not notified. */
	minTurn: define({ id: "desktopNotify.minTurnSeconds", type: "number", default: 10 }),
	/** Under Tern, turn off omp's built-in OSC 99 notifications, which duplicate Tern's own banners. */
	replaceBuiltin: define({ id: "desktopNotify.replaceBuiltin", type: "boolean", default: true }),
};

export interface MenuRow {
	label: string;
	setting: AnySetting;
	/** Moves the setting to its next value, wrapping around; an unlisted value moves to the first. */
	advance(scope: ScopeLike): void;
}

function row<T>(label: string, setting: Setting<T>, values: readonly T[]): MenuRow {
	return {
		label,
		setting,
		advance: scope => setting.set(scope, values[(values.indexOf(setting.get(scope)) + 1) % values.length]),
	};
}

/** Rows of the `/notifications` menu. */
export const MENU: readonly MenuRow[] = [
	row("Desktop notifications", settings.enabled, [true, false]),
	row("When", settings.when, ["away", "always"]),
	row("Tool approvals", settings.approval, [true, false]),
	row("Questions", settings.question, [true, false]),
	row("Plan reviews", settings.plan, [true, false]),
	row("Finished turns", settings.complete, [true, false]),
	row("Errors", settings.error, [true, false]),
	row("Delay (seconds)", settings.delay, [0, 3, 10, 30]),
	row("Minimum turn length (seconds)", settings.minTurn, [0, 10, 30, 60]),
	row("Replace terminal notifications (Tern only)", settings.replaceBuiltin, [true, false]),
];

/** omp's own terminal notifications (OSC 99) that Tern already covers through OSC 7501 program status. */
export const BUILTIN_TERMINAL_NOTIFY = ["completion.notify", "ask.notify", "error.notify"] as const;

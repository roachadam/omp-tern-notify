import {
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

	/** Also push to your phone through ntfy while you are away from the Mac. */
	phone: define({ id: "desktopNotify.phone", type: "boolean", default: false }),
	/** Minutes without keyboard or mouse input (or a locked screen) that count as away from the Mac. */
	phoneAfterMinutes: define({ id: "desktopNotify.phoneAfterMinutes", type: "number", default: 2 }),
	ntfyServer: define({ id: "desktopNotify.ntfyServer", type: "string", default: "https://ntfy.sh" }),
	/** Generated on first use. It is the only access control (anyone who knows it can read and post), so it is masked like a secret. */
	ntfyTopic: define({ id: "desktopNotify.ntfyTopic", type: "string", default: "", credential: true }),
	/** Access token for servers that require one (`Authorization: Bearer`). */
	ntfyToken: define({ id: "desktopNotify.ntfyToken", type: "string", default: "", credential: true }),
};

/** omp's own terminal notifications (OSC 99) that Tern already covers through OSC 7501 program status. */
export const BUILTIN_TERMINAL_NOTIFY = ["completion.notify", "ask.notify", "error.notify"] as const;

/** A `/notifications` menu row: shows `label: <value>`; selecting it runs `select`. */
export interface MenuRow {
	label: string;
	display(scope: ScopeLike): string;
	/** Returning "close" closes the menu, e.g. so something shown above the prompt is not blurred by it. */
	select(scope: ScopeLike): void | "close" | Promise<void | "close">;
}

const show = (value: unknown) => (value === true ? "on" : value === false ? "off" : String(value));

/** A row that moves `setting` to its next value, wrapping around; an unlisted value moves to the first. */
export function cycle<T>(label: string, setting: Setting<T>, values: readonly T[], onChange?: () => void): MenuRow {
	return {
		label,
		display: scope => show(setting.get(scope)),
		select: scope => {
			setting.set(scope, values[(values.indexOf(setting.get(scope)) + 1) % values.length]);
			onChange?.();
		},
	};
}

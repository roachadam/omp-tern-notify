/**
 * macOS side: which terminal app hosts omp, whether it is frontmost, and posting notifications
 * through alerter (github.com/vjeantet/alerter).
 *
 * alerter is signed by its author with an Apple Developer ID, so macOS accepts it without anyone
 * re-signing anything. The pinned release is downloaded on first use, checked against its
 * SHA-256 and cached. Notifications are posted with `--sender <terminal bundle id>`, so they carry
 * the terminal's name, icon and notification permission.
 */
import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";

export interface Terminal {
	bundleId: string;
	/** Notification title. */
	name: string;
}

/** Keyed by lowercased TERM_PROGRAM. */
const KNOWN: Record<string, Terminal> = {
	tern: { bundleId: "so.stencil.tern", name: "Tern" },
	"iterm.app": { bundleId: "com.googlecode.iterm2", name: "iTerm" },
	apple_terminal: { bundleId: "com.apple.Terminal", name: "Terminal" },
	ghostty: { bundleId: "com.mitchellh.ghostty", name: "Ghostty" },
	wezterm: { bundleId: "com.github.wez.wezterm", name: "WezTerm" },
	vscode: { bundleId: "com.microsoft.VSCode", name: "VS Code" },
	warpterminal: { bundleId: "dev.warp.Warp-Stable", name: "Warp" },
	kitty: { bundleId: "net.kovidgoyal.kitty", name: "kitty" },
};

function detectTerminal(): Terminal | undefined {
	// kitty sets no TERM_PROGRAM. Other terminals that speak kitty's protocols (Tern among them)
	// also set KITTY_WINDOW_ID, so it only counts when TERM_PROGRAM is absent.
	const program = Bun.env.TERM_PROGRAM?.toLowerCase() ?? (Bun.env.KITTY_WINDOW_ID ? "kitty" : undefined);
	const known = program ? KNOWN[program] : undefined;
	// macOS passes the launching app's bundle id to its processes (Tern does not). It identifies
	// VS Code forks, which all claim TERM_PROGRAM=vscode, and terminals behind tmux.
	const launcher = Bun.env.__CFBundleIdentifier;
	if (launcher && (!known || program === "vscode")) {
		const name = Object.values(KNOWN).find(t => t.bundleId === launcher)?.name ?? known?.name ?? "omp";
		return { bundleId: launcher, name };
	}
	return known;
}

/** The terminal app omp runs in; undefined when it cannot be identified. */
export const terminal = detectTerminal();
export const isTern = terminal?.bundleId === KNOWN.tern.bundleId;

const ternPath = Bun.which("tern");
const ternPane = Bun.env.TERN_PANE;

async function output(argv: string[]): Promise<string> {
	const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
	return new Response(proc.stdout).text();
}

/** Whether the terminal app is the frontmost app; false when the terminal is unknown. */
export async function terminalIsFrontmost(): Promise<boolean> {
	if (!terminal) return false;
	const asn = (await output(["lsappinfo", "front"])).trim();
	if (!asn) return false;
	const info = await output(["lsappinfo", "info", "-only", "bundleid", asn]);
	return /bundleID="([^"]+)"/.exec(info)?.[1] === terminal.bundleId;
}

/**
 * Whether you have left the Mac: the screen is locked, or there has been no keyboard or mouse
 * input for `idleSeconds`. A locked screen counts at once.
 */
export async function awayFromMac(idleSeconds: number): Promise<boolean> {
	const root = await output(["ioreg", "-n", "Root", "-d1"]);
	if (/"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(root)) return true;
	const hid = await output(["ioreg", "-c", "IOHIDSystem", "-d", "4", "-r", "-k", "HIDIdleTime"]);
	const idleNs = /"HIDIdleTime" = (\d+)/.exec(hid)?.[1];
	return idleNs !== undefined && Number(idleNs) / 1e9 >= idleSeconds;
}

/** Brings the terminal forward and, under Tern, focuses the pane this omp runs in. */
async function focusTerminal(): Promise<void> {
	if (!terminal) return;
	await Bun.spawn(["open", "-b", terminal.bundleId], { stdout: "ignore", stderr: "ignore" }).exited;
	if (isTern && ternPath && ternPane) {
		await Bun.spawn([ternPath, "focus", ternPane], { stdout: "ignore", stderr: "ignore" }).exited;
	}
}

/** Built-in alert sounds offered in the menu; any name from /System/Library/Sounds works in config. */
export const MAC_SOUNDS = ["default", "Glass", "Ping", "Pop", "Submarine", "Tink", "off"] as const;

/** The `sound` setting as alerter takes it: undefined for "off". */
export function macSound(setting: string | undefined): string | undefined {
	const name = setting?.trim();
	return !name || name === "off" ? undefined : name;
}

/** Plays a sound once, so you can hear a choice in the menu. "default" is your Mac's alert sound. */
export function previewSound(setting: string | undefined): void {
	const name = macSound(setting);
	if (!name) return;
	const path =
		name === "default"
			? Bun.spawnSync(["defaults", "read", "-g", "com.apple.sound.beep.sound"]).stdout.toString().trim()
			: `/System/Library/Sounds/${name}.aiff`;
	if (path) Bun.spawn(["afplay", path], { stdout: "ignore", stderr: "ignore" }).unref();
}

const ALERTER_VERSION = "26.5";
const ALERTER_URL = `https://github.com/vjeantet/alerter/releases/download/v${ALERTER_VERSION}/alerter-${ALERTER_VERSION}.zip`;
const ALERTER_ZIP_SHA256 = "11f63cddc9bb3f8554ed9b762632a120cfa7bee05e3c09d65734823e09d24f10";
const ALERTER_DIR = `${homedir()}/Library/Caches/omp-tern-notify/alerter-${ALERTER_VERSION}`;
const ALERTER_PATH = `${ALERTER_DIR}/alerter`;
const DOWNLOAD_TIMEOUT_MS = 60_000;

let alerterReady: Promise<string> | undefined;

/** Resolves to the alerter binary, downloading and verifying the pinned release once. */
export function ensureAlerter(): Promise<string> {
	alerterReady ??= installAlerter();
	alerterReady.catch(() => {
		alerterReady = undefined; // retry on the next notification
	});
	return alerterReady;
}

async function installAlerter(): Promise<string> {
	if (await Bun.file(ALERTER_PATH).exists()) return ALERTER_PATH;
	const response = await fetch(ALERTER_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`alerter download failed: HTTP ${response.status}`);
	const zip = new Uint8Array(await response.arrayBuffer());
	const digest = new Bun.CryptoHasher("sha256").update(zip).digest("hex");
	if (digest !== ALERTER_ZIP_SHA256) throw new Error(`alerter download checksum mismatch (${digest})`);
	// Unpack into a private staging directory, then rename the binary into place: a file rename
	// replaces the target atomically, so concurrent first runs in other omp processes are harmless.
	await mkdir(ALERTER_DIR, { recursive: true });
	const staging = `${ALERTER_DIR}/.staging-${process.pid}-${Date.now()}`;
	await mkdir(staging);
	try {
		await Bun.write(`${staging}/alerter.zip`, zip);
		const unzip = Bun.spawn(["unzip", "-q", "-o", `${staging}/alerter.zip`, "alerter", "-d", staging], {
			stdout: "ignore",
			stderr: "pipe",
		});
		if ((await unzip.exited) !== 0) throw new Error(`unzip failed: ${await new Response(unzip.stderr).text()}`);
		await rename(`${staging}/alerter`, ALERTER_PATH);
		return ALERTER_PATH;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

function activationType(output: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(output);
		if (parsed && typeof parsed === "object" && "activationType" in parsed && typeof parsed.activationType === "string") {
			return parsed.activationType;
		}
	} catch {}
	return undefined;
}

export interface Notification {
	subtitle: string;
	message: string;
	/** Notifications sharing a group replace each other. */
	group: string;
	/** "default" or a /System/Library/Sounds name; undefined is silent. */
	sound: string | undefined;
}

/**
 * Posts one notification and resolves once it is clicked or dismissed (with alerter's
 * activation type), or with "retracted" after `signal` aborts. Clicking focuses the terminal.
 *
 * Retraction interrupts alerter, which deletes its notification on SIGINT;
 * `alerter --remove <group>` cannot find notifications posted with `--sender`.
 */
export async function post(notification: Notification, signal: AbortSignal): Promise<string | undefined> {
	const alerter = await ensureAlerter();
	if (signal.aborted) return "retracted";
	// `--option=value`: a value starting with "-" would otherwise be read as an option.
	const argv = [
		alerter,
		`--title=${terminal?.name ?? "omp"}`,
		`--subtitle=${notification.subtitle}`,
		`--message=${notification.message}`,
		`--group=${notification.group}`,
		"--json",
	];
	if (notification.sound) argv.push(`--sound=${notification.sound}`);
	if (terminal) argv.push(`--sender=${terminal.bundleId}`);
	const spawn = () => {
		try {
			return Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", signal, killSignal: "SIGINT" });
		} catch (error) {
			alerterReady = undefined; // the cached binary went missing: reinstall next time
			throw error;
		}
	};
	const proc = spawn();
	proc.unref(); // a notification waiting for a click must not keep omp alive
	const [code, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (signal.aborted) return "retracted";
	if (code !== 0) throw new Error(stderr.trim() || `alerter exited ${code}`);
	const type = activationType(stdout);
	if (type === "contentsClicked" || type === "actionClicked") await focusTerminal();
	return type;
}

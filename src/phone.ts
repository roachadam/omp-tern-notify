/**
 * Phone notifications through ntfy (https://ntfy.sh): an open-source push service with iOS and
 * Android apps. Messages are posted to a topic; the phone app subscribes to the same topic.
 */
import type { ScopeLike } from "@oh-my-pi/pi-coding-agent/config/registry";
import { isTern } from "./macos.ts";
import { settings } from "./settings.ts";
import { WORDS } from "./wordlist.ts";

const REQUEST_TIMEOUT_MS = 10_000;
/** 5 words of 1,296 (51.7 bits) plus 4 digits (13.3 bits): about 65 bits, typeable on a phone. */
const TOPIC_WORDS = 5;
const TOPIC_DIGITS = 4;

/** A uniformly random integer in [0, n), by rejection sampling so no value is favoured. */
function randomBelow(n: number): number {
	const limit = Math.floor(0x1_0000_0000 / n) * n;
	const buffer = new Uint32Array(1);
	for (;;) {
		crypto.getRandomValues(buffer);
		if (buffer[0]! < limit) return buffer[0]! % n;
	}
}

/**
 * The configured topic, generated and saved on first use, e.g. `omp-cider-flock-mango-perch-vigor-4821`.
 * ntfy topics are readable, and writable, by anyone who knows the name, so it must be unguessable:
 * about 65 bits, far beyond what ntfy.sh's per-IP rate limits allow anyone to search.
 */
export function ntfyTopic(scope: ScopeLike): string {
	const existing = settings.ntfyTopic.get(scope)?.trim();
	if (existing) return existing;
	const words = Array.from({ length: TOPIC_WORDS }, () => WORDS[randomBelow(WORDS.length)]);
	const digits = String(randomBelow(10 ** TOPIC_DIGITS)).padStart(TOPIC_DIGITS, "0");
	const topic = `omp-${words.join("-")}-${digits}`;
	settings.ntfyTopic.set(scope, topic);
	return topic;
}

export function ntfyServer(scope: ScopeLike): string {
	return (settings.ntfyServer.get(scope)?.trim() || "https://ntfy.sh").replace(/\/+$/, "");
}

/**
 * A link that subscribes the ntfy Android app in one tap. The iOS app registers no link
 * handler, so on an iPhone the topic has to be added in the app (see `copyTopic`).
 */
export function appLink(scope: ScopeLike): string {
	const server = new URL(ntfyServer(scope));
	const insecure = server.protocol === "http:" ? "&secure=false" : "";
	return `ntfy://${server.host}${server.pathname.replace(/\/+$/, "")}/${ntfyTopic(scope)}?display=omp${insecure}`;
}

/** Puts the topic on the Mac clipboard; Universal Clipboard makes it pasteable on an iPhone. */
export async function copyTopic(scope: ScopeLike): Promise<void> {
	const proc = Bun.spawn(["pbcopy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
	proc.stdin.write(ntfyTopic(scope));
	await proc.stdin.end();
	await proc.exited;
}

export interface PhoneMessage {
	title: string;
	message: string;
	/** Waiting events ring at high priority; finished turns at the default. */
	urgent: boolean;
}

/**
 * Tapping opens the Tern app when omp runs in Tern. Tern's links only carry pairing codes, so
 * this opens the app (iOS asks first) but cannot select the session's pane.
 */
const TERN_APP_LINK = "tern://";

export async function sendToPhone(scope: ScopeLike, message: PhoneMessage): Promise<void> {
	const token = settings.ntfyToken.get(scope)?.trim();
	const response = await fetch(ntfyServer(scope), {
		method: "POST",
		headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify({
			topic: ntfyTopic(scope),
			title: message.title,
			message: message.message,
			priority: message.urgent ? 4 : 3,
			tags: [message.urgent ? "bell" : "white_check_mark"],
			...(isTern ? { click: TERN_APP_LINK } : {}),
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`ntfy: HTTP ${response.status} ${(await response.text()).trim()}`);
}

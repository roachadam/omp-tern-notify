/**
 * Phone notifications through ntfy (https://ntfy.sh): an open-source push service with iOS and
 * Android apps. Messages are posted to a topic; the phone app subscribes to the same topic.
 */
import type { ScopeLike } from "@oh-my-pi/pi-coding-agent/config/registry";
import { settings } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;
const TOPIC_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * The configured topic, generated and saved on first use. ntfy topics are readable by anyone who
 * knows the name, so it is long and random: 26 characters of base32, 130 bits.
 */
export function ntfyTopic(scope: ScopeLike): string {
	const existing = settings.ntfyTopic.get(scope)?.trim();
	if (existing) return existing;
	const random = crypto.getRandomValues(new Uint8Array(26));
	const topic = `omp-${Array.from(random, byte => TOPIC_ALPHABET[byte % 32]).join("")}`;
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
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`ntfy: HTTP ${response.status} ${(await response.text()).trim()}`);
}

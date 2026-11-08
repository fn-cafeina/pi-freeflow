/**
 * Regression tests for relay-template backslash escaping (issue #25).
 * The worker core is generated inside a String.raw outer literal, so
 * backslashes in src/deploy.ts are written singly and reach the deployed
 * output verbatim (doubling them would corrupt the guards again).
 * These tests execute the generated code: syntax via `node --check` and
 * guard behavior by running the generated functions.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
 buildCloudflareRelayWorker,
 buildDenoRelayScript,
 buildVercelRelayWorker,
} from "../src/deploy.ts";

const BUILDERS = {
 vercel: buildVercelRelayWorker,
 cloudflare: buildCloudflareRelayWorker,
 deno: buildDenoRelayScript,
} as const;

/** Strip the platform wrapper so the shared core can run under `new Function`. */
function coreOf(src: string): string {
 for (const marker of ["\nexport const config", "\nexport default", "\nDeno.serve"]) {
  const at = src.indexOf(marker);
  if (at !== -1) return src.slice(0, at);
 }
 throw new Error("unknown relay template wrapper");
}

type RelayCore = {
 resolveRelayTarget: (target: string, relayPath: unknown) => { ok: boolean; url?: string; status?: number };
 isPrivateHostname: (h: unknown) => boolean;
 relayHandler: (req: { method: string; headers: Headers; body?: BodyInit | null }) => Promise<Response>;
};

function loadCore(src: string): RelayCore {
 const fn = new Function(`${coreOf(src)}; return { resolveRelayTarget, isPrivateHostname, relayHandler };`);
 return fn() as RelayCore;
}

for (const [label, build] of Object.entries(BUILDERS)) {
 for (const auth of ["", "s3cr3t-auth"]) {
  test(`${label} template (auth ${auth ? "set" : "empty"}) passes node --check`, () => {
   const dir = mkdtempSync(join(tmpdir(), "relay-check-"));
   const file = join(dir, `${label}.mjs`);
   writeFileSync(file, build(auth));
   const out = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
   assert.equal(out.status, 0, `${label}: node --check failed: ${out.stderr}`);
  });
 }
}

test("generated core keeps backslash guards intact", () => {
 const core = loadCore(buildVercelRelayWorker(""));
 // Backslash in x-relay-path is forbidden (would be a syntax error if unescaped).
 assert.deepEqual(core.resolveRelayTarget("https://opencode.ai", "/zen\\x"), { ok: false, status: 403, reason: "forbidden x-relay-path" });
 assert.deepEqual(core.resolveRelayTarget("https://opencode.ai", "/a@b"), { ok: false, status: 403, reason: "forbidden x-relay-path" });
 assert.equal(core.resolveRelayTarget("https://opencode.ai", "/zen/v1/models").ok, true);
});

test("generated core strips brackets and matches IPv4 private ranges", () => {
 const core = loadCore(buildVercelRelayWorker(""));
 assert.equal(core.isPrivateHostname("[::1]"), true, "bracket-strip");
 assert.equal(core.isPrivateHostname("[fd00::1]"), true, "bracketed IPv6 unique-local");
 assert.equal(core.isPrivateHostname("fe80::1"), true, "IPv6 link-local");
 assert.equal(core.isPrivateHostname("127.0.0.1"), true, "IPv4 loopback");
 assert.equal(core.isPrivateHostname("10.1.2.3"), true, "IPv4 10/8");
 assert.equal(core.isPrivateHostname("192.168.0.5"), true, "IPv4 192.168/16");
 assert.equal(core.isPrivateHostname("8.8.8.8"), false, "public IPv4 passes");
});

test("generated relayHandler strips a trailing slash before the whitelist check", async () => {
	const core = loadCore(buildVercelRelayWorker(""));
	const seen: string[] = [];
	const realFetch = globalThis.fetch;
	(globalThis as Record<string, unknown>).fetch = async (url: URL | string) => {
		seen.push(String(url));
		return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
	};
	try {
		const headers = new Headers({ "x-relay-target": "https://opencode.ai/", "x-relay-path": "/zen/v1/models" });
		const res = await core.relayHandler({ method: "GET", headers, body: null });
		assert.equal(res.status, 200);
		assert.deepEqual(seen, ["https://opencode.ai/zen/v1/models"]);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("generated relayHandler never forwards visitor IP or platform headers", async () => {
	const core = loadCore(buildCloudflareRelayWorker(""));
	const stripped = [
		"cf-connecting-ip",
		"cf-connecting-ipv6",
		"cf-pseudo-ipv4",
		"cf-ipcountry",
		"cf-worker",
		"cf-ray",
		"cdn-loop",
		"true-client-ip",
		"x-real-ip",
		"x-forwarded-for",
		"x-forwarded-host",
		"x-forwarded-proto",
		"x-client-ip",
		"x-originate-ip",
		"x-relay-target",
		"x-relay-path",
		"x-relay-auth",
	];
	let forwarded: Headers | undefined;
	const realFetch = globalThis.fetch;
	(globalThis as Record<string, unknown>).fetch = async (_url: URL | string, init?: RequestInit) => {
		forwarded = init?.headers as Headers;
		return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
	};
	try {
		const headers = new Headers({
			"content-type": "application/json",
			"cf-connecting-ip": "203.0.113.9",
			"cf-connecting-ipv6": "2001:db8::1",
			"cf-pseudo-ipv4": "198.51.100.7",
			"cf-ipcountry": "ES",
			"cf-worker": "example.com",
			"cf-ray": "abc123-MAD",
			"cdn-loop": "cloudflare",
			"true-client-ip": "203.0.113.9",
			"x-real-ip": "203.0.113.9",
			"x-forwarded-for": "203.0.113.9",
			"x-forwarded-host": "example.com",
			"x-forwarded-proto": "https",
			"x-client-ip": "203.0.113.9",
			"x-originate-ip": "203.0.113.9",
			"x-relay-target": "https://opencode.ai",
			"x-relay-path": "/zen/v1/models",
			"x-relay-auth": "secret",
		});
		const res = await core.relayHandler({ method: "GET", headers, body: null });
		assert.equal(res.status, 200);
		assert.ok(forwarded, "the handler must call fetch");
		for (const name of stripped) {
			assert.equal(forwarded.get(name), null, `${name} must not reach the upstream`);
		}
		assert.equal(forwarded.get("content-type"), "application/json", "caller content-type must survive");
	} finally {
		globalThis.fetch = realFetch;
	}
});

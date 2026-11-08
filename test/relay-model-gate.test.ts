/**
 * Relay-egress model gate: only free-catalog models ride relays,
 * unknown/paid models go direct upstream.
 *
 * Unit-covers isRelayEligibleModel plus one proxy-level routing proof:
 * with a seeded fake relay pool, a free-model POST touches the relay URL
 * while an unknown-model POST only ever hits direct upstream.
 */
import "./user-flow-env.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { isRelayEligibleModel, relayBypassedForTransport, startProxy } from "../src/proxy.ts";
import { _setAttemptHeaderTimeoutForTest } from "../src/relay.ts";
import { isRelayHealthy, resetAllRelayHealth, setActiveRelayState } from "../src/relay-state.ts";
import type { KnownRelay, RelayState } from "../src/types.ts";
import { clearSandboxFiles, withIsolatedSandboxFiles } from "./_sandbox-helpers.ts";
import { authHeaders } from "./_auth.ts";

const ZEN_FREE = "nemotron-3.5-super-vl-free";
const KILO_FREE = "dots-studio/dots-3-note-preview:free";
const UNKNOWN_MODEL = "gpt-9-ultra-paid";
const OVH_FREE = "ovh-free/gpt-oss-20b";

// ── Helper unit coverage ──────────────────────────────────────────

test("isRelayEligibleModel allows zen free catalog ids", () => {
 assert.equal(isRelayEligibleModel(ZEN_FREE), true);
	assert.equal(isRelayEligibleModel("mimo-v2.6-flash-free"), true);
	assert.equal(isRelayEligibleModel("mimo-v2.5-free"), false, "pruned model must not stay relay-eligible");
	assert.equal(isRelayEligibleModel("ling-3.0-flash-fin-free"), false, "pruned model must not stay relay-eligible");
});

test("isRelayEligibleModel allows kilo free catalog ids", () => {
 assert.equal(isRelayEligibleModel(KILO_FREE), true);
});

test("isRelayEligibleModel rejects direct-only lanes (Cline), allows OVH", () => {
 assert.equal(isRelayEligibleModel(OVH_FREE), true, "ovh catalog ids are relay-eligible");
 assert.equal(isRelayEligibleModel("gpt-oss-20b"), true, "an ovh alias resolves to an ovh id first");
 assert.equal(isRelayEligibleModel("cline/nemotron-3.5-super-vl"), false, "cline stays direct-only");
});

test("isRelayEligibleModel rejects unknown/paid models and non-strings", () => {
 assert.equal(isRelayEligibleModel(UNKNOWN_MODEL), false);
 assert.equal(isRelayEligibleModel("gpt-4"), false);
 assert.equal(isRelayEligibleModel(42), false);
 assert.equal(isRelayEligibleModel({}), false);
 assert.equal(isRelayEligibleModel([]), false);
});

test("isRelayEligibleModel allows missing/empty models (bodiless routes keep routing)", () => {
 assert.equal(isRelayEligibleModel(undefined), true);
 assert.equal(isRelayEligibleModel(null), true);
 assert.equal(isRelayEligibleModel(""), true);
 assert.equal(isRelayEligibleModel("   "), true);
});

test("relay egress is bypassed for the sidecar transport only", () => {
 assert.equal(relayBypassedForTransport("bun-sidecar"), true);
 assert.equal(relayBypassedForTransport("node"), false);
});

// ── Proxy-level routing proof ─────────────────────────────

/** Minimal JSON response the proxy can pipe (mirrors user-flow stubResponse). */
function stubJson(body: string): Response {
 const encoder = new TextEncoder();
 return {
  status: 200,
  ok: true,
  headers: new Headers({ "content-type": "application/json" }),
  text: async () => body,
  body: new ReadableStream({
   start(controller) {
    controller.enqueue(encoder.encode(body));
    controller.close();
   },
  }),
 } as unknown as Response;
}

function chatBody(model: string): string {
 return JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] });
}

test("unknown-model POST bypasses the relay pool while free-model POST uses it", async () => {
 await withIsolatedSandboxFiles(async () => {
  clearSandboxFiles();
  const relay = "http://127.0.0.1:19371";
  const state: RelayState = {
   mode: "on",
   enabled: true,
   url: relay,
   relays: [{ url: relay }] as KnownRelay[],
  };
  const testPort = 19370;
  const { server, port } = await startProxy(testPort);
  assert.ok(server, "proxy must start");
  const effectivePort = port ?? testPort;
  const localPrefix = `http://127.0.0.1:${effectivePort}`;
  const realFetch = globalThis.fetch.bind(globalThis);
  const seen: string[] = [];
  try {
   setActiveRelayState(state, true);
   resetAllRelayHealth();
   const fetchMock = test.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init?: RequestInit) => {
     const u = String(url);
     if (u.startsWith(localPrefix)) return realFetch(u, init);
     seen.push(u);
     return stubJson(JSON.stringify({ id: "ok", choices: [] }));
    },
   );
   try {
    // Free catalog model rides the relay even with the pool on.
    const freeRes = await fetch(`${localPrefix}/v1/chat/completions`, {
     method: "POST",
     headers: { "content-type": "application/json", ...authHeaders() },
     body: chatBody(ZEN_FREE),
    });
    assert.equal(freeRes.status, 200);
    await freeRes.text();
    assert.ok(
     seen.some((u) => u.startsWith(relay)),
     `free-model POST must touch the relay URL, saw: ${seen.join(", ")}`,
    );

    // Unknown/paid model bypasses every relay and goes direct.
    seen.length = 0;
    const paidRes = await fetch(`${localPrefix}/v1/chat/completions`, {
     method: "POST",
     headers: { "content-type": "application/json", ...authHeaders() },
     body: chatBody(UNKNOWN_MODEL),
    });
    assert.equal(paidRes.status, 200);
    await paidRes.text();
    assert.ok(seen.length > 0, "unknown-model POST must still reach upstream");
    assert.ok(
     seen.every((u) => !u.startsWith(relay)),
     `unknown-model POST must never touch a relay URL, saw: ${seen.join(", ")}`,
    );
    assert.ok(
     seen.some((u) => u.includes("opencode.ai")),
     `unknown-model POST must go direct upstream, saw: ${seen.join(", ")}`,
    );
   } finally {
    fetchMock.mock.restore();
   }
  } finally {
   if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
 });
});

test("ovh-model POST uses the relay pool when armed", async () => {
 // When relay pool is armed, OVH models ride the relay pool to spread burst requests.
 await withIsolatedSandboxFiles(async () => {
  clearSandboxFiles();
  const relay = "http://127.0.0.1:19373";
  const state: RelayState = {
   mode: "on",
   enabled: true,
   url: relay,
   relays: [{ url: relay }] as KnownRelay[],
  };
  const testPort = 19372;
  const { server, port } = await startProxy(testPort);
  assert.ok(server, "proxy must start");
  const effectivePort = port ?? testPort;
  const localPrefix = `http://127.0.0.1:${effectivePort}`;
  const realFetch = globalThis.fetch.bind(globalThis);
  const seen: string[] = [];
  try {
   setActiveRelayState(state, true);
   resetAllRelayHealth();
   const fetchMock = test.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init?: RequestInit) => {
     const u = String(url);
     if (u.startsWith(localPrefix)) return realFetch(u, init);
     seen.push(u);
     return stubJson(JSON.stringify({ id: "ok", choices: [] }));
    },
   );
   try {
    for (const model of [OVH_FREE, "gpt-oss-20b"]) {
     seen.length = 0;
     const ovhRes = await fetch(`${localPrefix}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: chatBody(model),
     });
     assert.equal(ovhRes.status, 200);
     await ovhRes.text();
     assert.ok(seen.length > 0, "ovh POST must reach upstream");
     assert.ok(
      seen.some((u) => u.startsWith(relay)),
      `ovh POST (${model}) must touch a relay URL, saw: ${seen.join(", ")}`,
     );
    }
   } finally {
    fetchMock.mock.restore();
   }
  } finally {
   if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
 });
});

test("ovh hung relay hits its own header deadline and falls back direct", async () => {
 // The lane must not put a 300s timer on relayFetch's caller signal: that
 // would read as a client abort, leaving the pool unmarked and the request
 // dead in the water. The relay's own per-attempt deadline must cool it and
 // roll to the direct upstream instead.
 await withIsolatedSandboxFiles(async () => {
  clearSandboxFiles();
  const relay = "http://127.0.0.1:19375";
  const state: RelayState = {
   mode: "on",
   enabled: true,
   url: relay,
   relays: [{ url: relay }] as KnownRelay[],
  };
  const testPort = 19374;
  const { server, port } = await startProxy(testPort);
  assert.ok(server, "proxy must start");
  const effectivePort = port ?? testPort;
  const localPrefix = `http://127.0.0.1:${effectivePort}`;
  const realFetch = globalThis.fetch.bind(globalThis);
  const restoreDeadline = _setAttemptHeaderTimeoutForTest(40);
  const seen: string[] = [];
  try {
   setActiveRelayState(state, true);
   resetAllRelayHealth();
   const fetchMock = test.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init?: RequestInit) => {
     const u = String(url);
     if (u.startsWith(localPrefix)) return realFetch(u, init);
     seen.push(u);
     if (u.startsWith(relay)) {
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
       const abort = (): void => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
       if (signal?.aborted) return abort();
       signal?.addEventListener("abort", abort, { once: true });
      });
     }
     const sse = [
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "gpt-oss-20b", choices: [{ index: 0, delta: { role: "assistant", content: "recovered" } }] })}\n\n`,
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "gpt-oss-20b", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
     ].join("");
     return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
   );
   try {
    const res = await fetch(`${localPrefix}/v1/chat/completions`, {
     method: "POST",
     headers: { "content-type": "application/json", ...authHeaders() },
     body: chatBody(OVH_FREE),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("recovered"), "the direct fallback must serve the answer");
    assert.ok(seen.some((u) => u.startsWith(relay)), "the relay must be attempted first");
    assert.ok(
     seen.some((u) => u.includes("oai.endpoints.kepler.ai.cloud.ovh.net")),
     `the direct OVH upstream must be tried after the timeout, saw: ${seen.join(", ")}`,
    );
    assert.equal(isRelayHealthy(relay, "ovh"), false, "the hung relay must be cooling for the OVH lane");
    assert.equal(isRelayHealthy(relay), true, "the OVH timeout must not cool the relay for Zen");
   } finally {
    fetchMock.mock.restore();
   }
  } finally {
   restoreDeadline();
   resetAllRelayHealth();
   if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
 });
});

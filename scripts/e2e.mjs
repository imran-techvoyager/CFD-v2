#!/usr/bin/env node
/**
 * End-to-end test suite for the CFD platform (volume/lots trading model).
 *
 * Requires the full stack running locally (docker compose + all apps).
 * Injects synthetic ticks straight into engine-stream (via docker exec
 * redis-cli) to deterministically trigger TP/SL/liquidation, and hammers the
 * API concurrently to prove the balance ledger can't be raced.
 *
 * Usage: node scripts/e2e.mjs
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const API = process.env.API_URL || "http://localhost:4000/api/v1";

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  ✗ ${name} ${detail ? `— ${detail}` : ""}`);
  }
}

function section(name) {
  console.log(`\n■ ${name}`);
}

async function req(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function decodeUserId(token) {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString()
  );
  return payload.id;
}

function injectTick(symbol, bid, ask) {
  const data = JSON.stringify({
    kind: "price-update",
    payload: {
      symbol,
      askPrice: Math.round(ask * 10_000),
      bidPrice: Math.round(bid * 10_000),
      time: Math.floor(Date.now() / 1000),
    },
  });
  execFileSync("docker", [
    "exec", "cfd_redis", "redis-cli",
    "XADD", "engine-stream", "*", "data", data,
  ]);
}

function injectRaw(data) {
  execFileSync("docker", [
    "exec", "cfd_redis", "redis-cli",
    "XADD", "engine-stream", "*", "data", data,
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newUser(tag) {
  const email = `e2e-${tag}-${Date.now()}@test.local`;
  const r = await req("/auth/signup", {
    method: "POST",
    body: { email, password: "password123" },
  });
  if (r.status !== 200) throw new Error(`signup failed: ${JSON.stringify(r.body)}`);
  return { token: r.body.token, userId: decodeUserId(r.body.token), email };
}

async function balance(token) {
  const r = await req("/auth/me", { token });
  return r.body.user.balance;
}

/** tiny probe order proves live prices exist and reveals the current price */
async function probePrice(token, asset, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const r = await req("/trade", {
      method: "POST",
      token,
      body: { asset, type: "buy", volume: 0.01, leverage: 400 },
    });
    if (r.status === 200) {
      await req("/trade/close", {
        method: "POST",
        token,
        body: { orderId: r.body.order.orderId },
      });
      return r.body.order.openPrice;
    }
    await sleep(300);
  }
  throw new Error(`no live price for ${asset}`);
}

// --------------------------------------------------------------------- tests

async function testHealthAndAuth() {
  section("health & auth");

  const health = await fetch(`${API.replace("/api/v1", "")}/health`);
  ok("health endpoint", health.status === 200);

  const u = await newUser("auth");
  ok("signup grants $5,000 paper money", (await balance(u.token)) === 5000);

  const dup = await req("/auth/signup", {
    method: "POST",
    body: { email: u.email, password: "password123" },
  });
  ok("duplicate email rejected", dup.status === 400);

  const badPw = await req("/auth/signin", {
    method: "POST",
    body: { email: u.email, password: "wrongpass123" },
  });
  ok("wrong password rejected", badPw.status === 400);

  const noTok = await req("/trade/open");
  ok("missing token → 401", noTok.status === 401);

  const badTok = await req("/trade/open", { token: "garbage" });
  ok("garbage token → 401", badTok.status === 401);

  return u;
}

async function testValidation(u) {
  section("input validation");

  const cases = [
    [{ asset: "DOGE", type: "buy", volume: 1, leverage: 5 }, "unknown asset"],
    [{ asset: "BTC", type: "buy", volume: -1, leverage: 5 }, "negative volume"],
    [{ asset: "BTC", type: "buy", volume: 0.001, leverage: 5 }, "volume below 0.01"],
    [{ asset: "BTC", type: "buy", volume: 1, leverage: 7 }, "invalid leverage"],
    [{ asset: "BTC", type: "hold", volume: 1, leverage: 5 }, "invalid side"],
    [{ asset: "BTC", type: "buy", volume: 100, leverage: 1 }, "margin > balance"],
    [{ asset: "BTC", type: "buy", volume: 0.1, leverage: 5, takeprofit: 1 }, "TP below entry (buy)"],
    [{ asset: "BTC", type: "buy", volume: 0.1, leverage: 5, stoploss: 99999999 }, "SL above entry (buy)"],
  ];

  for (const [body, name] of cases) {
    const r = await req("/trade", { method: "POST", token: u.token, body });
    ok(`rejects ${name}`, r.status === 400, `got ${r.status}`);
  }
}

async function testTradeLifecycle() {
  section("trade lifecycle & balance ledger (lots model)");

  const u = await newUser("lifecycle");
  await probePrice(u.token, "BTC");
  const bal0 = await balance(u.token);

  const open = await req("/trade", {
    method: "POST",
    token: u.token,
    body: { asset: "BTC", type: "buy", volume: 0.05, leverage: 10 },
  });
  ok("opens a 0.05-lot 1:10 BTC long", open.status === 200, JSON.stringify(open.body));
  const order = open.body.order;

  const expectedMargin = (order.openPrice * 0.05) / 10;
  ok(
    "margin = notional / leverage",
    Math.abs(order.margin - expectedMargin) < 0.02,
    `margin ${order.margin} vs ${expectedMargin}`
  );
  ok(
    "liquidation = entry × 0.9 (1:10)",
    Math.abs(order.liquidation - order.openPrice * 0.9) < 0.01
  );

  const balAfterOpen = await balance(u.token);
  ok(
    "margin deducted exactly",
    Math.abs(bal0 - order.margin - balAfterOpen) < 0.005,
    `bal ${balAfterOpen}`
  );

  const list = await req("/trade/open", { token: u.token });
  const listed = list.body.trades?.find((t) => t.orderId === order.orderId);
  ok("open positions lists the order with volume", listed?.volume === 0.05);

  const close = await req("/trade/close", {
    method: "POST",
    token: u.token,
    body: { orderId: order.orderId },
  });
  ok("manual close succeeds", close.status === 200, JSON.stringify(close.body));

  const balAfterClose = await balance(u.token);
  const expected = balAfterOpen + order.margin + close.body.pnl;
  ok(
    "balance = margin returned + reported pnl (exact)",
    Math.abs(balAfterClose - expected) < 0.005,
    `bal ${balAfterClose} vs ${expected}`
  );

  const dupClose = await req("/trade/close", {
    method: "POST",
    token: u.token,
    body: { orderId: order.orderId },
  });
  ok("double-close rejected (idempotent ledger)", dupClose.status === 400);

  const hist = await req("/trade", { token: u.token });
  ok(
    "closed order in history with reason=manual",
    hist.body.trades?.some((t) => t.orderId === order.orderId && t.closeReason === "manual")
  );
}

async function testModifyAndPartialClose() {
  section("modify position & partial close");

  const u = await newUser("modify");
  const px = await probePrice(u.token, "BTC");

  const open = await req("/trade", {
    method: "POST",
    token: u.token,
    body: { asset: "BTC", type: "buy", volume: 0.1, leverage: 20 },
  });
  ok("position opens", open.status === 200, JSON.stringify(open.body));
  const orderId = open.body.order.orderId;

  // set TP/SL on the running position
  const tp = Math.round(px * 1.05 * 100) / 100;
  const sl = Math.round(px * 0.95 * 100) / 100;
  const mod = await req("/trade/modify", {
    method: "POST",
    token: u.token,
    body: { orderId, takeprofit: tp, stoploss: sl },
  });
  ok("modify sets TP and SL", mod.status === 200, JSON.stringify(mod.body));

  let list = await req("/trade/open", { token: u.token });
  let o = list.body.trades.find((t) => t.orderId === orderId);
  ok("TP visible on open order", Math.abs(o?.takeProfit - tp) < 0.01, `got ${o?.takeProfit}`);
  ok("SL visible on open order", Math.abs(o?.stopLoss - sl) < 0.01, `got ${o?.stopLoss}`);

  // instant-trigger levels must be rejected
  const badMod = await req("/trade/modify", {
    method: "POST",
    token: u.token,
    body: { orderId, takeprofit: px * 0.5 },
  });
  ok("modify rejects TP below current price (buy)", badMod.status === 400);

  // clearing levels
  const clear = await req("/trade/modify", {
    method: "POST",
    token: u.token,
    body: { orderId, takeprofit: null, stoploss: null },
  });
  ok("modify clears TP/SL", clear.status === 200);
  list = await req("/trade/open", { token: u.token });
  o = list.body.trades.find((t) => t.orderId === orderId);
  ok("levels cleared", o?.takeProfit === null && o?.stopLoss === null);

  // foreign modify must be invisible
  const mallory = await newUser("mallory-mod");
  const steal = await req("/trade/modify", {
    method: "POST",
    token: mallory.token,
    body: { orderId, stoploss: px * 0.9 },
  });
  ok("foreign modify rejected", steal.status === 400 && steal.body.msg === "order-not-found");

  // partial close: 0.04 of 0.10 lots
  const balBefore = await balance(u.token);
  const marginBefore = o.margin;
  const part = await req("/trade/close", {
    method: "POST",
    token: u.token,
    body: { orderId, volume: 0.04 },
  });
  ok("partial close succeeds", part.status === 200 && part.body.partial === true, JSON.stringify(part.body));
  ok("remaining volume reported", Math.abs(part.body.remainingVolume - 0.06) < 0.001);

  list = await req("/trade/open", { token: u.token });
  o = list.body.trades.find((t) => t.orderId === orderId);
  ok("open order shrank to 0.06 lots", Math.abs(o?.volume - 0.06) < 0.001, `got ${o?.volume}`);

  const balAfter = await balance(u.token);
  const releasedMargin = marginBefore - o.margin;
  const expected = balBefore + releasedMargin + part.body.pnl;
  ok(
    "partial close ledger exact (released margin + pnl)",
    Math.abs(balAfter - expected) < 0.005,
    `bal ${balAfter} vs ${expected}`
  );

  const hist = await req("/trade", { token: u.token });
  ok(
    "partial close recorded in history",
    hist.body.trades.some((t) => Math.abs(t.volume - 0.04) < 0.001 && t.closeReason === "manual")
  );

  // close the rest
  const rest = await req("/trade/close", {
    method: "POST",
    token: u.token,
    body: { orderId },
  });
  ok("remainder closes fully", rest.status === 200 && rest.body.partial === false);
}

async function testConcurrency() {
  section("concurrency: parallel placements race the balance guard");

  const u = await newUser("race");
  const px = await probePrice(u.token, "ETH");
  const bal0 = await balance(u.token);

  // pick a volume whose margin is ~$900 at 1:5, so ~5 of 10 can fit
  const volume = Math.round(((900 * 5) / px) * 100) / 100;

  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      req("/trade", {
        method: "POST",
        token: u.token,
        body: { asset: "ETH", type: "buy", volume, leverage: 5 },
      })
    )
  );

  const opened = results.filter((r) => r.status === 200);
  const rejected = results.filter(
    (r) =>
      r.status === 400 &&
      ["insufficient-balance", "insufficient balance"].includes(r.body.msg)
  );

  const marginEach = opened[0]?.body.order.margin ?? Infinity;
  const maxAffordable = Math.floor(bal0 / marginEach);

  ok(
    `exactly ${maxAffordable} of 10 opened`,
    opened.length === maxAffordable,
    `opened ${opened.length}, margin each ${marginEach}`
  );
  ok("the rest rejected as insufficient balance", rejected.length === 10 - opened.length);

  const bal1 = await balance(u.token);
  const totalMargin = opened.reduce((a, r) => a + r.body.order.margin, 0);
  ok(
    "not a cent over-deducted",
    Math.abs(bal0 - totalMargin - bal1) < 0.005,
    `bal ${bal1}`
  );

  const list = await req("/trade/open", { token: u.token });
  const closes = await Promise.all(
    list.body.trades.map((t) =>
      req("/trade/close", { method: "POST", token: u.token, body: { orderId: t.orderId } })
    )
  );
  ok("all concurrent closes succeed", closes.every((c) => c.status === 200));

  const after = await req("/trade/open", { token: u.token });
  ok("book is flat afterwards", after.body.trades.length === 0);
}

async function testOwnership() {
  section("security: cross-user access");

  const alice = await newUser("alice");
  const mallory = await newUser("mallory");
  await probePrice(alice.token, "SOL");

  const open = await req("/trade", {
    method: "POST",
    token: alice.token,
    body: { asset: "SOL", type: "buy", volume: 5, leverage: 5 },
  });
  const orderId = open.body.order.orderId;

  const steal = await req("/trade/close", {
    method: "POST",
    token: mallory.token,
    body: { orderId },
  });
  ok(
    "foreign close rejected without existence oracle",
    steal.status === 400 && steal.body.msg === "order-not-found"
  );

  const malloryBal = await balance(mallory.token);
  ok("attacker balance untouched", malloryBal === 5000, `bal ${malloryBal}`);

  const own = await req("/trade/close", {
    method: "POST",
    token: alice.token,
    body: { orderId },
  });
  ok("owner can still close", own.status === 200);
}

async function testTriggers() {
  section("server-side triggers: TP / SL / liquidation (synthetic ticks)");

  // --- take profit on a long
  const u1 = await newUser("tp");
  const p1 = await probePrice(u1.token, "SOL");
  const tpOpen = await req("/trade", {
    method: "POST",
    token: u1.token,
    body: { asset: "SOL", type: "buy", volume: 10, leverage: 10, takeprofit: Math.round(p1 * 1.5) },
  });
  ok("TP order opens", tpOpen.status === 200, JSON.stringify(tpOpen.body));
  injectTick("SOL", p1 * 1.51, p1 * 1.512);
  await sleep(1500);
  let hist = await req("/trade", { token: u1.token });
  const closedTp = hist.body.trades.find((t) => t.orderId === tpOpen.body.order.orderId);
  ok("closes as take_profit", closedTp?.closeReason === "take_profit", `got ${closedTp?.closeReason}`);
  ok("TP pnl positive", closedTp?.pnl > 0);

  // --- stop loss on a short: trigger tick must sit BETWEEN stop and
  // liquidation, otherwise liquidation correctly wins
  const u2 = await newUser("sl");
  const p2 = await probePrice(u2.token, "SOL");
  const slPrice = Math.round(p2 * 1.02 * 1000) / 1000;
  const slOpen = await req("/trade", {
    method: "POST",
    token: u2.token,
    body: { asset: "SOL", type: "sell", volume: 10, leverage: 10, stoploss: slPrice },
  });
  ok("SL order opens", slOpen.status === 200, JSON.stringify(slOpen.body));
  injectTick("SOL", p2 * 1.03, p2 * 1.031);
  await sleep(1500);
  hist = await req("/trade", { token: u2.token });
  const closedSl = hist.body.trades.find((t) => t.orderId === slOpen.body.order.orderId);
  ok("closes as stop_loss", closedSl?.closeReason === "stop_loss", `got ${closedSl?.closeReason}`);
  ok("SL pnl negative but bounded", closedSl?.pnl < 0 && closedSl?.pnl >= -slOpen.body.order.margin);

  // --- liquidation with pnl clamped at -margin
  const u3 = await newUser("liq");
  await probePrice(u3.token, "SOL");
  const entry = await req("/trade", {
    method: "POST",
    token: u3.token,
    body: { asset: "SOL", type: "buy", volume: 10, leverage: 100 },
  });
  ok("1:100 order opens", entry.status === 200, JSON.stringify(entry.body));
  const liqPrice = entry.body.order.liquidation;
  const margin = entry.body.order.margin;
  injectTick("SOL", liqPrice * 0.97, liqPrice * 0.971); // gap through liquidation
  await sleep(1500);
  hist = await req("/trade", { token: u3.token });
  const liq = hist.body.trades.find((t) => t.orderId === entry.body.order.orderId);
  ok("closes as liquidation", liq?.closeReason === "liquidation", `got ${liq?.closeReason}`);
  ok(
    "pnl clamped at exactly -margin (gap-through)",
    Math.abs(liq?.pnl + margin) < 0.005,
    `pnl ${liq?.pnl} vs margin ${margin}`
  );
}

async function testEngineResilience() {
  section("engine resilience: garbage & expired commands");

  const u = await newUser("resil");
  await probePrice(u.token, "BTC");
  const bal0 = await balance(u.token);

  injectRaw("this is not json");
  injectRaw(JSON.stringify({ kind: "price-update", payload: { symbol: "BTC", askPrice: "NaN" } }));
  injectRaw(JSON.stringify({ id: "x", request: { kind: "self-destruct", payload: {} } }));
  await sleep(500);

  const alive = await req("/trade", {
    method: "POST",
    token: u.token,
    body: { asset: "BTC", type: "buy", volume: 0.01, leverage: 100 },
  });
  ok("engine still serves trades after garbage input", alive.status === 200);
  await req("/trade/close", { method: "POST", token: u.token, body: { orderId: alive.body.order.orderId } });

  // a stale command (older than COMMAND_TTL) must be refused, not executed
  const staleId = randomUUID();
  injectRaw(
    JSON.stringify({
      id: staleId,
      request: {
        kind: "place-trade",
        payload: {
          orderId: staleId,
          userId: u.userId,
          asset: "BTC",
          type: "buy",
          volume: 100, // 1 lot
          leverage: 10,
          timestamp: Date.now() - 60_000,
        },
      },
    })
  );
  await sleep(1000);
  const openAfter = await req("/trade/open", { token: u.token });
  ok(
    "expired command NOT executed",
    !openAfter.body.trades.some((t) => t.orderId === staleId)
  );
  const bal1 = await balance(u.token);
  ok("no money moved by expired command", Math.abs(bal1 - bal0) < 0.5, `bal ${bal0} → ${bal1}`);
}

async function testRateLimit() {
  section("rate limiting");

  const results = [];
  for (let i = 0; i < 25; i++) {
    results.push(
      await req("/auth/signin", {
        method: "POST",
        body: { email: `nobody-${i}@x.com`, password: "password123" },
      })
    );
  }
  ok("auth brute force throttled with 429", results.some((r) => r.status === 429));
}

// ---------------------------------------------------------------------- main

const started = Date.now();
console.log(`CFD platform e2e suite → ${API}`);

try {
  const u = await testHealthAndAuth();
  await testValidation(u);
  await testTradeLifecycle();
  await testModifyAndPartialClose();
  await testConcurrency();
  await testOwnership();
  await testTriggers();
  await testEngineResilience();
  await testRateLimit();
} catch (err) {
  failed++;
  failures.push(`suite aborted: ${err.message}`);
  console.error("\nSuite aborted:", err);
}

console.log(`\n${"─".repeat(50)}`);
console.log(`${passed} passed, ${failed} failed  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
if (failures.length) {
  console.log("Failures:");
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(failed ? 1 : 0);

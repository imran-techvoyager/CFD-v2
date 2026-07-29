# CFD-v2 — Paper-Money CFD Trading Platform

An Exness-style CFD trading platform. Every new account gets **$5,000 paper money** and can trade **BTC, ETH and SOL** against live crypto markets in **lots** with dynamic leverage (1:1–1:400), take-profit, stop-loss, position modify, partial close and automatic liquidation — with draggable TP/SL lines right on the chart.

## Architecture

```
Binance WS ──> price_poller ──┬──> Redis pub/sub ──> websocket_server ──> browser (live prices, order events)
                              └──> Redis stream "engine-stream" ──> engine (single-threaded matching/risk)
browser ──> web (Next.js :3000) ──> backend (Express :4000) ──> engine-stream ──> engine
                                             ^                                      │
                                             └───── "callback-queue" stream ────────┘
engine ──> Postgres (OpenOrders / ClosedOrders / balances / snapshots)
```

| App | Port | Role |
|---|---|---|
| `apps/web` | 3000 | Next.js trading terminal (chart, watchlist, order panel, positions) |
| `apps/backend` | 4000 | REST API: auth, trades, candles (Binance klines proxy) |
| `apps/websocket_server` | 8080 | Fans out live prices + per-user order events (JWT auth) |
| `apps/price_poller` | — | Binance aggTrade → internal bid/ask ticks (5 bps spread, 100ms throttle) |
| `apps/engine` | — | Consumes engine-stream; opens/closes/liquidates positions |

### Units (internal)
- **Prices**: integers scaled by `1e4` (e.g. $61,428.5033 → `614285033`)
- **Money** (balance, margin, pnl): integer **cents**
- The REST API speaks decimal USD; the backend converts at the boundary.

### Crash recovery / exactly-once
- Opening a trade atomically (one DB transaction) deducts margin **and** inserts an `OpenOrders` row keyed by a unique `orderId`. Closing atomically inserts `ClosedOrders`, deletes the `OpenOrders` row and credits margin+pnl.
- The engine snapshots its stream cursor every 30s. On restart it reloads open orders from the DB and replays the stream from the cursor — replayed commands are no-ops thanks to the unique `orderId` constraints, so balances can never double-deduct/credit.
- PnL is clamped at `-margin` (gap protection); liquidation price = entry × (1 ∓ 1/leverage).

## Running locally

Requirements: Node 20+ (uses `--env-file`), pnpm, Docker.

```sh
# 1. infra (Postgres :5433, Redis :6379)
docker compose up -d

# 2. deps + env
pnpm install
cp .env.example .env    # already has working local defaults

# 3. database
cd packages/db && pnpm db:deploy && pnpm db:generate && cd ../..

# 4. everything (turbo runs all dev scripts)
pnpm dev
```

Or start services individually with `pnpm start` inside each `apps/*` directory.

Open http://localhost:3000, sign up, and trade.

## API quick reference

```
POST /api/v1/auth/signup   {email, password}            → token + $5,000 account
POST /api/v1/auth/signin   {email, password}            → token
GET  /api/v1/auth/me                                    → {email, balance}
POST /api/v1/trade         {asset, type, volume (lots), leverage, takeprofit?, stoploss?}
POST /api/v1/trade/close   {orderId, volume?}        # volume < position = partial close
POST /api/v1/trade/modify  {orderId, takeprofit?|null, stoploss?|null}
GET  /api/v1/trade/open                                 → live positions
GET  /api/v1/trade                                      → closed trade history
GET  /api/v1/candles?asset=BTC&ts=1m&limit=500          → OHLCV (Binance)
```

All prices in decimal USD. `asset ∈ {BTC, ETH, SOL}`, `leverage ∈ {1,5,10,20,50,100,200,400}`.

## Engineering notes

- **Single-writer engine**: one event loop owns all mutable state (LMAX-style) — no locks, no races by construction. Measured handling latency ≈ **85µs avg / <200µs max** per message.
- **Typed wire contracts**: every cross-process message (`@repo/shared`) is a zod schema shared by producer and consumer; consumers validate at the boundary, so a malformed producer can never half-execute.
- **Hot-path indexing**: orders are indexed per symbol, so a tick only visits orders on that symbol.
- **Command TTL**: commands older than 15s are refused — a request whose HTTP caller already timed out can't open exposure late.
- **Stale-price guard**: opens are refused if the newest tick is >10s old (feed outage); closes stay allowed.
- **Race-safe ledger**: margin is deducted with a conditional `UPDATE … WHERE balance >= margin` inside the same transaction that creates the order row — proven by the e2e concurrency test (10 parallel orders, never a cent over-deducted).
- **Rate limiting** on credential endpoints; graceful drain on SIGTERM everywhere.

## Testing

```sh
pnpm e2e   # requires the full stack running
```

58 assertions: auth, validation, full trade lifecycle with exact balance math,
position modify + partial close (exact ledger), parallel-placement races, cross-user security, TP/SL/liquidation via synthetic
ticks (including gap-through-liquidation pnl clamping), malformed-message
resilience, expired-command refusal, and rate limiting. Crash recovery is
verified by `kill -9`-ing the engine with open positions and restarting.

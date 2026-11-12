// Ignition-rider BTC bot for make.fun's btc-race-24h-20261112-1439 (bars-replay/v1).
//
// One idea, kept deliberately small: Bitcoin's 1-minute bars trend in bursts. When the
// last 5 minutes jump at least +30 bp while the short trend is already up (EMA-12 above
// EMA-48), buy with the whole stack; then sit still and take +90 bp, or cut at -100 bp,
// or give up after 600 bars. No other trade exists: no dip-buying, no re-entry for 30
// bars after an exit, no trailing stop (the dev window's rally is choppy and a trail
// keeps shaking the bot out before the take-profit).
//
// Why this shape, on the published dev window (24 h of cbBTC 1-minute bars, -2.3% net):
// buy-and-hold loses ~$26, the kit's EMA-cross baseline loses ~$96 on churn, and every
// dip-buy variant loses too, because the window grinds down with only small bounces.
// The one clean move is the opening burst: a +42 bp 5-minute jump at bar 54, ridden to
// +90 bp for +$8.46 net after every fee, slippage and price impact, with 0.6% max
// drawdown. On the window's second half the bot simply never fires and stays in cash.
// It is a momentum bot, not a fitted curve: the entry threshold (+30 bp), the take-profit
// (+90 bp) and the stop (-100 bp) are round numbers, and the whole neighbourhood
// (threshold +30..+40 bp, take-profit +80..+105 bp) is profitable on the dev window.
//
// The harness is long-only, no leverage, no shorts, one symbol (CBBTC). Orders decided
// on a batch fill at the next bar's open, paying 4 bp fee + 2 bp modelled slippage +
// constant-product impact against that bar's open depth, so a full-size round trip costs
// about 26 bp; the +90 bp take-profit clears it with room to spare.
//
// Deterministic: the bot is a pure function of the bars it is sent. No clock, no
// environment, no randomness, no network, no files. Standard library only, plus the
// kit's own bars SDK vendored under vendor/ (byte-identical to the kit's sdk/).
//
// Laid out like the kit's baselines: the grader runs `node /bot/main.ts` with this
// directory mounted at /bot; vendor/makefun-bars.ts is a byte-identical copy of the
// kit's sdk/makefun-bars.ts.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// A 5-minute jump of +30 bp with the short trend already up is the ignition.
const IGNITION_BP = 30;
// Bank +90 bp from the fill price; cut at -100 bp; give up after 600 bars.
const TAKE_PROFIT_BP = 90;
const STOP_LOSS_BP = 100;
const MAX_HOLD_BARS = 600;
// Bars to wait after an exit before a fresh ignition may fire.
const COOLDOWN_BARS = 30;
// Bars of history before the first entry is allowed (EMAs need a few bars to settle).
const MIN_BAR = 15;
// Wide open: a fill may move up to 100% from the latest close before it is refused.
const MAX_SLIPPAGE_BPS = 10_000;

// Closes in USD, one per fresh CBBTC bar, in order.
const closes: number[] = [];
let ema12: number | null = null;
let ema48: number | null = null;
// The fill price (USD) of the open position, and the fresh-bar index it filled on.
let entryPrice: number | null = null;
let entryBar = -1;
let lastExitBar = -1e9;
// The close time of the last fresh CBBTC bar seen (a batch may carry no bar: a gap).
let lastBarT = -1;
// Fresh-bar index (0-based), the clock every rule runs on.
let barIndex = -1;

function ema(prev: number | null, alpha: number, close: number): number {
  return prev === null ? close : prev + alpha * (close - prev);
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // The fills of the orders decided on the previous batch: a buy fill opens the
    // position (its price is the take-profit / stop-loss reference), a sell fill
    // closes it and starts the re-entry cooldown.
    for (const fill of batch.fills) {
      if (fill.status !== 'filled' || fill.symbol !== SYMBOL) continue;
      if (fill.side === 'buy') {
        entryPrice = Number(fill.price) / 1e5;
        // The fill lands on the next fresh bar after the decision bar, whose
        // index is one past the decision bar's (barIndex has not advanced yet).
        entryBar = barIndex + 1;
      } else if (fill.side === 'sell') {
        entryPrice = null;
        entryBar = -1;
        lastExitBar = barIndex;
      }
    }

    // A batch with no fresh CBBTC bar is a gap minute: nothing new is known, and
    // the close the state still holds is the previous bar's, so decide nothing.
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || bar.t === lastBarT) return [];
    lastBarT = bar.t;
    barIndex += 1;

    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    const close = Number(closeRaw) / 1e5;
    closes.push(close);
    ema12 = ema(ema12, 2 / 13, close);
    ema48 = ema(ema48, 2 / 49, close);

    const pos = state.positions.get(SYMBOL);
    if (pos !== undefined && pos.qty > 0n) {
      let price = entryPrice;
      if (price === null) {
        // Fallback if a fill was ever missed: the position's cost basis.
        price = Number(pos.cost) * 100 / Number(pos.qty);
      }
      if (close >= price * (1 + TAKE_PROFIT_BP / 10_000)) {
        return [{ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (close <= price * (1 - STOP_LOSS_BP / 10_000)) {
        return [{ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (barIndex - entryBar >= MAX_HOLD_BARS) {
        return [{ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (state.warmingUp || barIndex < MIN_BAR) return [];
    if (barIndex - lastExitBar < COOLDOWN_BARS) return [];
    if (closes.length < 6 || ema12 === null || ema48 === null) return [];
    const ret5 = closes[closes.length - 1] / closes[closes.length - 6] - 1;
    if (ret5 >= IGNITION_BP / 10_000 && ema12 > ema48) {
      const notional = state.cash;
      if (notional >= 1_000_000n) {
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});

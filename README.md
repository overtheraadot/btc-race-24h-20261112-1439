# Ignition-rider BTC bot

[![make.fun · btc-race-24h-20261112-1439](https://make.fun/badge/btc-race-24h-20261112-1439.svg)](https://make.fun/bounty/btc-race-24h-20261112-1439?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439)

A momentum-ignition bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty ($250 in USDC). It trades Coinbase Wrapped BTC (cbBTC) on 1-minute on-chain bars, long only, $1,000 of paper money.

## The idea

Bitcoin's 1-minute bars trend in bursts. When the last 5 minutes jump at least **+30 bp** while the short trend is already up (EMA-12 above EMA-48), the bot buys with the whole stack, then takes **+90 bp**, cuts at **-100 bp**, or gives up after **600 bars**. That is the whole strategy: no dip-buying, no trailing stop (the dev window's rally is choppy and a trail shakes the bot out before the take-profit), no re-entry for 30 bars after an exit.

## Why this shape

On the published dev window (24 h, BTC -2.3% net): buy-and-hold loses ~$26, the kit's EMA-cross baseline loses ~$96 on churn, and every dip-buy variant loses too — the window grinds down with only small bounces. The one clean move is the opening burst, ridden to +90 bp for **+$8.46 net** after every fee, slippage and price impact, with 0.6% max drawdown. On the window's second half the bot simply never fires and stays in cash. The parameters are round numbers and the whole neighbourhood (ignition +30..+40 bp, take-profit +80..+105 bp) is profitable on the dev window.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout). No dependencies beyond Node 22, plus the kit's own bars SDK vendored under `vendor/` (byte-identical to the kit's `sdk/makefun-bars.ts`).

Grade it locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=8bg6hn2r&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439) · AI agents build software for cash rewards</sub>

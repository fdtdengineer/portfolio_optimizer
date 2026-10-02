# portfolio_optimizer

Browser-only Black–Litterman portfolio optimizer intended as a lightweight NISA research tool.

No Python, C#, backend server, build step, package manager, or external JavaScript library is required.

## Run

Open `index.html` directly in a modern browser.

1. Load a CSV of adjusted prices, or click **サンプルを使う**.
2. Set Black–Litterman / optimizer parameters.
3. Adjust the market-cap proxy weights used for the equilibrium return.
4. Add relative investor views.
5. Click **Optimize portfolio**.

## CSV format

The first column is treated as a date/label and the remaining columns as asset prices.

```csv
Date,All Country,S&P 500,NASDAQ 100,TOPIX,Gold
2026-01-05,100.0,100.0,100.0,100.0,100.0
2026-01-06,100.2,100.4,100.7,99.9,100.1
2026-01-07,100.1,100.5,100.4,100.3,100.6
```

The parser is intentionally simple; quoted fields containing commas are not supported.

## Model

From daily log returns, the app estimates the annualized covariance matrix `Σ`.

The implied equilibrium excess return is

```text
Π = δ Σ w_mkt
```

where:

- `δ` is the risk-aversion coefficient.
- `w_mkt` is the normalized user-specified market portfolio.

For views `P`, `Q`, and uncertainty matrix `Ω`, the Black–Litterman posterior mean is

```text
μ_BL = [ (τΣ)^-1 + P' Ω^-1 P ]^-1
       [ (τΣ)^-1 Π + P' Ω^-1 Q ]
```

Each UI view is a relative view of the form:

```text
Asset A - Asset B = q
```

The confidence slider maps to diagonal view uncertainty using:

```text
Ω_i = τ (p_i' Σ p_i) (1 - c_i) / c_i
```

This is a practical confidence-to-uncertainty mapping rather than a complete implementation of every Idzorek calibration variant.

## Optimization

The app solves the long-only mean-variance problem

```text
maximize  μ_BL' w - (λ / 2) w' Σ w

subject to
  sum(w) = 1
  0 <= w_i <= max_weight
```

with projected gradient ascent. Projection is performed onto the capped probability simplex by bisection.

## Current scope

Implemented:

- CSV price import
- Built-in deterministic synthetic sample
- Log-return covariance estimation
- Black–Litterman equilibrium prior
- Multiple relative views
- Confidence-weighted view uncertainty
- Long-only fully-invested optimization
- Per-asset maximum weight
- Expected return / volatility / Sharpe display
- Prior-vs-posterior table
- Allocation visualization
- Fully local browser execution

Not yet implemented:

- Automatic market-data download
- NISA product eligibility database
- Separate tsumitate / growth allocation limits
- Current holdings and contribution-aware rebalancing
- Transaction costs / taxes / FX hedging
- Robust covariance estimators
- Efficient-frontier sweep
- Absolute views
- Import/export of saved model settings

## Notes

This repository is a research / educational prototype, not investment advice. The browser performs all calculations locally; uploaded CSV data is not sent anywhere by this app.

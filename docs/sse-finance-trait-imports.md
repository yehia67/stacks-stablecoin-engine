# SSE Finance — trait imports note

SSE Finance is a **fresh, self-contained deployment**. It ships its own copies of
every trait it consumes, so no SSE Finance contract `use-trait`/`impl-trait`s an
externally-deployed trait contract.

## Trait set (deployed fresh in-package)

| Trait contract | Trait | Surface | Notes |
|---|---|---|---|
| `sse-finance-oracle-trait` | `sse-finance-oracle-trait` | `get-price () (response uint uint)` | USD price at 8-decimal PRICE-SCALE (`u100000000` = $1.00). Fresh copy of `oracle-trait`. |
| `sse-finance-sip-010-trait` | `sse-finance-sip-010-trait` | canonical SIP-010 (incl. `transfer` memo `(optional (buff 34))`) | **Plain SIP-010 — no mint/burn.** Borrow tokens are moved from the pool, never minted; collateral is custodied, never issued. |

## Which trait each new contract imports

| Contract | `impl-trait` | `use-trait` |
|---|---|---|
| `price-oracle-pegged-usd-v1` | `sse-finance-oracle-trait` | — |
| `sse-finance-market-registry-v1` *(later)* | — | `sse-finance-oracle-trait` (market oracle), `sse-finance-sip-010-trait` (borrow token) |
| `sse-finance-pool-v1` *(later)* | — | `sse-finance-sip-010-trait` (borrow token) |
| `sse-finance-vault-v1` *(later)* | — | `sse-finance-sip-010-trait` (collateral), `sse-finance-oracle-trait` (pricing) |
| `sse-finance-liquidation-v1` *(later)* | — | `sse-finance-sip-010-trait`, `sse-finance-oracle-trait` |

Rows marked *(later)* are placeholders for contracts in subsequent tasks; update
this table as each lands.

## Why fresh copies, not the existing SSE traits

The existing `oracle-trait` / `sip-010-trait` belong to the original SSE engine
deployment (and the repo references the **canonical** SIP-010 by external mainnet
principal `SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard`).
SSE Finance deploys clean with no dependency on either, so it redeclares both
under the `sse-finance-` namespace. The SIP-010 copy uses the canonical surface
(with the transfer memo) so real external stablecoins satisfy it as-is.

# frontend/AGENTS.md

<!-- bmad:context -->
<!-- Verified 2026-08-22 against 1dccf17. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## frontend/ (stacks-stablecoin-engine)

Next.js 13 (app router) + Stacks Connect wallet integration. Own `package.json`, separate toolchain from root contracts. Root/contract rules: `../AGENTS.md`.

## Running and verifying

- CI does not build, lint, or test this app — only root contracts (`clarinet check` + `npm test`). Verify locally: `npm run lint`, `tsc --noEmit`.
- Don't run `npm run build` while `next dev` is running — causes `ChunkLoadError`. Use `tsc --noEmit` for type-checking during development.

<!-- /bmad:context -->

## Frontend Standards

- Prefer contract-derived state over hardcoded protocol values.
- Use network/deployer/factory env config from constants.
- If transaction flow requires multiple calls, make the sequence explicit in UI copy.
- Reflect stablecoin symbol/name from on-chain registration data.
- **Never use silent fallback values (e.g. `|| "default"`) on decoded contract data.** If a required field is missing or has the wrong type after decoding, log the error with context (contract name, id, raw hex) and skip the entry. Fallbacks hide bugs and make on-chain data issues invisible to developers. Use `?? null` or `?? 0` only for legitimately optional fields.

### Token Decimal Handling (CRITICAL)

SSE deals with multiple tokens that have different decimal precisions (e.g. sBTC = 8 decimals, stablecoins = 6 decimals). Incorrect decimal handling silently produces catastrophically wrong values (e.g. letting users mint $2.6M stablecoins against $40K collateral). Follow these rules strictly:

1. **Two domains, never mix them.** All token math lives in one of two domains:
   - **Human-readable** — whole tokens as users see them (e.g. `0.5` BTC, `2000` EGPB, `$80,689` per BTC). Used for UI display, input fields, and preview calculations (health factor, max borrow).
   - **On-chain micro-units** — raw integers the smart contracts operate on (e.g. `50000000` satoshis, `2000000000` stablecoin micro-units). Used exclusively for contract call arguments.

   **Never multiply a value from one domain by a value from the other.** For example, `collateralUnits * oraclePriceHuman` mixes domains and produces a meaningless number.

2. **Preview/display math uses human-readable values only.**
   - Health factor: `calculateHealthFactor(collateralUsd, borrowHuman)`
   - Max borrow: `collateralUsd * 100 / minRatio`
   - Collateral USD value: `collateralHuman * oraclePricePerWholeToken`

   Oracle prices from `useDiaOraclePrices` are already in human-readable USD (raw price ÷ 1e8). Collateral amounts from user input are already human-readable.

3. **Convert to on-chain units only at the contract call boundary.**
   - Use `toSmallestUnits(humanAmount, decimals)` right before passing to contract functions.
   - Use `toHumanReadable(rawUnits, decimals)` or `formatTokenAmount(rawUnits, decimals)` immediately when reading contract data for display.
   - Percentage buttons that fill inputs from on-chain values (e.g. `debtShare`, `userDeposit`) must convert via `toHumanReadable()` before setting the input state.

4. **Never assume all tokens share the same decimal precision.** Always use `getCollateralDecimals(asset)` or `useTokenDecimals(contract)` — never hardcode `6` or `8`.

5. **Verify with a sanity check.** After writing any amount conversion, mentally trace a concrete example (e.g. 0.5 BTC at $80K, 150% ratio → max ~26,666 stablecoins). If the numbers are off by orders of magnitude, you mixed domains.

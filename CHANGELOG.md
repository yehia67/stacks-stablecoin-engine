# SSE Finance — Changelog

## M3 Submission Release Notes

### Infrastructure & Performance

**RPC Reliability & Failover**
- Added QuickNode as primary mainnet RPC provider with circuit breaker failover (#83)
- Implemented request coalescing and 15s TTL cache on RPC proxy to prevent Hiro rate-limit (429) errors (#79)
  - *Why:* Live usage exposed race conditions under concurrent requests; rate limiting blocked validator and user queries

**Caching Enhancements**
- Expanded caching layer across critical API paths (#73)
  - *Why:* Network latency from repeated oracle and vault state queries degraded user experience on portfolio pages

### Risk Management

**Depeg Circuit Breaker**
- Added depeg protection with per-market band and vault borrow guard to sse-finance-market-registry-v1 (#108)
  - *Why:* Live market activity revealed exposure to stablecoin depeg events; guard prevents borrowing against degraded collateral

**Liquidation & Stability**
- Implemented sse-finance-liquidation-v1 with permissionless trigger, pro-rata LP distribution, and protocol penalty split (#105)
- Added one-time borrow fee with netted disbursement and protocol/LP revenue split (#102)
  - *Why:* Fee mechanism and liquidation incentives ensure protocol solvency and LP protection under stress scenarios

### Financial Features

**Collateral & Lending**
- Expanded collateral support with EGPB (EGP Bond A) as third mainnet collateral with oracle integration (#77)
- Implemented borrow/repay with flat principal debt, one-time fee, and health/cap/floor guards (#104)
- Added vault lifecycle tracking with multi-asset collateral custody and health-checked withdrawal (#103)
  - *Why:* Live feedback from institutional users required diversified collateral options and fine-grained borrow controls

**Governance**
- Replaced single admin authority with multisig timelock governance for all SSE Finance admin functions (#107)
  - *Why:* Risk management requirement for institutional deployment; auditors required decentralized control

### Observability & User Experience

**Analytics & Feedback**
- Added mainnet activity report script with vault lifecycle tracking and external wallet analytics (#81)
  - *Why:* Required for grant reporting and operational transparency with integration partners

**UI Fixes & Precision**
- Fixed decimal conversion bugs in vault/pool percentage calculations (#64)
- Added per-token decimal precision support via formatTokenAmount refactor (#63)
  - *Why:* Live usage exposed rounding errors in multi-collateral scenarios causing user confusion

**User Dashboard**
- Implemented My Stablecoins page with comprehensive creator dashboard and multi-asset loan exposure tracking (#49)
  - *Why:* Users needed consolidated view of loans across collateral types; missing feature in M2

**Feedback Loop**
- Added soft launch feedback banner with persistent floating button and Google Apps Script webhook integration (#74)
  - *Why:* Direct user feedback loop accelerated bug discovery and feature prioritization

### Versioning & Standards

**Contract Versioning**
- Upgraded all contracts to v8 with native fungible tokens for post-condition support and cross-reference updates (#52, #75, #96)
  - *Why:* SIP-010 compliance required for institutional partners (VelumX, VoltFi integrations)

---

## Summary

All improvements were driven by live mainnet activity and partnership feedback:
- **Performance**: Rate limiting and network latency fixes
- **Risk**: Depeg guards, liquidation mechanics, governance decentralization
- **Coverage**: Third collateral type, multi-asset dashboards, enhanced analytics
- **Compliance**: Native fungible tokens, versioning standards, audit trail (Google Apps Script logging)

These changes maintain feature stability while expanding institutional-grade resilience and observability.

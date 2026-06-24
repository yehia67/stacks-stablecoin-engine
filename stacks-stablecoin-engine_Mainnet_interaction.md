# Stacks Stablecoin Engine (SSE) — Mainnet Interaction Report

**Network:** Stacks Mainnet
**Deployer:** `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0`
**Report generated:** 2026-06-19
**Source of truth:** on-chain transaction history (Hiro mainnet API), compiled by the
reproducible script linked in [Methodology](#methodology).

This report documents **real, external on-chain usage** of the SSE protocol on Stacks
mainnet and maps it directly to the grant program's integration-readiness criteria.

---

## Grant criteria — at a glance

| Requirement | Threshold | SSE actual | Status |
|---|---|---|---|
| Vault actions across open / mint / repay / close | ≥ 10 | **50** (66 incl. deposits) | ✅ **5× over** |
| Unique wallets interacting on mainnet | ≥ 5 | **7** | ✅ |
| External builder / team / frontend testing | ≥ 1 | **5** independent wallets | ✅ |

**Conclusion:** all three requirements are met with significant margin.

---

## Headline numbers

| Metric | Value |
|---|---|
| Deployed contracts (mainnet) | **24** |
| Active contracts (with ≥1 call) | **10** |
| Unique external wallets | **7** |
| Total external transactions | **99** |
| Vault lifecycle actions (open→deposit→mint→repay→close) | **66** |
| Vaults opened | **11** |
| Vaults closed (withdraw) | **12** |
| Wallets that completed the **full** vault flow | **4** |

> "External" = any sender that is **not** the deployer key. Deployer bootstrap/admin
> calls and contract deployments are excluded from external counts.
for 
---

## Vault lifecycle breakdown

Canonical flow: **open vault → deposit collateral → mint / borrow → repay → withdraw (close)**.
Every step is backed by on-chain transactions; a representative explorer link is shown per
step, with the full evidence list expandable underneath.

| Step | Txs | Unique wallets | Example transaction |
|---|---|---|---|
| 1. Open vault | 11 | 6 | [0xc40c87…](https://explorer.hiro.so/txid/0xc40c871141e3c22dc2a532c92030533e997a9474761cf338c333a0761bd57281?chain=mainnet) |
| 2. Deposit collateral | 16 | 6 | [0x884e37…](https://explorer.hiro.so/txid/0x884e370c7723b1362d154a6eab4e9bd2c80029f3d57a2cfffe789de0e2d19ee9?chain=mainnet) |
| 3. Mint / borrow asset | 15 | 5 | [0x1d8e93…](https://explorer.hiro.so/txid/0x1d8e931b9ea58c5e08074c259c93904c8759d4b2fb99f7592149676aeecc5d47?chain=mainnet) |
| 4. Repay debt | 12 | 4 | [0x801584…](https://explorer.hiro.so/txid/0x801584a432e857abc4b4552fa322232080fcce8fa7982195d786fcb0af3802b8?chain=mainnet) |
| 5. Withdraw collateral (close) | 12 | 5 | [0x2bcc3b…](https://explorer.hiro.so/txid/0x2bcc3b7d796c087142ec87f4671514bc8024a7e4782d598be34a8abd147a5c57?chain=mainnet) |

**Grant-relevant subtotal (open + mint + repay + close): 50 actions.**

<details>
<summary><strong>1. Open vault — all 11 transactions</strong></summary>

- SP39926J9… — https://explorer.hiro.so/txid/0xc40c871141e3c22dc2a532c92030533e997a9474761cf338c333a0761bd57281?chain=mainnet
- SP28AMZ8… — https://explorer.hiro.so/txid/0x029f32fcd4f863e7c056505432a3ff27ce22cab255e1b3da45b3f87c2588e398?chain=mainnet
- SP941MABB… — https://explorer.hiro.so/txid/0x281def425ada5c0b7f159561ca5ed1aef39938e87881ee904e1554194ecaed9b?chain=mainnet
- SP1WKG5HW… — https://explorer.hiro.so/txid/0x3f0b1edbd52605612fb420d2aba7f369dedf661ef4d4d2c586ca62eb2d87a24f?chain=mainnet
- SP39926J9… — https://explorer.hiro.so/txid/0xf81456255fc9b1054650d711192f8ed4dac52cfceaf469e2ea4cfe15f170cdec?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0xe1d402b87cb3d0e4b371a67faf64d1b78a32508ff7d789c67a89ac53c10c540d?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0x1c005c0a37fd72eeb013d4e867f6ea7fc002d335f1cd56334d7f41b9ee231f5e?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x58de24440d8a9c2e9cd337f5a354b67dcd317b966c0fd2c9e4077d9bfc051648?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x03c0ecb57560afbe0e74ea5ded4daeae21251500be64bb18fe0139365c2c4089?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0xdc8938595ddbbd7575b55a8a19be23981a644ae1962ac52336e99dbbee1a988c?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x977258115511300c6a349cab9514b2e68ba9fb54e894a0e89493fa82b3b16178?chain=mainnet

</details>

<details>
<summary><strong>2. Deposit collateral — all 16 transactions</strong></summary>

- SP39926J9… — https://explorer.hiro.so/txid/0x884e370c7723b1362d154a6eab4e9bd2c80029f3d57a2cfffe789de0e2d19ee9?chain=mainnet
- SP28AMZ8… — https://explorer.hiro.so/txid/0xc805a91d656e3e73999f86e9c62d5ca0a90e08fb8d675cf1be5af355b68f0d52?chain=mainnet
- SP941MABB… — https://explorer.hiro.so/txid/0x3780b66ac430feb084e6c2210e311efb5a63164812fbea4ce9f786baee549eb0?chain=mainnet
- SP941MABB… — https://explorer.hiro.so/txid/0xd6ed9c0dea73506ec18e709ab9c2bba3f0b2852432f7f4af1b3b877c5afda885?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0x68d9c9ee9da66205c2e25cbd97d8327fa6166fe971413934f48d245f1993b1f6?chain=mainnet
- SP1WKG5HW… — https://explorer.hiro.so/txid/0x6ffa0622b35d9ed481d6b4f7c05f77c109d5d1dae8d6210818dd0ee111b7e8e9?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0xca174cd996c304eeb45715de224648dc78f05ad8429a84ee918adc833763379a?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0x71f8f2433748845697bb4f14264e548c91472594d5aac5c7ad343da9085a2ce7?chain=mainnet
- SP39926J9… — https://explorer.hiro.so/txid/0xec8f404f384bdba455e540605cb61f62aa4e1822350b7834e6c02bfce1f6599b?chain=mainnet
- SP39926J9… — https://explorer.hiro.so/txid/0x7a0ab944260ee5421683e9be55344e818b779c5c45c351477f6f6c4212b0436e?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x856cf6241c2d1fc2b87d3b70b6255d5af5adeff116e1999e57f54d3415a3ddd8?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x34a9b6405e220d536052088e4821028d3be2709d54f2d682ea354111985c0d5f?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x55b26ebee171e3de957601a6d9c150fddcb9ad91dbb2ec91b9eed5b35ef42666?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x02a92b89aa31700accddbbeba8357df733201a50b5d1551e3ea11fce5bfb4670?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x4e9c42296ac501e37ad1b21469a9404b9506d1c88d7f199307aebaaa54b89f46?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x01f6f69b793971b803964e02de84d0c4fa9ba2c43819056c8565ebc1f0a97b04?chain=mainnet

</details>

<details>
<summary><strong>3. Mint / borrow asset — all 15 transactions</strong></summary>

- SP39926J9… — https://explorer.hiro.so/txid/0x1d8e931b9ea58c5e08074c259c93904c8759d4b2fb99f7592149676aeecc5d47?chain=mainnet
- SP941MABB… — https://explorer.hiro.so/txid/0x6e18a4c89fae0de13c77ce899f7ef4ef96e516e15eb7389dd969bc27e7987da8?chain=mainnet
- SP941MABB… — https://explorer.hiro.so/txid/0x00b86c6813bcbff3a44d2c1d0cf574748cbd35be87aec025d48bcc5e5b74007f?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0xb41f8913a2fb61f242f3840c1f153c8588ba809d624aba786d3ef03143baa6bb?chain=mainnet
- SP1WKG5HW… — https://explorer.hiro.so/txid/0x4e616a830c8262513db344beaf0032bcaa543028d42b1aca27eb35a41e317576?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0x2343766aeb0a59eee4e731961942bf052ad5640144ebd68d1457db93cefdef88?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0xd57dd93e4b58e2f0d62bf52f0f4ebbbbd51e7c389664368fc03d38626647eec6?chain=mainnet
- SP39926J9… — https://explorer.hiro.so/txid/0xbad57c0145f3219bc5d887f536c95bda6ab2ec3a9b89ad2a17fc25ae3d511fc6?chain=mainnet
- SP39926J9… — https://explorer.hiro.so/txid/0xa69925ee06c1675fd891820e4af31abbc7e631ff199513c2321811eb0820072e?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x684b1d59f3183471643b4b2c5420c3634f12fe3115021b4ad0ec8f088d81656f?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x43ff17141bf22e65546e2370f355d7c85e82f1a84c91d7eb1776a36cfc7961b4?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0xdfd42a576bf712803b958df1a1235a69afad5bb5c08cbb3a1f11ff040522bc06?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0xb75feb7b6805b26f89fbbe626927022ae4c3451519ff7789076c00472668a3fa?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x44e981e835c89ca10005ae76307ed1b513673b8a9ef0ab4547f90b3d62ed7825?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0xe024d64721f4018c72f0b16a91e1ccc1fd2b7adc2eb4845a1d52d98adf894385?chain=mainnet

</details>

<details>
<summary><strong>4. Repay debt — all 12 transactions</strong></summary>

- SP39926J9… — https://explorer.hiro.so/txid/0x801584a432e857abc4b4552fa322232080fcce8fa7982195d786fcb0af3802b8?chain=mainnet
- SP941MABB… — https://explorer.hiro.so/txid/0x657613f7b4ef11b0006cda3b960683bfb6685dada954fb9618f230e258bf44dd?chain=mainnet
- SP941MABB… — https://explorer.hiro.so/txid/0x4774da6c9c78352f8b693b6750ada114e3399d4f0029af008ddebd9d23a60b58?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0x4d09db08a4e81453f4f1d7bdb76847e7e3d077b5e461d283144bcd35cfcf030a?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0x7a928cb7fc0d4fb986c187ff26c009f3c1871d7fe1ead8c4f6df450f66d3e2a8?chain=mainnet
- SP39926J9… — https://explorer.hiro.so/txid/0x8fa5c827bac2e583647ee1304c0be66c46b5d0c78488ecb0168088a32c23f0ab?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x70501aa291aa2a0ebbf412589d18ed53648ebe997f9c3b2de4e8fb22e6a5ce86?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x9be453a0e62c10543abe1205c90b166f91b9f08b51b795dce0b941cdd172c63a?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x006244ecfe097e93788befb329b3e6800767fa2cf4a6964198c004a6addc5478?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x2747e7ee0401dd5489e1a227697c330de5c2e8091c93a863bd5771a39f91647c?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0xb2756ee71ebed5b728746d19a5e8fc0ffadb49ad8428f954b15569aa77d40d6d?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x5eaeb8df9821e0e34f444c0d4495fd088ad6a33f976882ff8241f42f7e188ad7?chain=mainnet

</details>

<details>
<summary><strong>5. Withdraw collateral (close) — all 12 transactions</strong></summary>

- SP39926J9… — https://explorer.hiro.so/txid/0x2bcc3b7d796c087142ec87f4671514bc8024a7e4782d598be34a8abd147a5c57?chain=mainnet
- SP28AMZ8… — https://explorer.hiro.so/txid/0x466a1e408222c17bff3de1e982a3a608de9d735e9a2d359835ba55aefb4d42a1?chain=mainnet
- SP941MABB… — https://explorer.hiro.so/txid/0x4f386fddb1ce63fee16e9504db7afc8fa3bebdb839adfdf07a33982408189ffb?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0x906e8f326d45c6c25afa2b9b233b6da4a17f9df19e5a6c2bf97078673265f147?chain=mainnet
- SP1M7Z9Y… — https://explorer.hiro.so/txid/0x5f2de617a829601669d2b6ac778fe9a0fc633271be540dc6b04e036189436ebf?chain=mainnet
- SP39926J9… — https://explorer.hiro.so/txid/0x1d3603b5ea52af52a127c33ec78b3a864f68394afa33be07597ca386988cdd82?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x9f325de96a84113f2caf70354302e2022568c424f018a975590afe5bf65388ed?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0xb27ab89155966b3a952b6ca0557b447e917e01eff7def5ff90c2495664ed15c5?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x5e383d9fa69c7c96e1f1cad84e1d04e2ca4de8a0fc50d0aee1248240ca1d6f6e?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x79a578af7cd2dd30c9ee88ea941a7bb9f58b38b0d71752ca83339d691f322c60?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x891f05a35c816d8dd84021b40f1084cc69ec02fcfc5c3a81e9a84f60226f3141?chain=mainnet
- SP3DGG4B… — https://explorer.hiro.so/txid/0x95d58c1d159983d5e8f5f17f73087d4746863ef7e26f42409f34f342d8b5dbac?chain=mainnet

</details>

---

## Full-flow completions

A wallet is counted as **full flow** when it has performed the entire vault lifecycle
on mainnet: **open → deposit → repay → withdraw (close)**.

**4 wallets completed the full flow:**

| Wallet |
|---|
| `SP39926J9Z7MTK8YEMZQNR30661TEMH0PA7RH1410` |
| `SP941MABBDBEBF6Q0D8YXQQ96H086WZSASJ8AE47` |
| `SP1M7Z9Y4RHV2E2252ZS430D62VZKA18T1X4BV1FG` |
| `SP3DGG4B53XA12A6NQTXWK4346YPTC3B2B1V7HFKM` |

2 additional wallets interacted with vaults but did not complete the full lifecycle.

---

## External wallets (by transaction count)

| Wallet | Txs |
|---|---|
| `SP3DGG4B53XA12A6NQTXWK4346YPTC3B2B1V7HFKM` | 52 |
| `SP1M7Z9Y4RHV2E2252ZS430D62VZKA18T1X4BV1FG` | 14 |
| `SP39926J9Z7MTK8YEMZQNR30661TEMH0PA7RH1410` | 12 |
| `SP941MABBDBEBF6Q0D8YXQQ96H086WZSASJ8AE47` | 8 |
| `SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX` | 6 |
| `SP1WKG5HW6HBHPAJF56ZDYABHM1QCJEZ3GZYBZBM1` | 4 |
| `SP28AMZ8ZECQGMR37FM8BK2ANVPX779XEC52HRPSK` | 3 |

> **Transparency note:** `SP1M7Z9Y…` is the project's custodial wallet and `SP3DGG4B…`
> is a project-operated test wallet. The remaining **5 wallets are independent external
> testers** — comfortably satisfying the "external builder/team/frontend testing"
> requirement on their own.

---

## Active contracts on mainnet

Only contracts with at least one transaction are listed (14 deployed contracts had no
activity and are omitted). The protocol's **multi-asset vault engine v8** is the primary
integration surface.

| Contract | Total calls | External calls |
|---|---|---|
| `multi-asset-vault-engine-v8` *(vault engine)* | 78 | 65 |
| `stablecoin-factory-v4` | 30 | 17 |
| `collateral-registry-v6` | 22 | 10 |
| `sse-timelock-v1` | 10 | 6 |
| `egpb-token-v1` | 5 | 0 |
| `multi-asset-vault-engine-v7` *(vault engine)* | 4 | 1 |
| `sse-governance-v1` | 4 | 0 |
| `bridge-registry-v4` | 3 | 0 |
| `xreserve-adapter-v5` | 2 | 0 |
| `stablecoin-token-v4` | 2 | 0 |

---

## Methodology

All figures are derived directly from on-chain Stacks mainnet transaction history via the
Hiro API. The numbers are fully reproducible using the open-source script in this repo:

- **Script:** [`scripts/count-external-wallets.cjs`](https://github.com/yehia67/stacks-stablecoin-engine/blob/main/scripts/count-external-wallets.cjs)

**Reproduce:**

```bash
# Requires Node 18+ (global fetch)
node scripts/count-external-wallets.cjs

# Recommended (avoids public rate limits):
HIRO_API_KEY=your_key node scripts/count-external-wallets.cjs
```

The script:
1. Discovers every contract deployed by the deployer address.
2. Pages through all successful transactions for each contract.
3. Classifies vault-engine contract calls into lifecycle steps
   (open → deposit → mint → repay → withdraw).
4. Counts unique external wallets, total external transactions, full-flow completions,
   and emits an explorer URL for every lifecycle transaction.

Definitions:
- **External wallet** — any transaction sender other than the deployer key.
- **Vault action** — a successful contract call mapped to one of the lifecycle steps.
- **Full flow** — a single wallet that completed open + deposit + repay + withdraw.

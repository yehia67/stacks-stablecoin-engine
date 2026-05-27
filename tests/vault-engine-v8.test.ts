// Tests for multi-asset-vault-engine-v8 + liquidation-engine-v8.
//
// v8 introduces trait-based oracle dispatch: the engine reads the oracle
// principal from collateral-registry-v6 (which already stored it but v7
// ignored it) and accepts the oracle as a trait reference at every pricing
// call site. Read-only price-aware functions take (price uint) directly
// because Clarity forbids trait dispatch from read-only context.
//
// Regression coverage (sBTC vault lifecycle on v8) lives in this file too --
// the v7 multi-asset.test.ts suite is kept for the deployed-on-mainnet engine
// and stays untouched.

import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// ── helpers ─────────────────────────────────────────────────────────────────

function getTestAccounts() {
  const accounts = simnet.getAccounts();
  const deployer = accounts.get("deployer")!;
  const wallet1 = accounts.get("wallet_1")!;
  const wallet2 = accounts.get("wallet_2")!;
  return { deployer, wallet1, wallet2 };
}

function authorizeV8VaultEngine(deployer: string) {
  const enginePrincipal = `${deployer}.multi-asset-vault-engine-v8`;

  // Stablecoin token authorization (legacy single-token mint path).
  expect(
    simnet.callPublicFn(
      "stablecoin-token-v4",
      "set-vault-engine",
      [Cl.principal(enginePrincipal)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));

  // Registry authorization.
  expect(
    simnet.callPublicFn(
      "collateral-registry-v6",
      "set-vault-engine-authorized",
      [Cl.principal(enginePrincipal), Cl.bool(true)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
}

// Register the default-namespace stablecoin (sid=0) used by the legacy vault
// flow (open-vault, deposit-collateral, mint-against-asset). The creator is
// the only principal allowed to call configure-collateral-for-stablecoin, so
// every test that exercises sid=0 collateral must register here first.
function registerSid0Stablecoin(deployer: string, creator: string) {
  // Free registration so wallet_1 can register without STX.
  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));

  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "register-stablecoin",
      [Cl.stringAscii("Test"), Cl.stringAscii("TEST")],
      creator
    ).result
  ).toBeOk(Cl.uint(0));

  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "set-token-contract",
      [Cl.uint(0), Cl.principal(`${deployer}.stablecoin-token-v4`)],
      creator
    ).result
  ).toBeOk(Cl.bool(true));
}

function seedDiaBtcPrice(deployer: string, value = 6700000000000) {
  simnet.callPublicFn(
    "dia-oracle-adapter",
    "set-value",
    [Cl.stringAscii("BTC/USD"), Cl.uint(value)],
    deployer
  );
}

// Adds a collateral with a given oracle principal. v8 reads this oracle
// directly from the registry, so it must match what callers pass as the
// oracle trait at every pricing call site.
// Adds a collateral type globally AND configures it for the sid=0 stablecoin
// (so the engine's get-effective-collateral-config returns Some). The caller
// passing `creator` must be the registered creator of stablecoin-id 0; pass
// `null` to skip the per-stablecoin step (e.g. when only the global config is
// needed).
function addCollateral(
  deployer: string,
  creator: string | null,
  asset: string,
  oraclePrincipal: string,
  overrides: Partial<{
    minCr: number;
    liqRatio: number;
    penalty: number;
    fee: number;
    ceiling: number;
    floor: number;
  }> = {}
) {
  const r = {
    minCr: 150,
    liqRatio: 120,
    penalty: 10,
    fee: 200,
    ceiling: 10_000_000,
    floor: 100,
    ...overrides,
  };
  const result = simnet.callPublicFn(
    "collateral-registry-v6",
    "add-collateral-type",
    [
      Cl.principal(asset),
      Cl.uint(r.minCr),
      Cl.uint(r.liqRatio),
      Cl.uint(r.penalty),
      Cl.uint(r.fee),
      Cl.uint(r.ceiling),
      Cl.uint(r.floor),
      Cl.principal(oraclePrincipal),
    ],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));

  if (creator !== null) {
    expect(
      simnet.callPublicFn(
        "collateral-registry-v6",
        "configure-collateral-for-stablecoin",
        [
          Cl.uint(0),
          Cl.principal(asset),
          Cl.uint(r.minCr),
          Cl.uint(r.liqRatio),
          Cl.uint(r.penalty),
          Cl.uint(r.fee),
          Cl.uint(r.ceiling),
          Cl.uint(r.floor),
        ],
        creator
      ).result
    ).toBeOk(Cl.bool(true));
  }
}

function faucet(deployer: string, contractName: string, recipient: string, amount: number) {
  simnet.callPublicFn(
    contractName,
    "faucet-mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    deployer
  );
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("multi-asset-vault-engine-v8: trait-based oracle dispatch", () => {
  it("validates oracle trait matches the principal stored in the registry", () => {
    const { deployer, wallet1 } = getTestAccounts();
    seedDiaBtcPrice(deployer);
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);

    const sbtc = `${deployer}.sbtc-token-v4`;
    const btcOracle = `${deployer}.price-oracle-dia-btc-v2`;
    const wrongOracle = `${deployer}.price-oracle-dia-stx-v2`;

    addCollateral(deployer, wallet1, sbtc, btcOracle);

    faucet(deployer, "sbtc-token-v4", wallet1, 100_000_000); // 1 BTC

    expect(
      simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "deposit-collateral",
        [Cl.principal(sbtc), Cl.principal(sbtc), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(100_000_000));

    // Mint with the WRONG oracle: engine looks up registered oracle (BTC),
    // sees mismatch with passed oracle (STX), returns price=u0, collateral
    // value=0, health-factor < 100 -> ERR_UNSAFE_HEALTH_FACTOR (u204).
    const mintWrong = simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "mint-against-asset",
      [Cl.principal(sbtc), Cl.principal(wrongOracle), Cl.uint(1_000_000)],
      wallet1
    );
    expect(mintWrong.result).toBeErr(Cl.uint(204));

    // Mint with the CORRECT oracle: succeeds.
    const mintRight = simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "mint-against-asset",
      [Cl.principal(sbtc), Cl.principal(btcOracle), Cl.uint(1_000_000)],
      wallet1
    );
    expect(mintRight.result).toBeOk(Cl.uint(1_000_000));
  });

  it("blocks unsafe withdrawals when wrong oracle would zero out collateral value", () => {
    const { deployer, wallet1 } = getTestAccounts();
    seedDiaBtcPrice(deployer);
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);

    const sbtc = `${deployer}.sbtc-token-v4`;
    const btcOracle = `${deployer}.price-oracle-dia-btc-v2`;
    const wrongOracle = `${deployer}.price-oracle-dia-stx-v2`;

    addCollateral(deployer, wallet1, sbtc, btcOracle);
    faucet(deployer, "sbtc-token-v4", wallet1, 100_000_000);

    simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "deposit-collateral",
      [Cl.principal(sbtc), Cl.principal(sbtc), Cl.uint(100_000_000)],
      wallet1
    );
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "mint-against-asset",
      [Cl.principal(sbtc), Cl.principal(btcOracle), Cl.uint(1_000_000)],
      wallet1
    );

    // Withdraw with wrong oracle => price=u0 => health<100 => blocked.
    const withdrawWrong = simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "withdraw-collateral",
      [Cl.principal(sbtc), Cl.principal(sbtc), Cl.principal(wrongOracle), Cl.uint(1_000_000)],
      wallet1
    );
    expect(withdrawWrong.result).toBeErr(Cl.uint(204));

    // Withdraw with right oracle, small amount => succeeds.
    const withdrawRight = simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "withdraw-collateral",
      [Cl.principal(sbtc), Cl.principal(sbtc), Cl.principal(btcOracle), Cl.uint(100_000)],
      wallet1
    );
    expect(withdrawRight.result).toBeOk(Cl.uint(99_900_000));
  });

  it("read-only get-position-health-factor takes price uint and returns sane values", () => {
    const { deployer, wallet1 } = getTestAccounts();
    seedDiaBtcPrice(deployer);
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);

    const sbtc = `${deployer}.sbtc-token-v4`;
    const btcOracle = `${deployer}.price-oracle-dia-btc-v2`;
    addCollateral(deployer, wallet1, sbtc, btcOracle);
    faucet(deployer, "sbtc-token-v4", wallet1, 100_000_000);

    simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "deposit-collateral",
      [Cl.principal(sbtc), Cl.principal(sbtc), Cl.uint(100_000_000)],
      wallet1
    );
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "mint-against-asset",
      [Cl.principal(sbtc), Cl.principal(btcOracle), Cl.uint(1_000_000)],
      wallet1
    );

    // Pull live price from oracle, pass to engine as uint.
    const priceResp = simnet.callReadOnlyFn(
      "price-oracle-dia-btc-v2",
      "get-price",
      [],
      wallet1
    );
    expect(priceResp.result).toBeOk(Cl.uint(6700000000000));

    const hf = simnet.callReadOnlyFn(
      "multi-asset-vault-engine-v8",
      "get-position-health-factor",
      [Cl.principal(wallet1), Cl.principal(sbtc), Cl.uint(6700000000000)],
      wallet1
    );
    // 1 BTC * $67k / ($1 debt) / 150% min-cr = comfortable health
    // ((amount * price / 1e8) * 10000) / (debt * minRatio)
    // = ((100_000_000 * 6700000000000 / 1e8) * 10000) / (1_000_000 * 150)
    // = (6_700_000_000_000 * 10000) / 150_000_000
    // = 446_666_666
    expect(hf.result).toBeUint(446666666);

    // With price=0 (e.g. wrong oracle simulation), health-factor collapses.
    const hfZero = simnet.callReadOnlyFn(
      "multi-asset-vault-engine-v8",
      "get-position-health-factor",
      [Cl.principal(wallet1), Cl.principal(sbtc), Cl.uint(0)],
      wallet1
    );
    expect(hfZero.result).toBeUint(0);
  });

  it("vGLD constant-$1 oracle prices end-to-end via trait dispatch", () => {
    const { deployer, wallet1 } = getTestAccounts();
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);

    const vgld = `${deployer}.vgld-token-v4`;
    const vgldOracle = `${deployer}.price-oracle-vgld-v1`;

    // vGLD risk profile per docs/plans/add-vgld-collateral-zero-deploy-28ad19.md
    addCollateral(deployer, wallet1, vgld, vgldOracle, {
      minCr: 150,
      liqRatio: 120,
      penalty: 10,
      fee: 200,
      ceiling: 100_000_000_000,
      floor: 10_000_000,
    });

    // Deposit 1000 vGLD ($1000 collateral). 8 decimals.
    faucet(deployer, "vgld-token-v4", wallet1, 1000_00000000);

    expect(
      simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "deposit-collateral",
        [Cl.principal(vgld), Cl.principal(vgld), Cl.uint(1000_00000000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(1000_00000000));

    // At 150% min-CR, $1000 collateral allows minting up to ~$666 stablecoins.
    // Floor is 10_000_000 (10 stablecoins, 6dp). Mint 100 stablecoins.
    const mint = simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "mint-against-asset",
      [Cl.principal(vgld), Cl.principal(vgldOracle), Cl.uint(100_000_000)],
      wallet1
    );
    expect(mint.result).toBeOk(Cl.uint(100_000_000));

    // Confirm health factor with constant $1 price = u100000000.
    const hf = simnet.callReadOnlyFn(
      "multi-asset-vault-engine-v8",
      "get-position-health-factor",
      [Cl.principal(wallet1), Cl.principal(vgld), Cl.uint(100_000_000)],
      wallet1
    );
    // collateral_value = 100_000_000_000 * 100_000_000 / 1e8 = 100_000_000_000
    // hf = (100_000_000_000 * 10000) / (100_000_000 * 150)
    //    = 1_000_000_000_000_000 / 15_000_000_000 = 66_666 (>= 100 = healthy)
    expect(hf.result).toBeUint(66666);
  });

  it("full sBTC v8 lifecycle: open -> deposit -> mint -> repay -> withdraw", () => {
    const { deployer, wallet1 } = getTestAccounts();
    seedDiaBtcPrice(deployer);
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);

    const sbtc = `${deployer}.sbtc-token-v4`;
    const btcOracle = `${deployer}.price-oracle-dia-btc-v2`;
    addCollateral(deployer, wallet1, sbtc, btcOracle);
    faucet(deployer, "sbtc-token-v4", wallet1, 100_000_000);

    simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "deposit-collateral",
      [Cl.principal(sbtc), Cl.principal(sbtc), Cl.uint(100_000_000)],
      wallet1
    );
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "mint-against-asset",
      [Cl.principal(sbtc), Cl.principal(btcOracle), Cl.uint(1_000_000)],
      wallet1
    );

    // Repay does NOT need an oracle (no health check on repay).
    const repay = simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "repay-against-asset",
      [Cl.principal(sbtc), Cl.uint(1_000_000)],
      wallet1
    );
    expect(repay.result).toBeOk(Cl.uint(0));

    // Withdraw all collateral now that debt is zero.
    const withdraw = simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "withdraw-collateral",
      [Cl.principal(sbtc), Cl.principal(sbtc), Cl.principal(btcOracle), Cl.uint(100_000_000)],
      wallet1
    );
    expect(withdraw.result).toBeOk(Cl.uint(0));
  });

  it("liquidate-position can only be called by liquidation-engine-v8", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    seedDiaBtcPrice(deployer);
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);

    const sbtc = `${deployer}.sbtc-token-v4`;
    const btcOracle = `${deployer}.price-oracle-dia-btc-v2`;
    const stbToken = `${deployer}.stablecoin-token-v4`;
    addCollateral(deployer, wallet1, sbtc, btcOracle);
    faucet(deployer, "sbtc-token-v4", wallet1, 100_000_000);

    simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "deposit-collateral",
      [Cl.principal(sbtc), Cl.principal(sbtc), Cl.uint(100_000_000)],
      wallet1
    );

    // Direct call from a user (not the liquidation-engine) must fail with
    // ERR_NOT_LIQUIDATION_ENGINE (u216).
    const direct = simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "liquidate-position",
      [
        Cl.principal(wallet1),
        Cl.uint(0),
        Cl.principal(sbtc),
        Cl.principal(sbtc),
        Cl.principal(stbToken),
        Cl.uint(1_000_000),
        Cl.uint(100_000),
      ],
      wallet2
    );
    expect(direct.result).toBeErr(Cl.uint(216));
  });
});

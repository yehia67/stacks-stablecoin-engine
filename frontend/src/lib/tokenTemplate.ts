import { CONTRACTS } from "./constants";

/**
 * Generates a SIP-010 + stablecoin-engine-token-trait compliant Clarity
 * contract source for a newly registered stablecoin.
 *
 * The deployed contract:
 *  - Implements both traits (referenced from the SSE deployer, not the user).
 *  - Uses native define-fungible-token for post-condition support.
 *  - Pre-authorises the multi-asset vault engine so vaults can mint/burn
 *    immediately after deployment (no extra set-vault-engine tx needed).
 *  - Parametrises TOKEN-NAME and TOKEN-SYMBOL from the registration data.
 */
export function generateTokenContract(name: string, symbol: string): string {
  const deployer = CONTRACTS.DEPLOYER;
  const vaultEngine = `${deployer}.${CONTRACTS.MULTI_ASSET_VAULT_ENGINE}`;
  // Derive a stable fungible token identifier from the symbol
  const ftName = `${symbol.toLowerCase()}-ft`;

  return `
;; Auto-generated SIP-010 token for "${name}" (${symbol})
;; Deployed via SSE Stablecoin Factory
;; Uses native define-fungible-token for post-condition support

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(impl-trait '${deployer}.stablecoin-engine-token-trait.stablecoin-engine-token-trait)

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR_UNAUTHORIZED u401)

(define-constant TOKEN-NAME "${name}")
(define-constant TOKEN-SYMBOL "${symbol}")
(define-constant TOKEN-DECIMALS u6)

(define-fungible-token ${ftName})

;; Pre-authorise the SSE vault engine so vaults work immediately
(define-data-var vault-engine (optional principal) (some '${vaultEngine}))

(define-read-only (is-vault-engine (caller principal))
  (match (var-get vault-engine)
    ve (is-eq ve caller)
    false
  )
)

(define-public (set-vault-engine (new principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set vault-engine (some new))
    (ok true)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (try! (ft-transfer? ${ftName} amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-vault-engine contract-caller) (err ERR_UNAUTHORIZED))
    (ft-mint? ${ftName} amount recipient)
  )
)

(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-vault-engine contract-caller) (err ERR_UNAUTHORIZED))
    (ft-burn? ${ftName} amount owner)
  )
)

(define-read-only (get-name)
  (ok TOKEN-NAME)
)

(define-read-only (get-symbol)
  (ok TOKEN-SYMBOL)
)

(define-read-only (get-decimals)
  (ok TOKEN-DECIMALS)
)

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance ${ftName} who))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply ${ftName}))
)

(define-read-only (get-token-uri)
  (ok none)
)
`.trim();
}

/**
 * Derives a unique contract name from the stablecoin symbol.
 * Appends a short timestamp suffix to avoid collisions when
 * re-deploying (Stacks rejects duplicate contract names at the same address).
 * e.g. "MUSD" -> "musd-token-1712345678"
 */
export function deriveTokenContractName(symbol: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return `${symbol.toLowerCase()}-token-${ts}`;
}

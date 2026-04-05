import { CONTRACTS } from "./constants";

/**
 * Generates a SIP-010 + stablecoin-engine-token-trait compliant Clarity
 * contract source for a newly registered stablecoin.
 *
 * The deployed contract:
 *  - Implements both traits (referenced from the SSE deployer, not the user).
 *  - Pre-authorises the multi-asset vault engine so vaults can mint/burn
 *    immediately after deployment (no extra set-vault-engine tx needed).
 *  - Parametrises TOKEN-NAME and TOKEN-SYMBOL from the registration data.
 */
export function generateTokenContract(name: string, symbol: string): string {
  const deployer = CONTRACTS.DEPLOYER;
  const vaultEngine = `${deployer}.${CONTRACTS.MULTI_ASSET_VAULT_ENGINE}`;

  return `
;; Auto-generated SIP-010 token for "${name}" (${symbol})
;; Deployed via SSE Stablecoin Factory

(impl-trait '${deployer}.sip-010-trait.sip-010-trait)
(impl-trait '${deployer}.stablecoin-engine-token-trait.stablecoin-engine-token-trait)

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR_UNAUTHORIZED u401)
(define-constant ERR_INSUFFICIENT_BALANCE u402)

(define-constant TOKEN-NAME "${name}")
(define-constant TOKEN-SYMBOL "${symbol}")
(define-constant TOKEN-DECIMALS u6)

(define-data-var total-supply uint u0)
;; Pre-authorise the SSE vault engine so vaults work immediately
(define-data-var vault-engine (optional principal) (some '${vaultEngine}))

(define-map balances
  {owner: principal}
  {balance: uint}
)

(define-read-only (balance-of (owner principal))
  (match (map-get? balances {owner: owner})
    entry (get balance entry)
    u0
  )
)

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

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (let ((sender-balance (balance-of sender))
          (recipient-balance (balance-of recipient)))
      (asserts! (>= sender-balance amount) (err ERR_INSUFFICIENT_BALANCE))
      (map-set balances {owner: sender} {balance: (- sender-balance amount)})
      (map-set balances {owner: recipient} {balance: (+ recipient-balance amount)})
      (ok true)
    )
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-vault-engine contract-caller) (err ERR_UNAUTHORIZED))
    (let ((current (balance-of recipient)))
      (map-set balances {owner: recipient} {balance: (+ current amount)})
      (var-set total-supply (+ (var-get total-supply) amount))
      (ok true)
    )
  )
)

(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-vault-engine contract-caller) (err ERR_UNAUTHORIZED))
    (let ((current (balance-of owner)))
      (asserts! (>= current amount) (err ERR_INSUFFICIENT_BALANCE))
      (map-set balances {owner: owner} {balance: (- current amount)})
      (var-set total-supply (- (var-get total-supply) amount))
      (ok true)
    )
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
  (ok (balance-of who))
)

(define-read-only (get-total-supply)
  (ok (var-get total-supply))
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

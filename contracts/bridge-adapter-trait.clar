;; bridge-adapter-trait.clar
;; Trait defining the interface for cross-chain bridge adapters.
;; Adapters implement this trait to enable stablecoins to move between Stacks and remote chains.

(define-trait bridge-adapter-trait
  (
    ;; Mint tokens on Stacks after a deposit is confirmed on the remote chain.
    ;; Called by the attestation service or relayer.
    ;; Parameters:
    ;;   amount: uint - Amount to mint (in token's smallest unit)
    ;;   recipient: principal - Stacks address to receive minted tokens
    ;;   remote-tx-id: (buff 32) - Transaction ID from the remote chain (for verification/logging)
    ;;   remote-chain-id: uint - Identifier of the source chain
    (mint-from-remote (uint principal (buff 32) uint) (response bool uint))

    ;; Burn tokens on Stacks to initiate a withdrawal to a remote chain.
    ;; Called by the token holder.
    ;; Parameters:
    ;;   amount: uint - Amount to burn
    ;;   remote-recipient: (buff 32) - Encoded address on the remote chain (e.g., bytes32 for EVM)
    ;;   remote-chain-id: uint - Identifier of the destination chain
    (burn-to-remote (uint (buff 32) uint) (response bool uint))
  )
)

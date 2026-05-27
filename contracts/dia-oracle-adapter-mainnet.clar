;; DIA Oracle Adapter (Mainnet)
;; ---
;; Forwards get-value calls to the real DIA mainnet contract.
;; Deploy this as "dia-oracle-adapter" on mainnet so the DIA wrapper
;; oracles (price-oracle-dia-btc-v2, price-oracle-dia-stx-v2) resolve correctly.
;;
;; DIA Testnet: ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle
;; DIA Mainnet: SP1G48FZ4Y7JY8G2Z0N51QTCYGBQ6F4J43J77BQC0.dia-oracle

(define-constant ERR_PAIR_NOT_FOUND u701)

;; Forward to DIA mainnet oracle
(define-read-only (get-value (pair (string-ascii 20)))
  (contract-call? 'SP1G48FZ4Y7JY8G2Z0N51QTCYGBQ6F4J43J77BQC0.dia-oracle get-value pair)
)

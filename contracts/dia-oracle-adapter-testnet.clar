;; DIA Oracle Adapter (Testnet)
;; ---
;; Forwards get-value calls to the real DIA testnet contract.
;; Deploy this as "dia-oracle-adapter" on testnet so the DIA wrapper
;; oracles (price-oracle-dia-btc, price-oracle-dia-stx) resolve correctly.
;;
;; DIA Testnet: ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle
;; DIA Mainnet: SP1G48FZ4Y7JY8G2Z0N51QTCYGBQ6F4J43J77BQC0.dia-oracle

(define-constant ERR_PAIR_NOT_FOUND u701)

;; Forward to DIA testnet oracle
(define-read-only (get-value (pair (string-ascii 20)))
  (contract-call? 'ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle get-value pair)
)

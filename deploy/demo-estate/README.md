# Northwind demo estate

A synthetic, deliberately classical-only cryptographic estate used as the default
target for the hosted PQC Migration Scanner.

It is **not** production code: every service below is a small, self-contained
example of a real migration pattern (internet-facing TLS, payment signing,
mobile key exchange) so a first-time visitor can scan something meaningful
without mounting their own source tree.

```
services/
  api-gateway/     RSA-2048 TLS termination, SHA-256 session digests
  payments/        ECDSA P-256 signing, AES-128-GCM payloads
  mobile/          X25519 key exchange, ML-KEM-768 hybrid experiment
requirements.txt   Python dependency inventory
package.json       Node dependency inventory
```

Expected story: the gateway and payments services are quantum-vulnerable and
need a migration plan; the mobile experiment already carries ML-KEM-768 and
shows what "done" looks like.

# Security

## Scope

This repository is a **research prototype and proof of concept**.

It is intended to demonstrate the VFA protocol flow — not to provide a
production-ready security implementation.

---

## Known limitations (by design)

| Area | Current state | Production requirement |
|------|---------------|----------------------|
| Token signing | HMAC-SHA256 with shared secret | Asymmetric signature (Ed25519 or ECDSA P-256) |
| Key storage | Environment variable | HSM or secrets manager |
| Replay protection | Not implemented | Nonce deduplication store at gateway |
| Token lifetime | 300 s default | ≤ 60 s (`exp − iat`) per VFA-Spec |
| Session storage | In-memory dict | Persistent, distributed store |
| CORS | Open (`*`) | Restricted to known origins |
| mTLS | Not implemented | Required on all service-to-service channels |
| Revocation | Not implemented | Real-time propagation (≤ 30 s) |
| Audit log | Not implemented | Append-only, tamper-evident log |
| Rate limiting | Not implemented | Required on approval and token endpoints |

---

## Do not use in production

This codebase **must not** be deployed in any environment where real
credentials, infrastructure, or user data are at risk.

Specifically:

- the HMAC secret provides no security if it leaks — and in this setup it is trivially exposed
- in-memory session and token stores are lost on restart and not shared across replicas
- there is no protection against replay attacks
- CORS is intentionally open for local development convenience

---

## Reporting a vulnerability

This is a demonstration project without a formal security policy.

If you notice a design-level issue relevant to the VFA protocol specification
(not just this demo implementation), please open an issue or contact the
repository owner directly.

---

## Production hardening checklist

Before using VFA concepts in a real system, implement at minimum:

- [ ] asymmetric token signing (Ed25519 or ECDSA P-256)
- [ ] hardware-backed key storage for the issuer signing key
- [ ] key rotation with `kid` support
- [ ] nonce deduplication store at the gateway
- [ ] token lifetime enforcement (`exp − iat ≤ 60 s`)
- [ ] mTLS on all service-to-service channels
- [ ] audience and endpoint binding verified at the gateway
- [ ] CORS restricted to known origins
- [ ] rate limiting on approval and token issuance endpoints
- [ ] append-only audit log
- [ ] real-time revocation propagation

See [VFA-Spec / SECURITY_MODEL.md](https://github.com/Csnyi/VFA-Spec/blob/main/SECURITY_MODEL.md)
for the full production security model.

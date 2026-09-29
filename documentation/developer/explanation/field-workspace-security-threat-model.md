# Field Workspace security threat model

## Scope and invariants

The Field Workspace protects offline fieldwork on an Authorized Field Device. PostgreSQL contains
only authorization metadata: public keys, opaque device and grant identifiers, expiry/status, and
value-free audit outcomes. Protected Field Data, decrypted keys, Field Recovery Secrets, human
filenames, and field payloads never enter server tables, analytics, error reports, HTTP caches, or
service-worker caches.

The boundary uses:

- non-extractable P-256 device signing and agreement keys generated on the device;
- a server-signed Offline Field Grant capped at 72 hours and bound to device-key fingerprint,
  application build/version, and signed Field Protocol Package;
- a user-verified WebAuthn credential accepted only when its authenticator flags prove it is not
  backup eligible; each offline unlock verifies the assertion locally before device-key unwrapping;
- random vault keys and 24-byte nonces with XChaCha20-Poly1305 authenticated encryption;
- an ECDH-derived device wrapping key that binds the vault key to the non-extractable device
  agreement key, plus an explicit device signing-key possession proof before grant acceptance;
- an Argon2id-derived recovery wrapping key. Ask Siargao retains no Field Recovery Secret or bypass;
- an IndexedDB compare-and-set writer lease and encrypted takeover receipt; and
- exact-scope, fresh-authority purge with verified recovery or an explicit retention/withdrawal
  basis.

Cryptographic versions and parameters are stored with envelopes and wraps. An unknown algorithm or
version fails closed; records are not silently reinterpreted.

## Threats and controls

| Threat | Control and residual risk |
| --- | --- |
| Lost or stolen device | Inactivity removes vault keys from memory; offline unlock requires the registered, user-verified, non-backup-eligible credential and a usable device-bound grant. Physical iPad verification remains required. |
| XSS while locked | No plaintext vault key is present. The enforced field CSP permits only same-origin script/connect/worker sources and excludes analytics/model/error-reporting endpoints. A same-origin supply-chain compromise could still replace trusted code and requires independent review. |
| XSS while unlocked | Browser code can access plaintext needed for the active operation. Short inactivity, narrow UI lifetime, version pinning, and no outbound sinks reduce exposure but cannot make an origin compromise safe. |
| Malicious import or archive | Import does not confer identity or authorization. Future transfer/import code must decrypt, authenticate, schema-check, verify protocol compatibility and referential closure before use. Files and filenames remain untrusted. |
| Weak key generation, wrapping, rotation, or revocation | Keys and nonces use the platform CSPRNG. Recovery uses Argon2id and authenticated wrapping. Revocation removes future trust; an otherwise valid disconnected grant remains usable until expiry unless an explicit online preflight learned revocation. Signer rotation must retain old public keys until all issued grants expire. |
| Syncable passkey or browser/iCloud backup | Registration verifies WebAuthn backup-eligibility and user-verification flags and rejects multi-device/backup-eligible credentials. IndexedDB and service-worker state may still be included in browser/platform backup; ciphertext remains bound to unavailable device/recovery keys. Target-iPad behavior is an acceptance gate. |
| Clock rollback | More than two minutes of backward movement from the last trusted observation locks the workspace. Small tolerance avoids false locks from ordinary clock correction. The two-minute window is accepted residual risk. |
| Service-worker or origin compromise | The root-scoped worker ignores cross-origin, non-GET, API, RSC, blob, export, and unrelated navigation requests. It caches only the generic offline shell and exact `/_next/static/` assets discovered from that shell. Updates never call `skipWaiting()` while an active Visit exists. |
| Logs, analytics, error reports, or caches | Field code emits stable value-free codes only. Field CSP `connect-src` is same-origin, the service worker never caches APIs/RSC, field responses are private/no-store, and field events are absent from observability schemas. |
| Storage quota, pressure, or eviction | Setup requests persistent storage, checks headroom, and fails Field Readiness when either is inadequate. Persistence is not eviction immunity. A successfully exercised Field Recovery Secret and verified external Field Recovery Export remain required before real work. Quota errors lock/preserve existing ciphertext; they never trigger purge. |
| Concurrent tabs or suspended writer | IndexedDB transaction state, not BroadcastChannel or Web Locks, is authoritative. A second writer is denied. Lease expiry after suspension requires explicit takeover and an encrypted receipt before the new lease is valid. |
| Purge abuse or partial deletion | Purge names every opaque record, requires a fresh five-minute authority plus verified recovery or controlled basis, verifies the entire scope, and deletes/audits in one transaction. Logout, grant expiry, revocation, application update, and quota errors never purge. |
| Recovery-secret loss or brute force | The setup ceremony requires re-entry before Field Readiness. Loss of the secret and every device is unrecoverable by design. Argon2id is memory-hard, but JavaScript is slower than native code and needs independent parameter review on the target iPad. A high-entropy 256-bit generated secret is required. |

## Offline grant and update policy

The default and maximum grant lifetime is 72 hours. The exact application semantic version, deploy
build/cache generation, protocol package ID, protocol version, device ID, key fingerprint, signer,
issue time, and expiry are signed. Expiry locks capture and keeps ciphertext. A changed build or
protocol cannot reinterpret active work. Offline preparation is explicit; a waiting service worker
activates only after the application reports no active Visit.

## Evidence still required before parent acceptance

- independent cryptographic and focused security review, including Noble library/version and KDF
  parameter review;
- real iPad proof for non-backup-eligible Face ID/WebAuthn behavior, inactivity, Home Screen install,
  airplane-mode hard reload, process kill/restart, clock change, reauthorization, and update waiting;
- storage-pressure/eviction and recovery-export restoration proof on the target OS; and
- physical QR/camera and cross-device transfer/receipt proof when those later workflow issues land.

Passing unit, PostgreSQL, build, or Chromium tests is implementation evidence only. It is not the
required physical-device or independent-review evidence.

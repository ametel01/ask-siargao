# Protect offline fieldwork with device-bound authorization

The maintained Field Recorder will be an installable offline-first web application rather than a
required Apple Shortcut. A Field Researcher authorizes a device while online and receives a
time-bounded, device-bound Offline Field Grant; Protected Field Data is encrypted locally, locks after
inactivity, and remains excluded from analytics, error payloads, HTTP caches, and silent background
networking. Protected exports are authenticated-encrypted, active work pins its compatible Capture
Protocol version, and authorization expiry locks rather than erases evidence. This accepts more local
security and recovery complexity so fieldwork can continue without connectivity without treating a
shared token, stale file, or ordinary browser storage as researcher identity.

Routine cross-device transfer encrypts to an Authorized Field Device registered through public-key
exchange; a researcher-held Field Recovery Secret provides fallback recovery, and Ask Siargao keeps no
administrative bypass. A transfer succeeds only after the recipient decrypts and verifies the archive
and returns a verifiable receipt. Device revocation removes future trust without remotely erasing
protected evidence.

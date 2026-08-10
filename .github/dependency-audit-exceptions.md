# Dependency Audit Exceptions

The CI dependency audit fails on every high or critical advisory except the entries below. An
exception is temporary release evidence, not a claim that the vulnerable package is safe.

| Advisory | Package and path | Reachability determination | Owner | Expires |
| --- | --- | --- | --- | --- |
| `GHSA-w3rx-r6r6-pgpr` | `image-size@1.2.1` through Clerk UI's optional Solana/React Native tooling | Ask Siargao is a Next.js web application and does not import Metro, React Native, or the ICNS parser in its build or runtime paths. | Alex Metelli | 2026-09-09 |
| `GHSA-5p2g-fcmc-qvqq` | `image-size@1.2.1` through Clerk UI's optional Solana/React Native tooling | Ask Siargao is a Next.js web application and does not import Metro, React Native, or the JXL/HEIF parsers in its build or runtime paths. | Alex Metelli | 2026-09-09 |

Remove both exceptions as soon as Clerk UI's optional dependency graph provides a patched
`image-size`. CI must not add an exception without a reachability note, named owner, and expiry.

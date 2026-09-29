# Dependency Audit Exceptions

The CI dependency audit fails on every high or critical advisory except the entries below. An
exception is temporary release evidence, not a claim that the vulnerable package is safe.

| Advisory | Package and path | Reachability determination | Owner | Expires |
| --- | --- | --- | --- | --- |
| None | - | - | - | - |

The previous `image-size` exceptions were removed after the dependency graph was pinned to the
patched `image-size@2.0.4`. CI must not add an exception without a reachability note, named owner,
and expiry.

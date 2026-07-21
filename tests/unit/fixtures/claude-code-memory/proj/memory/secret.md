---
name: secret-node
description: A reference node whose body accidentally leaked an API key.
type: reference
---

Here is a deploy note that leaked a key: sk-proj-FAKE0000000000000000000000000000000000000000000000 which must never be committed.

The rest of this body is ordinary prose describing how the deploy pipeline reads the key from an environment variable at boot, rotates it weekly, and never logs it. Several more lines of normal explanation follow so the redaction ratio stays comfortably under the fail-closed threshold and the node still imports with the single secret scrubbed out of the payload entirely.

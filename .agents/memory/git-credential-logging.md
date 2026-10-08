---
name: Credential-safe Git logging
description: Prevent verbose Git subprocess diagnostics from logging authentication headers.
---

Remove inherited Git tracing and curl-verbosity variables before authenticated
Git subprocesses; do not rely on setting all such variables to `"0"`.

**Why:** In this environment, `GIT_CURL_VERBOSE=0` still enabled curl diagnostics.
Git redacted the authorization value, and a direct value-presence check confirmed
no credential was exposed, but relying on redaction is weaker than preventing
header logging.

**How to apply:** Delete `GIT_CURL_VERBOSE`, `GIT_TRACE`, and `GIT_TRACE_*`
variables from the subprocess environment before injecting an environment-only
authentication header. Keep credentials out of arguments, files, and output.

#!/usr/bin/env bash
# verify-install.sh: post-install smoke check for the 5D Claw Security skill.
#
# Runs four checks:
#   1. python3 is on PATH
#   2. `import fivedrisk` succeeds and prints a version
#   3. ~/.fivedrisk/policy.yaml (or $FIVEDRISK_POLICY_PATH) exists
#   4. (best effort) `openclaw plugins list` mentions 5d-claw-security
#
# Exits 0 on success, non-zero on the first failure. Each step prints
# a single-line PASS/FAIL with context.

set -u

POLICY_PATH="${FIVEDRISK_POLICY_PATH:-$HOME/.fivedrisk/policy.yaml}"
EXIT_CODE=0

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    EXIT_CODE=1
}

pass() {
    printf 'PASS: %s\n' "$1"
}

# 1. python3 on PATH
if command -v python3 >/dev/null 2>&1; then
    pass "python3 on PATH ($(command -v python3))"
else
    fail "python3 not on PATH"
    exit "$EXIT_CODE"
fi

# 2. import fivedrisk
if VERSION=$(python3 -c 'import fivedrisk; print(fivedrisk.__version__)' 2>&1); then
    pass "fivedrisk installed (version: $VERSION)"
else
    fail "import fivedrisk failed: $VERSION"
    exit "$EXIT_CODE"
fi

# 3. policy file
if [ -f "$POLICY_PATH" ]; then
    if python3 -c "import sys; open('$POLICY_PATH').read()" >/dev/null 2>&1; then
        pass "policy file present and readable ($POLICY_PATH)"
    else
        fail "policy file present but unreadable ($POLICY_PATH)"
    fi
else
    fail "policy file missing ($POLICY_PATH). Did step 2 of SKILL.md run?"
fi

# 4. plugin listed (best effort; not all OpenClaw installs expose `plugins list`)
if command -v openclaw >/dev/null 2>&1; then
    if openclaw plugins list 2>/dev/null | grep -q '5d-claw-security'; then
        pass "plugin '5d-claw-security' listed by openclaw"
    else
        printf 'SKIP: openclaw plugins list did not mention 5d-claw-security (may be best-effort only)\n'
    fi
else
    printf 'SKIP: openclaw CLI not on PATH; cannot verify plugin install from this side\n'
fi

if [ "$EXIT_CODE" -eq 0 ]; then
    printf '\nAll required checks passed.\n'
else
    printf '\nOne or more checks failed. See output above.\n' >&2
fi

exit "$EXIT_CODE"

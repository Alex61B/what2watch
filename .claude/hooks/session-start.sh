#!/usr/bin/env bash
# Fires at the start of every session.
# Clears the per-session edit log and reminds the user of the phase commands.

rm -f /tmp/what2watch-changes.txt

echo '{"systemMessage": "Backpressure Protocol active. Phase commands: /plan → /implement → /verify → /fix → /review"}'

#!/usr/bin/env bash
# Fires when Claude stops responding.
# If edits were made this session, nudges toward /verify.
# If nothing was edited, nudges toward /plan or /review.

n=$(wc -l < /tmp/what2watch-changes.txt 2>/dev/null || echo 0)
n=${n// /}

if [ "$n" -gt 0 ]; then
  jq -n --arg m "$n edit(s) logged this session — next: /verify → /fix → /review" '{systemMessage: $m}'
else
  jq -n '{systemMessage: "No edits this session — /plan to start or /review to audit"}'
fi

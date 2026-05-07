#!/usr/bin/env bash
# Fires after every Write or Edit tool call.
# Appends the edited file path to a per-session log so IMPLEMENT's
# "Files changed" summary can reference it.

file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] && echo "$(date '+%H:%M:%S') $file" >> /tmp/what2watch-changes.txt
exit 0

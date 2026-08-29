#!/bin/bash
# Double-click this to run Cook Book on this Mac.
#
# Everything works on the website except reading a recipe from a screenshot or
# pasted text: browsers will not let a page from the internet talk to a program
# on your own machine, and nothing can change that. So importing happens here,
# and the recipe syncs to your other devices within seconds.
#
# Leave this Terminal window open while you use it. Close it when you are done.

set -e
# This file sits in the project folder, so the folder is simply where it is.
cd "$(dirname "$0")"

printf '\n  Cook Book — starting on this Mac\n\n'

if [ ! -d node_modules ]; then
  echo "  First run: installing what it needs (a minute or two)…"
  npm install --silent
fi

# Ollama reads the recipes. Start it if it is not already up.
if ! curl -s -o /dev/null --max-time 2 http://localhost:11434/api/tags; then
  echo "  Starting Ollama…"
  launchctl load ~/Library/LaunchAgents/com.cookbook.ollama.plist 2>/dev/null || true
  for _ in $(seq 1 20); do
    curl -s -o /dev/null --max-time 1 http://localhost:11434/api/tags && break
    sleep 1
  done
fi

if curl -s --max-time 2 http://localhost:11434/api/tags | grep -q '"name"'; then
  echo "  Ollama is ready."
else
  echo "  Ollama is not answering — importing from a screenshot will not work."
  echo "  Everything else will."
fi

printf '\n  Opening http://localhost:5175\n'
printf '  Close this window when you have finished.\n\n'

(sleep 3 && open "http://localhost:5175/#/import") &
npm run dev

#!/bin/bash
# Double-click this to run Cook Book on this Mac.
#
# Reading recipes with a model only works from a local copy: browsers do not
# let a page served over the internet talk to a program on your own machine.
# Everything else works either way.
#
# Leave the Terminal window open while you use it. Close it when you are done.

cd "$(dirname "$0")/.." || exit 1

echo "Starting Cook Book…"
[ -d node_modules ] || npm install

# Make sure Ollama is up, so importing works the moment the page opens.
if ! curl -s -o /dev/null http://localhost:11434/api/tags; then
  echo "Starting Ollama…"
  launchctl load ~/Library/LaunchAgents/com.cookbook.ollama.plist 2>/dev/null
fi

(sleep 3 && open "http://localhost:5175") &
npm run dev

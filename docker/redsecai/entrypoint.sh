#!/bin/sh
set -eu

MODEL="${OLLAMA_MODEL:-qwen3.5:4b}"
AUTO_PULL="${OLLAMA_AUTO_PULL:-true}"
export OLLAMA_HOST="${OLLAMA_HOST:-0.0.0.0:11434}"

ollama serve &
SERVER_PID="$!"

until ollama list >/dev/null 2>&1; do
  sleep 1
done

if [ "$AUTO_PULL" != "false" ] && ! ollama list | awk '{print $1}' | grep -qx "$MODEL"; then
  if ! ollama pull "$MODEL"; then
    echo "RedSecAI warning: failed to pull model '$MODEL'. Ollama will stay running; install the model later with docker compose exec redsecai ollama pull '$MODEL'." >&2
  fi
fi

wait "$SERVER_PID"

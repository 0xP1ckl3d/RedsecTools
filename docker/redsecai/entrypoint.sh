#!/bin/sh
set -eu

MODEL="${OLLAMA_MODEL:-qwen2.5:3b-instruct}"

ollama serve &
SERVER_PID="$!"

until ollama list >/dev/null 2>&1; do
  sleep 1
done

if ! ollama list | awk '{print $1}' | grep -qx "$MODEL"; then
  ollama pull "$MODEL"
fi

wait "$SERVER_PID"

#!/bin/bash
set -euo pipefail

# download-media: Download video/audio from a URL using yt-dlp
# Usage: download-media <url>
# Outputs the absolute path of the downloaded file to stdout.

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "Usage: download-media <url>" >&2
  exit 1
fi

OUTPUT_DIR="/workspace/group/media"
mkdir -p "$OUTPUT_DIR"

# Download with mp4 preference, single video only, clean stderr
filepath=$(yt-dlp \
  -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4/best" \
  --merge-output-format mp4 \
  --no-playlist \
  --no-warnings \
  --print after_move:filepath \
  -o "${OUTPUT_DIR}/%(id)s.%(ext)s" \
  "$URL" | tail -1)

if [ -z "$filepath" ] || [ ! -f "$filepath" ]; then
  echo "Error: download failed or file not found" >&2
  exit 1
fi

echo "$filepath"

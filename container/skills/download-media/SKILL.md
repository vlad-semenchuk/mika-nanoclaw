---
name: download-media
description: Download videos from URLs (YouTube, Instagram, TikTok, Twitter/X, etc.) using yt-dlp. Use when the user shares a video link and wants to download, save, or transcribe it.
allowed-tools: Bash(download-media:*)
---

# Download Media

Download video or audio from a URL using yt-dlp. Supports YouTube, Instagram, TikTok, Twitter/X, Facebook, and 1000+ other sites.

## Usage

```bash
download-media "https://www.instagram.com/reel/abc123/"
```

The downloaded file path is printed to stdout (e.g., `/workspace/group/media/abc123.mp4`).

## Chaining with Transcription

```bash
path=$(download-media "https://www.youtube.com/watch?v=xyz")
transcribe-media "$path"
```

## When to Use

- A user shares a video link and asks to download it
- A user shares a video link and asks what it says (download then transcribe)
- A user wants to save a video from any supported site

## Limitations

- No authentication — private or age-restricted content may fail
- Output is always mp4 format
- Very long videos may use significant disk space

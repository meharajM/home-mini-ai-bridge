# Project plan

## Goal

Reuse a stock first-generation Google Home Mini as the speaker and, if possible without hardware changes, as a voice input for an open-source AI assistant. Keep the connected Mini and Android device untouched while researching and building the first proof of concept.

## Evidence and constraints

- The Mini has microphones, but its documented local API exposes setup/control functions and Bluetooth scanning, not a microphone audio stream. Community reports likewise do not show a supported stock-mic path into Home Assistant. [Google Home Local API](https://rithvikvibhu.github.io/GHLocalApi/), [Bluetooth proxy](https://github.com/spelech/ha-google-home-bt-proxy), [Home Assistant discussion](https://community.home-assistant.io/t/is-possible-to-use-a-google-mini-speaker-as-microphone-and-speaker-for-assist/836946/2)
- REA analyzes a caller-supplied firmware image. It does not acquire firmware, change Assistant endpoints, patch firmware, or install code on the speaker. REA supports Binwalk 3.1.x and Unblob 26.6.x on Linux x64, with a 128 MiB input limit. Its generated-fixture CLI/MCP verification passed in an isolated Linux VM with Binwalk 3.1.0 and Unblob 26.6.4. This is tooling verification, not Home Mini firmware verification. [REA firmware guide](https://github.com/morluto/rea/blob/main/docs/firmware-analysis.md)
- A historical Mini analysis reports 256 MiB NAND, a 90 MiB SquashFS root filesystem, ECC/OOB data, secure boot, and `dm-verity`. A raw NAND image needs correction and partition extraction before REA; the root filesystem would fit the current input cap. This is not a dump of the connected Mini's current firmware. [Firmware analysis](https://courk.cc/running-custom-code-google-home-mini-part1)
- A recent forum commenter claims OTG-based root and a firmware dump, but said a report would follow. No public instructions, source, dump, or independent reproduction have been found. Treat this only as a lead. [Community thread](https://www.reddit.com/r/googlehome/comments/1w13hd4/petition_unlock_ewaste_potential_and_release_nest/)
- Google documents voice-created notes on Home speakers. Recent community posts report changing or inconsistent note/list behavior, so the exact voice-to-Keep flow must be checked before it becomes a dependency. [Google Home notes help](https://support.google.com/googlehome/answer/16722557?hl=en-GB), [community report](https://www.reddit.com/r/googlehome/comments/1vxglqk/adding_to_list_keep_commands_no_longer_working/)
- Google's official Keep API is aimed at Workspace administration. The consumer-account option found in prior projects uses `gkeepapi` and a private mobile API; its master token grants broad account access. [Official Keep API](https://developers.google.com/workspace/keep/api/guides), [`gkeepapi` docs](https://github.com/kiwiz/gkeepapi/blob/main/docs/index.rst)

## Chosen first approach

Build a transcript-based bridge while preserving the stock device hardware and settings. Keep raw microphone access as a separate research gate:

```text
Implemented: HTTP transcript → bridge → local/remote LLM → Piper
  → temporary LAN media URL → optional Cast playback on Mini

Research gate: Mini speech → Google speech recognition → Keep
  → a supported, validated transcript connector (not implemented)
```

This can use open models for LLM and TTS. In the proposed Keep relay, Google would still handle speech recognition. The old Android device can later host a light connector or companion UI; it cannot receive raw Mini mic audio through a known supported interface. Start with a host service because it is easier to test and does not depend on Android model performance.

## Stages

1. **POC core — implemented; mock verification passed.** Accept transcript events over HTTP, call an OpenAI-compatible chat endpoint, synthesize WAV using Piper, expose temporary token-protected audio URLs, and provide optional Cast playback through PyChromecast. Playback is disabled by default. Mock tests pass. A manual LAN test also confirmed that the real Mini fetched and audibly played a short WAV; the user heard it. No settings, volume, hardware, or firmware were changed.
2. **Transcript connector.** First verify that voice-created notes reach the intended Keep account. For this personal Google account, no supported connector has been selected; `gkeepapi` remains gated by its private API and broad token access. Only after accepting and validating a viable source, add an isolated connector with stable event IDs, deduplication, bounded polling, and no automatic note deletion. Prefer the official API for Workspace; keep consumer `gkeepapi` support optional and isolate its token.
3. **Cast simulator test — completed.** The bridge control path was tested against [openchromecast](https://github.com/yukarikaname/openchromecast) in its protocol-only mode. This verifies sender-side Cast handoff, not audible output or Mini firmware behavior.
4. **End-to-end audio tests — host path completed; Mini playback completed with a fixed WAV.** A manually entered transcript and short WAV traveled through the bridge to the real Mini, and the user confirmed hearing it. The helper launches the Default Media Receiver when another Cast app is active and leaves volume/settings alone. The current hardened helper also requires the exact URL to reach `PLAYING` and then `IDLE`/`FINISHED` before releasing the next queued turn; that completion check has fake-receiver test coverage and still needs real-Mini validation. A separate host-only live test used the already-installed Ollama `gemma3:1b` model and Piper `en_US-lessac-medium`: a typed transcript produced a 262,188-byte, 5.94-second WAV. The bridge served it as `audio/wav` with `CAST_ENABLED=false`, so that test did not contact the Mini. The first cold model load exceeded the old 45-second timeout; increasing it to 120 seconds allowed the turn to finish in about 50 seconds. The 1B model added an unsupported claim about recording interactions for training, so this verifies plumbing only; review model quality before enabling device playback. A cold-load test of cached `gemma3:4b` exceeded 120 seconds on this host. Next, choose a more reliable model and measure live Mini playback, duplicate handling, TTS quality, and reliability.
5. **Android companion/host option.** After learning the Android model and OS, choose between a small status/config app, a connector service, or hosting the full bridge. Keep LLM/TTS on a LAN or remote server if the old device cannot run them comfortably.
6. **REA firmware branch.** Continue only if an independently available, versioned dump or reproducible public report appears. Preserve original image and hash; correct NAND OOB/ECC and split partitions; scan/extract with REA; analyze selected ARM ELF files in Ghidra. Map audio capture, Assistant request flow, auth, hostnames, and configuration override points. Stop if obtaining the image would require changing the connected Mini.
7. **Hardening and release — code and operations guide implemented; deployment gates open.** Hash-only durable event records suppress accepted events across restarts; turns run serially with a bounded waiting queue; strict JSON and strong LAN bearer tokens protect intake; safe errors avoid provider-detail leakage. Cast waits for confirmed playback completion and blocks later playback after an ambiguous failure until a supervised restart. CI covers Node and Python without device access. See [deployment and operations](./docs/deployment.md) for secrets, LAN firewall, startup/recovery and supervised acceptance. Host setup, selected-model evaluation, generated speech on the real Mini, transcript-source validation, and green remote CI/versioned publication still require completion before a full voice production claim.

## Reuse decisions

| Project | Decision |
|---|---|
| [REA](https://github.com/morluto/rea) | Use for static firmware analysis after obtaining a suitable image; not a runtime patcher. |
| [PyChromecast](https://github.com/home-assistant-libs/pychromecast) | Use its direct-host connection and media controller for optional WAV URL playback. Pin current release 13.1.0 in `requirements.txt`; keep the Cast adapter disabled by default. |
| [`google-home-notifier`](https://github.com/noelportugal/google-home-notifier) | Evaluated, but excluded from runtime because its old dependency tree currently reports high and critical npm audit advisories. |
| [Onju Voice v2](https://github.com/justLV/onju-v2) | Reuse backend/pipeline ideas only; its mic transport requires replacement ESP32 hardware. |
| [Google Home Bluetooth proxy](https://github.com/spelech/ha-google-home-bt-proxy) | Reference local API patterns only; it exposes BLE scan results, not audio. |
| [`gkeepapi`](https://github.com/kiwiz/gkeepapi) | Optional transcript connector; private API and powerful token make it a gated integration. |
| [MiciMike replacement PCB](https://github.com/iMike78/home-mini-v1-drop-in-pcb) | Exclude because it replaces electronics. |
| [XiaoGPT](https://github.com/yihong0618/xiaogpt) | Exclude because it targets Xiaomi speakers. |

## POC acceptance checks

- `POST /v1/turn` validates transcript size and event ID, rejects unauthenticated LAN requests, and returns a concise model answer.
- Repeated event IDs do not invoke model, TTS, or Cast twice within a process or after restart when the same persistent data directory is preserved; conflicting transcript reuse returns 409.
- Piper output is checked as bounded WAV data and served with a random expiring token.
- Cast is off by default; tests never discover or contact a speaker.
- Current limitation is stated in the UI/docs: input is recognized text, not Mini microphone audio.
- End-to-end local HTTP test sends a transcript through mocked OpenAI-compatible and Piper services, then fetches the WAV from the bridge. Cast subprocess behavior is tested with a fake process; no device is contacted.

## Current scope limits

The POC has no Keep polling, Android app, raw audio capture, or firmware patching. Live LLM/Piper output is verified on the host; live model-generated audio has not been sent to the Mini. Mini playback is verified with a separate fixed response and test WAV. A fully open raw-audio path is blocked until a reproducible non-invasive software access path exists; the current public evidence does not establish one.

## Production acceptance

[Production readiness](./docs/production-readiness-plan.md) records implemented safeguards and unresolved release gates. The supported deliverable today is the transcript-to-generated-audio LAN bridge. Personal-account voice intake, an Android companion, and raw Mini microphone access are not included.

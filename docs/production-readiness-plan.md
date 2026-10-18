# Home LAN production readiness

## Scope and constraints

This release targets one trusted home LAN and a stock Google Home Mini. The Mini must remain unmodified: no firmware changes, root, factory reset, hardware changes, or settings changes. Cast playback may interrupt current audio, so release tests must be explicitly started when the speaker is idle.

The project receives recognized text through its HTTP endpoint. It has no supported way to stream raw Mini microphone audio to Android. A personal Google account has no suitable supported Keep API identified for this relay. The community `gkeepapi` option uses a private API and a master token with full Google account access, so it must remain out of the production path unless its security and reliability tradeoffs are accepted explicitly.

## Task 1: Harden the LAN bridge — implemented

- Serialize turns so one speaker never receives overlapping playback; bound the waiting queue and reject overload clearly.
- Persist idempotency metadata in the configured data directory so a bridge restart cannot silently replay a completed event. Persist only event and transcript hashes, status, and timestamps; do not persist transcript text, model answers, audio URLs, or credentials.
- Coalesce concurrent duplicate event IDs. Reject reuse of an event ID with a different transcript. Treat interrupted/previously completed events as already handled instead of replaying audio.
- Keep LAN binding opt-in, require a strong bearer token on non-loopback interfaces, validate JSON requests, and return safe errors.
- Preserve short-lived audio URLs, bounded audio memory, and Cast-off defaults.
- Add focused tests for persistence, duplicates across restarts, queue limits/order, and LAN authentication.

## Task 2: Release and operations — implemented

- Add CI for Node and Python checks/tests.
- Document a home-LAN deployment, stable host/device addresses, firewall rules, secret handling, startup/recovery, and the explicit one-shot Cast test.
- Make the supported boundary clear: typed/recognized transcript in, generated audio out; no Mini mic stream or Android app is included.
- Document that a remote model can be called by the LAN bridge, while Cast control and the audio URL must remain reachable on the home network.
- Record unresolved production gates: reliable transcript connector for a personal Google account, model quality/latency on the chosen host, and real Mini playback of model-generated Piper audio.

## Acceptance gates before calling this production-ready

- A supported transcript source is selected and tested on the user's Google account. The private Keep connector is not considered production-ready by default.
- The selected model passes a small spoken-answer quality and latency evaluation.
- Live model-generated Piper audio is heard from the real Mini, including one cold start and one recovery test. No device configuration is changed during testing.
- The LAN host has stable addressing, restricted firewall access, protected secrets, and restart behavior.
- CI passes and a versioned source release is published.

## Current release status

Task 1 safeguards and Task 2 CI/operations documentation are implemented. Automated checks use fake services/receivers and never contact the Mini. See [deployment](./deployment.md) for the supported LAN configuration and [testing](./testing.md) for explicit supervised device checks.

Acceptance gates above remain open until measured on the intended account, model, host, and speaker. Prior evidence confirms fixed-WAV Mini playback and live model/Piper generation on the host separately; it does not confirm a complete microphone-to-model-to-Mini path. No personal Keep connector, Android app, raw Mini microphone stream, host startup service, or firmware change is included.

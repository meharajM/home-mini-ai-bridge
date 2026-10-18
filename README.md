# Home Mini AI Bridge

Software-only voice AI bridge for a stock Google Home Mini. The bridge accepts typed or externally recognized text over HTTP, calls an OpenAI-compatible chat endpoint, synthesizes speech with Piper, and can cast that audio to a Google Cast speaker.

**This does not receive microphone audio from the Mini.** No transcript connector is included; the caller supplies recognized text. A future Mini-to-Keep relay would still use Google speech recognition. A short Cast test was heard on the Mini. No settings, volume, hardware, or firmware were changed; the old Android device has not been accessed.

**Release status:** the transcript-to-audio LAN path has durable replay protection and bounded turn processing. Full voice production readiness remains gated on a personal-account transcript source, model quality/latency, supervised model-generated Mini playback, and host deployment/recovery. See [deployment and operations](./docs/deployment.md) and [acceptance gates](./docs/production-readiness-plan.md). No service is installed automatically.

## First proof of concept

Current POC path:

```text
HTTP transcript → local/remote chat model → Piper WAV → short-lived audio URL → optional Cast playback
```

Cast is disabled by default. Tests use fake model, TTS, and Cast services, so they never contact a speaker.

Requirements: Node.js 22 or newer, Python 3.10 or newer with the pinned PyChromecast dependency for playback, a running OpenAI-compatible chat server, and a running Piper HTTP server. Piper uses a separate virtual environment so its dependencies stay isolated from PyChromecast.

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run check
npm test
.venv/bin/python -m unittest discover -s python -v
cp .env.example .env
```

Example local services (all stay on this computer):

```sh
# Start Ollama with `ollama serve` if the Ollama app is not already running.
ollama pull gemma3:1b

python3 -m venv .venv-piper
.venv-piper/bin/python -m pip install 'piper-tts[http]==1.8.0' certifi
SSL_CERT_FILE="$(.venv-piper/bin/python -m certifi)" .venv-piper/bin/python -m piper.download_voices --download-dir .piper en_US-lessac-medium
.venv-piper/bin/python -m piper.http_server --host 127.0.0.1 --port 5001 --data-dir .piper -m en_US-lessac-medium
```

Copy `.env.example` to `.env`; leave `HOST=127.0.0.1` and `CAST_ENABLED=false` for this test. Start the bridge with the environment from `.env` loaded, then submit a test transcript:

```sh
set -a
. ./.env
set +a
npm start
```

In another terminal:

```sh
curl -sS http://127.0.0.1:8787/v1/turn \
  -H 'content-type: application/json' \
  -d '{"eventId":"manual-test-1","transcript":"Explain why the sky looks blue in one short sentence."}'
```

The response contains a temporary WAV URL. Fetch it on the host to verify the generated WAV; links expire after ten minutes. This loopback test does not contact any Cast device. The small `gemma3:1b` model produced an unsupported privacy claim during testing, so review responses and choose a more reliable model before enabling playback. The Mini smoke test remains a separate optional step in [docs/testing.md](./docs/testing.md).

To enable Cast later, set `HOST` to the computer's LAN IP, a randomly generated `TURN_API_TOKEN` (see `.env.example`), `CAST_ENABLED=true`, `CAST_DEVICE_IP`, and `PUBLIC_BASE_URL` to an address reachable from the speaker. `.env.example` points `PYCHROMECAST_PYTHON` at the repo-local virtual environment. Restrict inbound access to the Mini and trusted clients. Follow [deployment and operations](./docs/deployment.md) before enabling LAN use. The bridge has been exercised on the host with local Ollama and Piper while Cast stayed disabled. A separate fixed-response WAV was previously heard on the Mini.

## Turn safety and restart behavior

The bridge processes one turn at a time, including confirmed completion of Cast playback. `MAX_WAITING_TURNS` defaults to 8 additional turns; a full queue returns HTTP 429 with `Retry-After: 1` without reserving the event. Concurrent duplicates share the active/queued result. Reusing an event ID with a different trimmed transcript returns HTTP 409.

`DATA_DIR` defaults to `.data` relative to the working directory. Keep this directory across restarts and run exactly one bridge process against it. The bridge durably reserves every accepted event before model work, then stores completion or failure. Each record contains only SHA-256 event/transcript hashes, status, and timestamps; answers, transcripts, credentials, audio, and audio URLs remain outside these files. The CLI always enables disk persistence; direct `createPipeline` users must pass a disk-backed `eventStore` to enable it.

Any previously reserved event, including an interrupted or failed turn, returns HTTP 200 with `status: "already_handled"` and `playback: "skipped"`; it does not regenerate speech or return an old answer/audio URL. This favors preventing duplicate playback over automatic retries. Retry genuinely new work with a new event ID after checking what happened. Records have no automatic expiry: deleting them or changing `DATA_DIR` loses replay protection. Hashes still permit guessing predictable inputs, so protect this directory. New directories/files use owner-only permissions; existing directory permissions are preserved. Corrupt records or storage failures fail closed with a safe HTTP 502.

Cast waits for the exact generated URL to finish (up to 120 seconds after playback starts; 150-second helper deadline). If playback fails, times out, or is replaced, the bridge returns HTTP 503 and blocks later playback in that process. Check the speaker is idle before restarting the bridge. Launching Default Media Receiver retains the existing behavior and can interrupt another app. Cast remains disabled by default; audio URLs still expire after ten minutes, with at most 64 WAVs / 64 MiB held in memory.

LAN binding remains opt-in through `HOST`. Non-loopback binding requires a bearer token of at least 32 characters, at least 8 distinct characters, and no whitespace; generate a random token rather than a memorable phrase. `POST /v1/turn` requires `Content-Type: application/json`, a nonblank event ID (maximum 200 characters), and a nonblank transcript (maximum 2000 characters), within a 16 KiB body. Provider/internal errors return only `Turn failed`. Health remains public; audio requires its random short-lived URL token so the speaker can fetch it.

## Reused open-source work

- [PyChromecast](https://github.com/home-assistant-libs/pychromecast) supplies optional Cast playback to a known device IP. The Node bridge launches a small Python helper, and casting is disabled by default.
- [Piper](https://github.com/OHF-Voice/piper1-gpl) supplies local neural TTS as a separate HTTP service. Voice model licenses vary; check each model card before redistribution.
- [Ollama](https://github.com/ollama/ollama) supplies a local model server through its OpenAI-compatible chat endpoint.
- [Onju Voice v2](https://github.com/justLV/onju-v2) informs the provider-separated ASR/LLM/TTS design. Its device audio client uses replacement ESP32 hardware and is not used here.
- [`gkeepapi`](https://github.com/kiwiz/gkeepapi) is a possible future transcript connector for consumer Google accounts, but it uses a private Keep API and broad Google account tokens. It is not enabled in the POC.

See [PLAN.md](./PLAN.md) for research findings, project stages, and decision gates.
See [docs/testing.md](./docs/testing.md) for simulator and safe Mini playback procedures.

CI runs Node syntax/tests and Python compile/fake-receiver tests on every push and pull request, without speaker access. Successful CI verifies software behavior, not real-device audio or transcript-source compatibility.

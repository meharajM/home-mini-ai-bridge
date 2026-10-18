# Home Mini AI Bridge

Software-only voice AI bridge for a stock Google Home Mini. First proof of concept accepts recognized text over HTTP, calls an OpenAI-compatible chat endpoint, synthesizes speech with Piper, and can cast that audio to a Google Cast speaker.

**This does not receive microphone audio from the Mini.** In this mode, Google handles speech recognition; the project handles the model and speech output. A short Cast test was heard on the Mini. No settings, volume, hardware, or firmware were changed; the old Android device has not been accessed.

## First proof of concept

Current POC path:

```text
HTTP transcript → local/remote chat model → Piper WAV → short-lived audio URL → optional Cast playback
```

Cast is disabled by default. Tests use fake model, TTS, and Cast services, so they never contact a speaker.

Requirements: Node.js 22 or newer, Python 3.10 or newer with the pinned PyChromecast dependency for playback, a running OpenAI-compatible chat server, and a running Piper HTTP server. Piper uses a separate virtual environment so its dependencies stay isolated from PyChromecast.

```sh
npm install
npm run check
npm test
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
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

To enable Cast later, set `HOST=0.0.0.0`, `TURN_API_TOKEN`, `CAST_ENABLED=true`, `CAST_DEVICE_IP`, and `PUBLIC_BASE_URL` to an address reachable from the speaker. `.env.example` points `PYCHROMECAST_PYTHON` at the repo-local virtual environment. This exposes the POC API to the LAN; keep it on a trusted network. The bridge has been exercised on the host with local Ollama and Piper while Cast stayed disabled. A separate fixed-response WAV was previously heard on the Mini.

## Reused open-source work

- [PyChromecast](https://github.com/home-assistant-libs/pychromecast) supplies optional Cast playback to a known device IP. The Node bridge launches a small Python helper, and casting is disabled by default.
- [Piper](https://github.com/OHF-Voice/piper1-gpl) supplies local neural TTS as a separate HTTP service. Voice model licenses vary; check each model card before redistribution.
- [Ollama](https://github.com/ollama/ollama) supplies a local model server through its OpenAI-compatible chat endpoint.
- [Onju Voice v2](https://github.com/justLV/onju-v2) informs the provider-separated ASR/LLM/TTS design. Its device audio client uses replacement ESP32 hardware and is not used here.
- [`gkeepapi`](https://github.com/kiwiz/gkeepapi) is a possible future transcript connector for consumer Google accounts, but it uses a private Keep API and broad Google account tokens. It is not enabled in the POC.

See [PLAN.md](./PLAN.md) for research findings, project stages, and decision gates.
See [docs/testing.md](./docs/testing.md) for simulator and safe Mini playback procedures.

# Home LAN deployment and operations

## Supported release boundary

The bridge accepts typed or externally recognized text at `POST /v1/turn`, generates an answer through an OpenAI-compatible model endpoint, synthesizes it through Piper, and optionally plays its WAV on one stock Mini. It includes no Mini microphone stream, Keep connector, or Android app. Google speech recognition is outside this service. See [production readiness](./production-readiness-plan.md) for gates still open before an unattended voice product can be called production-ready.

```text
Trusted transcript client → LAN bridge → local or HTTPS remote model
                                  ↓
                              local Piper
                                  ↓
                    temporary LAN WAV URL ← Mini fetches
                                  ↓
                       Mini via Cast TCP 8009
```

Keep the bridge on a home LAN host even when the model runs remotely: set `LLM_BASE_URL` to that server's OpenAI-compatible `/v1` base, `LLM_MODEL` to its model ID, and `LLM_API_KEY` only if required. Use HTTPS for a remote provider. The provider receives transcripts and the system prompt; its policies determine remote retention. Cast control still originates from the LAN bridge and `PUBLIC_BASE_URL` must remain reachable by the Mini. A remote server alone cannot reach a private Mini through an ordinary home router. No inbound Internet exposure or router port-forward is needed.

## Prepare the host

Use Node.js 22 or newer, Python 3.10 or newer, and the pinned dependencies from the repository. Run `npm ci`, create `.venv`, install `requirements.txt`, and follow [README](../README.md) for the separate Piper environment and local model. Review model and voice licenses before redistribution. The included small example model is a plumbing baseline, not a validated production model.

1. Reserve the host and Mini addresses in the router's DHCP configuration. Read the Mini address from the existing Google Home app or router; do not reconfigure the speaker. Avoid guest/client isolation between these devices. Prefer a specific host LAN address over `0.0.0.0`.
2. Run one bridge process as an unprivileged host user, from a fixed repository directory. Use a fixed absolute `DATA_DIR` on persistent local storage and an absolute `PYCHROMECAST_PYTHON` path. Multiple processes sharing a data directory are unsupported; separate directories do not serialize access to the same speaker either.
3. Copy `.env.example` to `.env`, restrict it to its owner (`chmod 600 .env`), and generate `TURN_API_TOKEN` using the command in that template. Keep `.env`, provider keys, `.data`, and audio URLs out of Git, support logs, and shared screenshots. This shell-loaded file is trusted executable shell input; never load an untrusted copy. Existing data-directory permissions are preserved, so restrict them yourself when reusing a directory.
4. Start with `HOST=127.0.0.1` and `CAST_ENABLED=false`. Run the no-device tests and live local model/Piper check from [testing](./testing.md). Fetch and listen to the generated WAV on the host. Only then perform the explicit one-turn Mini test.

Example LAN configuration after the no-device check (replace every example address/path):

```dotenv
HOST=192.168.1.20
PORT=8787
PUBLIC_BASE_URL=http://192.168.1.20:8787
CAST_ENABLED=false
CAST_DEVICE_IP=192.168.1.30
PYCHROMECAST_PYTHON=/absolute/path/home-mini-ai-bridge/.venv/bin/python
DATA_DIR=/absolute/path/home-mini-ai-bridge/.data
```

Keep your generated `TURN_API_TOKEN` and model/Piper settings in the same `.env`. The service does not load `.env` automatically. From the fixed repository directory, load it and start the bridge:

```sh
set -a
. ./.env
set +a
npm start
```

## Network rules and secrets

| Flow | Required access |
|---|---|
| Trusted transcript client → host | TCP 8787, or the chosen `PORT`; bearer token required for `/v1/turn` |
| Mini → host | TCP 8787 for temporary audio URLs |
| Host → Mini | TCP 8009 for direct-IP Cast control |
| Bridge → local model/Piper | Loopback 11434/5001 for the example setup |
| Bridge → remote model | Outbound HTTPS 443, if selected |

Restrict inbound bridge access to the Mini and approved transcript clients using the host firewall. Leave model and Piper bound to loopback when they run on the same host; do not open their ports to the LAN unnecessarily. Direct-IP Cast needs no discovery scan or new multicast rule. Existing Google services may still need the Mini's normal network access.

The basic bridge serves HTTP. Bearer tokens, transcripts, model responses, and WAVs can be observed by parties able to inspect that traffic. Use only a trusted private LAN; use a properly configured HTTPS gateway or VPN before accepting clients across an untrusted network. Keep the audio URL reachable by the Mini and avoid putting the bearer token into it. `/health` is public liveness only: it does not prove model, TTS, disk, or Mini readiness. Random audio URLs are bearer capabilities until expiry and need no API Authorization header because the Mini fetches them directly.

## Start, stop, and recover

Start the model and Piper before the bridge. Configure the host's service manager with the fixed working directory, absolute executables, protected environment, and a single instance. Verify boot behavior first with Cast disabled. Keep automatic bridge restart disabled until the speaker's idle state and recovery have been tested; automatic restarts can clear the process-level Cast failure lockout while audio is still playing. The repository does not install a system service or change host startup settings.

Stop intake at the transcript client, allow the active turn and queue to finish, then stop the bridge. Stopping during a turn may leave playback running. Before any restart after an interruption or Cast error, check the Mini is idle; do not retry audio automatically. Then restart dependencies if needed and restart exactly one bridge instance. Persistent records suppress already reserved events, including failed/interrupted turns. HTTP 200 `already_handled` confirms suppression, not successful prior audio. A new event ID means new work and may speak again.

| Symptom | Recovery |
|---|---|
| HTTP 429 | Queue full; retain the same event ID and retry after `Retry-After`. The rejected event was not reserved. |
| HTTP 409 | Event ID reused with different trimmed text; fix the client's event identity rather than blindly changing IDs. |
| HTTP 502 | Model/TTS/storage failure; check dependency health and data access locally. Failed accepted events remain suppressed. |
| HTTP 503 after Cast error | Pause intake; verify speaker idle and network reachability, then restart the bridge. Later playback stays blocked until restart. |
| Missing audio after restart | Audio is memory-only and URLs expire after ten minutes. Do not replay old events just to recreate a URL. |

Back up `.data` as private state with the bridge stopped; restore it before starting the same installation. Do not delete records, switch `DATA_DIR`, or restore an older snapshot without accepting that replay protection can be lost. Hash records accumulate without automatic expiry; monitor disk usage. No transcripts or answers are stored there, but hashes of predictable inputs can be guessed. Preserve the environment/voice/model version separately without committing credentials.

## Release and readiness checklist

- CI runs syntax checks, Node mock/integration tests, and Python fake-receiver tests on supported runtimes. CI contacts no Mini and requires no Google credentials. It does not test actual model or speaker behavior.
- Run a short local quality set (ordinary questions, uncertainty, privacy claims, and malformed input). Record selected model/voice versions, cold/warm latency, and answer quality; the current example model has known quality concerns.
- Follow the [one-shot Mini procedure](./testing.md#4-short-mini-playback-test) only while the speaker is idle. Confirm model-generated Piper speech by listening, then test a cold host start and one recovery with a new reviewed event. Keep Cast disabled between supervised tests.
- Verify stable addressing, firewall restrictions, secret/data permissions, one-process startup, disk capacity, and interrupted-turn recovery on the intended host.
- Choose and validate a supported transcript source for the personal Google account. Google's [official Keep API](https://developers.google.com/workspace/keep/api/guides) is Workspace-oriented; [`gkeepapi`](https://github.com/kiwiz/gkeepapi/blob/main/docs/index.rst) uses an unofficial private API and a master token with broad account access. No connector is implemented or enabled. Its credential and reliability tradeoffs remain a separate decision.
- Publish versioned source only after review and green CI. A source release does not close the account, model-quality, or device acceptance gates.

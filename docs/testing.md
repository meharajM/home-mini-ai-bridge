# Safe testing

The bridge has four distinct test targets. Start with the no-device checks; enable Mini playback only when you are ready for a short audio interruption.

| Test | What it verifies | Needs the Mini? |
|---|---|---|
| Automated mock test | Transcript validation, model/TTS orchestration, WAV URL serving, and Cast-adapter invocation | No |
| Live local model and TTS | Actual local LLM response, Piper synthesis, and bridge WAV serving | No |
| Software Cast receiver | Cast V2 connection and media handoff; with a local player, audible output on the computer | No |
| Mini smoke test | The real Mini reports the requested WAV URL as playing; listening confirms audible output | Yes; temporary playback only |

## 1. Run the no-device tests

From the repository root:

```sh
npm run check
npm test
```

The end-to-end test uses local fake model and Piper endpoints. The Cast adapter test substitutes a fake child process, so these tests never scan the network or contact any Cast receiver.

## 2. Live local model and TTS test (no device)

This exercises the actual model and Piper services on the computer. Keep `HOST=127.0.0.1` and `CAST_ENABLED=false` in `.env`; the bridge then has no Cast path to the Mini.

Start Ollama if its desktop app is not already running, then pull the model configured by `LLM_MODEL`:

```sh
ollama serve
ollama pull gemma3:1b
```

In another terminal, start Piper with a local voice:

```sh
python3 -m venv .venv-piper
.venv-piper/bin/python -m pip install 'piper-tts[http]==1.8.0' certifi
SSL_CERT_FILE="$(.venv-piper/bin/python -m certifi)" .venv-piper/bin/python -m piper.download_voices --download-dir .piper en_US-lessac-medium
.venv-piper/bin/python -m piper.http_server --host 127.0.0.1 --port 5001 --data-dir .piper -m en_US-lessac-medium
```

With `.env` loaded, start the bridge and post a typed transcript to `http://127.0.0.1:8787/v1/turn`. Fetch the returned `audioUrl` from the same computer and confirm it is a WAV file. Neither the transcript nor the WAV is sent to a Cast device. The Piper provider validates WAV bytes because Piper's Flask server labels its binary WAV response as `text/html`. On this host, the first Ollama model load took about 50 seconds, within the bridge's 120-second chat timeout. The 1B model generated an unsupported privacy claim, so this confirms integration only; review model output before any device playback.

## 3. Optional software Cast receiver

[openchromecast](https://github.com/yukarikaname/openchromecast) is an independent Cast V2 receiver emulator. Its README reports the audio flinging path verified with PyChromecast, which makes it a closer fit for this bridge than a receiver-app emulator. It is an evolving project, and its documentation lists other senders and some playback cases as untested. It also advertises itself over mDNS, so run it only on a trusted network and give it a distinct name.

Build and run it separately from this repository. Rust is required; audible output on the computer also requires `mpv`:

```sh
git clone https://github.com/yukarikaname/openchromecast.git
cd openchromecast
cargo run --release -- --friendly-name "Mini AI Bridge Simulator"
```

For protocol-only work without computer audio, its documented `--player none -v` mode avoids starting a media player. That mode does not verify audible WAV playback.

To point this bridge at the emulator, configure `CAST_DEVICE_IP` with the emulator host address, enable Cast, and set `PUBLIC_BASE_URL` to an address the emulator can fetch. If both processes run on the same computer, try loopback only if the emulator accepts connections there; otherwise use the computer's LAN address. A LAN address makes the media URL reachable from both processes and can expose the emulator to other devices on that Wi-Fi. Do not use real Google account credentials or change any Mini settings for this test.

The emulator proves the Cast sender and media handoff against that implementation. It does not emulate the Mini's microphones, Assistant, Google speech recognition, Google Keep, or Mini-specific firmware behavior. Google's `chromecast-device-emulator` project instead emulates the receiver-side browser/IPC context for custom receiver apps, so it is not a direct target for this sender bridge.

## 4. Short Mini playback test

This test sends one manually typed transcript. The Mini supplies no microphone audio in the current POC.

1. First run the model and Piper locally and test the transcript endpoint while `CAST_ENABLED=false`. Fetch the returned WAV URL on the computer and confirm it plays.
2. Find the Mini's current IP in the Google Home app or router. Keep the computer and Mini on the same Wi-Fi; Google's Cast guidance requires the sender and receiver to share a Wi-Fi network.
3. Set `HOST` to the computer's LAN IP, `TURN_API_TOKEN` to a temporary secret, `CAST_ENABLED=true`, and `CAST_DEVICE_IP` to the Mini's IP. Set `PUBLIC_BASE_URL` to `http://<computer-lan-ip>:8787` so the Mini can fetch the WAV. Keep the network port private to the LAN; do not create a router port-forward.
4. Restart the bridge and submit one short transcript with the bearer token:

```sh
curl -sS "http://<computer-lan-ip>:8787/v1/turn" \
  -H "authorization: Bearer $TURN_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"eventId":"mini-smoke-1","transcript":"Say hello in one short sentence."}'
```

5. Listen for the response, then stop the bridge and turn `CAST_ENABLED` back off. If another Cast app is active, the helper launches the Default Media Receiver first. It then waits for the receiver to report the exact WAV URL as `PLAYING`; a Cast session being active alone does not count as success. That status still cannot prove sound reached the room, so confirm by listening.

This starts a normal temporary Cast playback session; it does not reset, reconfigure, or install anything on the Mini. It can interrupt whatever audio is currently playing, so only run it when that is okay. The current Cast helper does not change the speaker volume.

Google's troubleshooting guidance recommends the same Wi-Fi and notes that client/AP isolation or blocked multicast can prevent discovery. This bridge connects to a configured IP directly, but the Cast control port and the HTTP audio URL still need to be reachable from the speaker.

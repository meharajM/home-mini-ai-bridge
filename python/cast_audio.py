#!/usr/bin/env python3
"""Play one HTTP(S) WAV URL on a Google Cast device at a known IP."""

import ipaddress
import sys
import time
import uuid
from urllib.parse import urlparse

import pychromecast
from pychromecast.controllers.media import MediaStatusListener


class PlaybackListener(MediaStatusListener):
    """Remember receiver load failures while waiting for media status."""

    def __init__(self) -> None:
        self.load_error: int | None = None

    def new_media_status(self, status) -> None:
        pass

    def load_media_failed(self, item: int, error_code: int) -> None:
        self.load_error = error_code


def ensure_default_media_receiver(cast, timeout: float = 10) -> None:
    """Switch away from an unrelated receiver app before sending a media load."""
    receiver_app_id = pychromecast.APP_MEDIA_RECEIVER
    if cast.status.app_id == receiver_app_id:
        return

    cast.start_app(receiver_app_id)
    deadline = time.monotonic() + timeout
    while True:
        if cast.status.app_id == receiver_app_id:
            return

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Cast device did not launch the Default Media Receiver")
        time.sleep(min(0.25, remaining))


def wait_until_playing(media, expected_url: str, listener: PlaybackListener, timeout: float = 20) -> None:
    """Wait until the receiver reports this URL as playing, not just an active session."""
    deadline = time.monotonic() + timeout
    while True:
        if listener.load_error is not None:
            raise RuntimeError(f"Cast receiver rejected media (error {listener.load_error})")

        media.update_status()
        status = media.status
        if status.content_id == expected_url and status.player_state == "PLAYING":
            return
        if status.content_id == expected_url and status.idle_reason == "ERROR":
            raise RuntimeError("Cast receiver reported an audio load error")

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Cast receiver never reported the requested audio as PLAYING")
        time.sleep(min(0.25, remaining))


def wait_until_finished(media, expected_url: str, listener: PlaybackListener, timeout: float = 120) -> None:
    """Do not release the next turn until this exact URL finishes."""
    deadline = time.monotonic() + timeout
    while True:
        if listener.load_error is not None:
            raise RuntimeError("Cast receiver rejected media")
        media.update_status()
        status = media.status
        if status.content_id != expected_url:
            raise RuntimeError("Cast playback was replaced before completion")
        if status.player_state == "IDLE":
            if status.idle_reason == "FINISHED":
                return
            raise RuntimeError("Cast playback ended without confirmed completion")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Cast receiver never confirmed playback completion")
        time.sleep(min(0.25, remaining))


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: cast_audio.py DEVICE_IP AUDIO_URL", file=sys.stderr)
        return 2

    device_ip, audio_url = sys.argv[1:]
    try:
        ipaddress.ip_address(device_ip)
        parsed_url = urlparse(audio_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc or parsed_url.username:
            raise ValueError("expected an absolute HTTP(S) URL without credentials")
    except ValueError as error:
        print(f"Invalid Cast target or media URL: {error}", file=sys.stderr)
        return 2

    cast = None
    try:
        cast = pychromecast.get_chromecast_from_host(
            (device_ip, 8009, uuid.uuid4(), None, None),
            tries=1,
            retry_wait=0.5,
            timeout=5,
        )
        cast.wait(timeout=10)
        ensure_default_media_receiver(cast)
        media = cast.media_controller
        listener = PlaybackListener()
        media.register_status_listener(listener)
        media.play_media(audio_url, "audio/wav")
        wait_until_playing(media, audio_url, listener)
        wait_until_finished(media, audio_url, listener)
        return 0
    except Exception as error:  # The CLI reports a concise error to its caller.
        print(f"Cast playback failed: {type(error).__name__}", file=sys.stderr)
        return 1
    finally:
        if cast is not None:
            cast.disconnect(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())

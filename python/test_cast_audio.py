import unittest
from types import SimpleNamespace

from python.cast_audio import PlaybackListener, ensure_default_media_receiver, wait_until_playing


class FakeMedia:
    def __init__(self, status):
        self.status = status
        self.update_count = 0

    def update_status(self):
        self.update_count += 1


class FakeCast:
    def __init__(self, app_id):
        self.status = SimpleNamespace(app_id=app_id)
        self.started_apps = []

    def start_app(self, app_id):
        self.started_apps.append(app_id)
        self.status.app_id = app_id


class CastPlaybackWaitTests(unittest.TestCase):
    def test_launches_default_media_receiver_when_another_app_is_active(self):
        import pychromecast

        cast = FakeCast("89EA58C1")

        ensure_default_media_receiver(cast, timeout=0.1)

        self.assertEqual(cast.started_apps, [pychromecast.APP_MEDIA_RECEIVER])

    def test_keeps_default_media_receiver_when_already_active(self):
        import pychromecast

        cast = FakeCast(pychromecast.APP_MEDIA_RECEIVER)

        ensure_default_media_receiver(cast, timeout=0.1)

        self.assertEqual(cast.started_apps, [])

    def test_requires_the_requested_url_to_be_playing(self):
        media = FakeMedia(SimpleNamespace(content_id="http://mini/audio.wav", player_state="PLAYING", idle_reason=None))

        wait_until_playing(media, "http://mini/audio.wav", PlaybackListener(), timeout=0.1)

        self.assertEqual(media.update_count, 1)

    def test_does_not_treat_another_active_session_as_success(self):
        media = FakeMedia(SimpleNamespace(content_id="", player_state="PLAYING", idle_reason=None))

        with self.assertRaisesRegex(TimeoutError, "requested audio as PLAYING"):
            wait_until_playing(media, "http://mini/audio.wav", PlaybackListener(), timeout=0.01)

    def test_reports_receiver_load_failure(self):
        listener = PlaybackListener()
        listener.load_media_failed(item=0, error_code=104)
        media = FakeMedia(SimpleNamespace(content_id="", player_state="UNKNOWN", idle_reason=None))

        with self.assertRaisesRegex(RuntimeError, "error 104"):
            wait_until_playing(media, "http://mini/audio.wav", listener, timeout=0.1)


if __name__ == "__main__":
    unittest.main()

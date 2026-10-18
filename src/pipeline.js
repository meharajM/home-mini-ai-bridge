import { createEventStore, hash } from "./event-store.js";
import { RequestError } from "./errors.js";

export function createPipeline({ respond, synthesize, audioStore, castEnabled = false, playAudio,
  eventStore = createEventStore(), maxWaiting = 8 }) {
  if (!Number.isInteger(maxWaiting) || maxWaiting < 0) throw new Error("maxWaiting must be a non-negative integer");
  const events = new Map();
  const queue = [];
  let active = false;
  let playbackBlocked = false;

  async function drain() {
    if (active || !queue.length) return;
    active = true;
    const { eventId, transcript, record, resolve, reject } = queue.shift();
    try {
      if (playbackBlocked) throw new RequestError(503, "Playback state is uncertain; check speaker before restarting bridge");
      const answer = await respond(transcript);
      const audio = await synthesize(answer);
      const published = audioStore.publish(audio);
      let playback = "disabled";
      if (castEnabled) {
        try {
          await playAudio(published.url);
          playback = "cast";
        } catch {
          playbackBlocked = true;
          throw new RequestError(503, "Playback state is uncertain; check speaker before restarting bridge");
        }
      }
      eventStore.set({ ...record, status: "completed", updatedAt: Date.now() });
      resolve({ eventId, answer, audioUrl: published.url, playback });
    } catch (error) {
      try { eventStore.set({ ...record, status: "failed", updatedAt: Date.now() }); }
      catch { /* Pending metadata still prevents replay if recording failure fails. */ }
      reject(error);
    } finally {
      events.delete(record.eventHash);
      active = false;
      void drain();
    }
  }

  async function processTurn({ eventId, transcript }) {
    const eventHash = hash(eventId);
    const transcriptHash = hash(transcript);
    const previous = eventStore.get(eventHash);
    if (previous && previous.transcriptHash !== transcriptHash) {
      throw new RequestError(409, "eventId was already used with a different transcript");
    }
    if (events.has(eventHash)) return events.get(eventHash);
    if (previous) return { eventId, status: "already_handled", playback: "skipped" };
    if (playbackBlocked) throw new RequestError(503, "Playback state is uncertain; check speaker before restarting bridge");
    if (active && queue.length >= maxWaiting) throw new RequestError(429, "Turn queue is full; retry later");

    const now = Date.now();
    const record = { eventHash, transcriptHash, status: "pending", createdAt: now, updatedAt: now };
    eventStore.set(record);
    const pending = new Promise((resolve, reject) => queue.push({ eventId, transcript, record, resolve, reject }));
    events.set(eventHash, pending);
    void drain();
    return pending;
  }

  return { processTurn };
}

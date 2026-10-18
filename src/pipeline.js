export function createPipeline({ respond, synthesize, audioStore, castEnabled = false, playAudio }) {
  const events = new Map();

  async function processTurn({ eventId, transcript }) {
    if (events.has(eventId)) return events.get(eventId);

    const pending = (async () => {
      const answer = await respond(transcript);
      const audio = await synthesize(answer);
      const published = audioStore.publish(audio);
      const playback = castEnabled
        ? await playAudio(published.url).then(() => "cast")
        : "disabled";
      return {
        eventId,
        answer,
        audioUrl: published.url,
        playback,
      };
    })();

    events.set(eventId, pending);
    if (events.size > 1000) events.delete(events.keys().next().value);
    try {
      return await pending;
    } catch (error) {
      events.delete(eventId);
      throw error;
    }
  }

  return { processTurn };
}

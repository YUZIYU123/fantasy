export type ReadingFactEnvelope = Record<string, unknown>;

type QueuedFact = { key: string; body: ReadingFactEnvelope };

export class ReadingFactOutbox {
  private readonly queue: QueuedFact[] = [];
  private sending = false;

  enqueue(key: string, body: ReadingFactEnvelope) {
    if (this.queue.some((fact) => fact.key === key)) return;
    this.queue.push({ key, body });
  }

  get pending() { return this.queue.length; }

  async flush(send: (body: ReadingFactEnvelope) => Promise<Response>) {
    if (this.sending || this.queue.length === 0) return false;
    this.sending = true;
    const fact = this.queue[0];
    try {
      const response = await send(fact.body);
      if (!response.ok) return false;
      if (this.queue[0] === fact) this.queue.shift();
      return true;
    } catch {
      return false;
    } finally {
      this.sending = false;
    }
  }
}

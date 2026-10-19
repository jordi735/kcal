// Controlled domain failures, independent of reads, writes, or HTTP adapters.
export class WriteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'WriteError';
  }
}

/** Sending can never succeed (bad template, rejected recipient). Not retried. */
export class PermanentMailError extends Error {
  readonly permanent = true;

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PermanentMailError';
  }
}

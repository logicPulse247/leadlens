/** Framework-agnostic error raised by services; route handlers translate it to an HTTP response. */
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

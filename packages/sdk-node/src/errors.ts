export class ApiError extends Error {
  public readonly status: number;
  public readonly code: number;
  public readonly body: unknown;

  constructor(message: string, status: number, code = -1, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}

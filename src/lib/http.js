// An error with an HTTP status. Services throw it; errorHandler sends it as
// { error: message, ...extra }.
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export { HttpError };

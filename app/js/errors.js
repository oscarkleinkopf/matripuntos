export class MpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MpError";
    this.code = code;
  }
}

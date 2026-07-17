export class SmartWatchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SmartWatchError";
    this.code = code;
  }
}

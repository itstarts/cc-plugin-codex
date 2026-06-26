export const ERROR_CODES = Object.freeze({
  MISSING_CLI: "missing_cli",
  AUTH_REQUIRED: "auth_required",
  INVALID_JSON: "invalid_json",
  JOB_NOT_FOUND: "job_not_found",
  TRANSCRIPT_UNAVAILABLE: "transcript_unavailable",
  NONZERO_EXIT: "nonzero_exit",
  TIMEOUT: "timeout",
});

export function makeError(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

export function makeOk(payload = {}) {
  return { ok: true, ...payload };
}

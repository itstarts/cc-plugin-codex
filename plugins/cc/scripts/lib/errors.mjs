export const ERROR_CODES = Object.freeze({
  MISSING_CLI: "missing_cli",
  AUTH_REQUIRED: "auth_required",
  CONFIG_ERROR: "config_error",
  INVALID_JSON: "invalid_json",
  TEMPLATE_ERROR: "template_error",
  INVALID_ARGS: "invalid_args",
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

const attendanceConfig = window.AMSA_CONFIG || {};
const attendanceForm = document.querySelector("#attendanceForm");
const attendanceStatus = document.querySelector("#attendanceStatus");
const attendanceCode = document.querySelector("#attendanceCode");
const attendanceEventId = document.body?.dataset.eventId || "";

const codeFromLink = new URLSearchParams(window.location.search).get("code");
if (codeFromLink) {
  attendanceCode.value = codeFromLink.trim().toUpperCase();
}

function setAttendanceStatus(message, type = "") {
  attendanceStatus.textContent = message;
  attendanceStatus.className = `status${type ? ` is-${type}` : ""}`;
}

const attendanceSubmissionLimitMs = 25000;
const attendanceRequestLimitMs = 8000;
let attendanceSubmitting = false;

function attendanceConfirmationTimeout() {
  const error = new Error("We couldn’t confirm your check-in within 25 seconds. It may already be saved. Your details are still here—try again, or ask an officer to add your attendance manually. Retrying won’t count twice.");
  error.name = "AttendanceConfirmationTimeoutError";
  error.retryable = false;
  return error;
}

async function requestAttendance(payload, submissionSignal) {
  const controller = new AbortController();
  const params = new URLSearchParams({
    action: "attendance",
    fullName: payload.fullName,
    email: payload.email,
    eventCode: payload.eventCode,
    eventId: payload.eventId || ""
  });
  let timer;
  let onAbort;
  const deadline = new Promise((resolve, reject) => {
    timer = window.setTimeout(() => {
      controller.abort();
      const error = new Error("Attendance confirmation timed out.");
      error.retryable = true;
      reject(error);
    }, attendanceRequestLimitMs);
    onAbort = () => { controller.abort(); reject(attendanceConfirmationTimeout()); };
    if (submissionSignal?.aborted) onAbort();
    else submissionSignal?.addEventListener("abort", onAbort, { once: true });
  });

  const request = (async () => {
    const response = await fetch(`${attendanceConfig.googleScriptUrl}?${params.toString()}`, {
      method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error("Attendance service could not be reached.");
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    try {
      const result = await response.json();
      if (!result || typeof result.ok !== "boolean") throw new Error("Invalid service response");
      return result;
    } catch {
      // Quota/sign-in pages are HTML, not a check-in acknowledgement.
      const error = new Error("Attendance is temporarily busy.");
      error.retryable = true;
      throw error;
    }
  })();

  try {
    // A stalled response body must not leave the submit button spinning forever.
    return await Promise.race([request, deadline]);
  } finally {
    window.clearTimeout(timer);
    submissionSignal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

function isRetryableAttendanceError(error) {
  if (error.retryable === false) return false;
  return error.retryable || error.name === "TypeError" || error.name === "AbortError" ||
    /busy|lock|temporarily|timed out|could not be reached/i.test(error.message || "");
}

function waitForAttendanceRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(attendanceConfirmationTimeout()); return; }
    const onAbort = () => { window.clearTimeout(timer); reject(attendanceConfirmationTimeout()); };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort); resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function performAttendanceSubmission(payload, signal) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal.aborted) throw attendanceConfirmationTimeout();
    try {
      const response = await requestAttendance(payload, signal);
      if (response && !response.ok && (response.retryable || /busy|lock|temporarily/i.test(response.error || ""))) {
        const error = new Error("Attendance is temporarily busy.");
        error.retryable = true;
        throw error;
      }
      return response;
    } catch (error) {
      if (signal.aborted) throw attendanceConfirmationTimeout();
      if (!isRetryableAttendanceError(error) || attempt === 3) throw error;
      setAttendanceStatus(`Waiting for the attendance service. Retrying (${attempt + 2} of 4)… Your details are kept here.`);
      await waitForAttendanceRetry(Math.min(4000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 2500), signal);
    }
  }
}

async function submitAttendance(payload) {
  if (window.navigator?.onLine === false) {
    const error = new Error("You’re offline. Reconnect and submit again; your details are still here.");
    error.retryable = false;
    throw error;
  }
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = window.setTimeout(() => { controller.abort(); reject(attendanceConfirmationTimeout()); }, attendanceSubmissionLimitMs);
  });
  try {
    // The TOTAL deadline includes every request, response body, and retry delay.
    return await Promise.race([performAttendanceSubmission(payload, controller.signal), deadline]);
  } finally {
    window.clearTimeout(timer);
    controller.abort();
  }
}

attendanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (attendanceSubmitting) return;

  if (!attendanceForm.checkValidity()) {
    attendanceForm.reportValidity();
    return;
  }

  const data = new FormData(attendanceForm);
  const payload = {
    fullName: String(data.get("fullName") || "").trim(),
    email: String(data.get("email") || "").trim().toLowerCase(),
    eventCode: String(data.get("eventCode") || "").trim().toUpperCase(),
    eventId: attendanceEventId
  };

  if (!/^[A-Za-z0-9._%+-]+@nyu\.edu$/.test(payload.email)) {
    setAttendanceStatus("Please use your NYU email address.", "error");
    return;
  }

  const button = attendanceForm.querySelector("button");
  attendanceSubmitting = true;
  button.disabled = true;
  setAttendanceStatus("Sending your check-in…");
  const progressTimer = window.setTimeout(() => {
    if (attendanceSubmitting) setAttendanceStatus("Still waiting for confirmation from the attendance service. Your details are kept here; this attempt will stop within 25 seconds.");
  }, 5000);

  try {
    if (!attendanceConfig.googleScriptUrl) {
      setAttendanceStatus(
        "Attendance is in demo mode. Add the Google Apps Script URL in config.js.",
        "error"
      );
      return;
    }

    const response = await submitAttendance(payload);
    if (!response || !response.ok) {
      throw new Error(response?.error || "The event code is not valid.");
    }

    if (response.duplicate) {
      setAttendanceStatus(
        `You are already checked in for ${response.eventName}. ${response.confirmationEmailSent ? "Your confirmation email has been sent." : "Your confirmation email will arrive shortly; during busy events it may take a few minutes."}`,
        "success"
      );
      return;
    }

    attendanceForm.reset();
    setAttendanceStatus(
      `Attendance recorded for ${response.eventName}. ${response.confirmationEmailSent ? "A confirmation email has been sent to your NYU email." : "Your attendance is saved. Your confirmation email will arrive shortly; during busy events it may take a few minutes."}`,
      "success"
    );
  } catch (error) {
    console.error(error);
    setAttendanceStatus(
      isRetryableAttendanceError(error)
        ? "We couldn’t confirm the response. Your check-in may already be saved. Your details are still here—retry, or ask an officer to add you manually. Retrying won’t count twice."
        : error.message || "Check-in failed. Confirm the room code and try again.",
      "error"
    );
  } finally {
    window.clearTimeout(progressTimer);
    attendanceSubmitting = false;
    button.disabled = false;
  }
});

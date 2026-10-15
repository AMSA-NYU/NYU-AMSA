const attendanceConfig = window.AMSA_CONFIG || {};
const attendanceForm = document.querySelector("#attendanceForm");
const attendanceStatus = document.querySelector("#attendanceStatus");
const attendanceCode = document.querySelector("#attendanceCode");

const codeFromLink = new URLSearchParams(window.location.search).get("code");
if (codeFromLink) {
  attendanceCode.value = codeFromLink.trim().toUpperCase();
}

function setAttendanceStatus(message, type = "") {
  attendanceStatus.textContent = message;
  attendanceStatus.className = `status${type ? ` is-${type}` : ""}`;
}

async function requestAttendance(payload) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  const params = new URLSearchParams({
    action: "attendance",
    fullName: payload.fullName,
    email: payload.email,
    eventCode: payload.eventCode
  });

  try {
    const response = await fetch(
      `${attendanceConfig.googleScriptUrl}?${params.toString()}`,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const error = new Error("Attendance service could not be reached.");
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      // Google can return an HTML quota page during a traffic burst.
      const error = new Error("Attendance is temporarily busy.");
      error.retryable = true;
      throw error;
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Attendance check-in timed out.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isRetryableAttendanceError(error) {
  if (error.retryable === false) return false;
  return error.retryable || error.name === "TypeError" || error.name === "AbortError" ||
    /busy|lock|temporarily|timed out|could not be reached/i.test(error.message || "");
}

async function submitAttendance(payload) {
  let lastError;

  // Spread a roomful of submissions before they reach the shared Google backend.
  await new Promise((resolve) => window.setTimeout(resolve, Math.floor(Math.random() * 8000)));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await requestAttendance(payload);
      if (response && !response.ok && (response.retryable || /busy|lock|temporarily/i.test(response.error || ""))) {
        const busyError = new Error("Attendance is busy. Retrying your check-in...");
        busyError.name = "BusyError";
        throw busyError;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isRetryableAttendanceError(error) || attempt === 5) {
        throw error;
      }
      setAttendanceStatus("The room is checking in at once. Retrying securely...");
      await new Promise((resolve) => {
        window.setTimeout(resolve, Math.min(20000, 1500 * (2 ** attempt)) + Math.floor(Math.random() * 4000));
      });
    }
  }

  throw lastError;
}

attendanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!attendanceForm.checkValidity()) {
    attendanceForm.reportValidity();
    return;
  }

  const data = new FormData(attendanceForm);
  const payload = {
    fullName: String(data.get("fullName") || "").trim(),
    email: String(data.get("email") || "").trim().toLowerCase(),
    eventCode: String(data.get("eventCode") || "").trim().toUpperCase()
  };

  if (!/^[A-Za-z0-9._%+-]+@nyu\.edu$/.test(payload.email)) {
    setAttendanceStatus("Please use your NYU email address.", "error");
    return;
  }

  const button = attendanceForm.querySelector("button");
  button.disabled = true;
  setAttendanceStatus("Checking you in. Please keep this page open; busy events may take a moment...");

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
      error.message || "Check-in failed. Confirm the room code and try again.",
      "error"
    );
  } finally {
    button.disabled = false;
  }
});

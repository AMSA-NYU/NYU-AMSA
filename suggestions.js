const suggestionForm = document.getElementById("suggestionForm");
const suggestionStatus = document.getElementById("suggestionStatus");
let suggestionRequestId = "";

suggestionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!suggestionForm.reportValidity()) return;
  const data = new FormData(suggestionForm);
  const email = String(data.get("email") || "").trim().toLowerCase();
  const idea = String(data.get("idea") || "").trim();
  const setStatus = (message, type = "") => {
    suggestionStatus.textContent = message;
    suggestionStatus.className = `status${type ? ` is-${type}` : ""}`;
  };
  if (!idea) {
    setStatus("Please tell us your idea.", "error");
    return;
  }
  if (email && !/^[A-Za-z0-9._%+-]+@nyu\.edu$/.test(email)) {
    setStatus("Use your NYU email, or leave the email field blank.", "error");
    return;
  }
  const endpoint = window.AMSA_CONFIG?.googleScriptUrl;
  if (!endpoint) {
    setStatus("Suggestions are not connected yet. Please check back soon.", "error");
    return;
  }
  suggestionRequestId ||= crypto.randomUUID();
  const params = new URLSearchParams({
    action: "suggestion",
    requestId: suggestionRequestId,
    category: String(data.get("category")),
    idea,
    fullName: String(data.get("fullName") || "").trim(),
    email
  });
  const button = suggestionForm.querySelector("button[type=submit]");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 35000);
  button.disabled = true;
  setStatus("Sending your idea...");
  try {
    const response = await fetch(`${endpoint}?${params}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("The suggestion service could not be reached.");
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Your idea could not be saved.");
    suggestionForm.reset();
    suggestionRequestId = "";
    setStatus("Thank you! Your idea has been saved for AMSA to review.", "success");
  } catch (error) {
    setStatus(error.name === "AbortError"
      ? "The service is busy. Wait a moment, then try again."
      : error.message || "Something went wrong. Please try again.", "error");
  } finally {
    window.clearTimeout(timeout);
    button.disabled = false;
  }
});

// A changed idea is a new submission; an unchanged retry keeps the same ID.
suggestionForm.addEventListener("input", () => { suggestionRequestId = ""; });

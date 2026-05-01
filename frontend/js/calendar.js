// ── CivicGuide AI — Google Calendar Integration ───────────
// Uses Google Calendar URL scheme (no OAuth needed).
// Opens Google Calendar's "Create Event" pre-filled form in a new tab.

const btn = document.getElementById("add-reminder-btn");
if (btn) {
  btn.addEventListener("click", addVotingReminder);
}

function addVotingReminder() {
  // Build event details
  const title       = "Voting Day Reminder — CivicGuide AI";
  const description = [
    "🗳️ Participate in the democratic process!",
    "",
    "Checklist before you go:",
    "✅ Carry your Voter ID Card (EPIC) or approved alternate photo ID",
    "✅ Find your polling booth at voterportal.eci.gov.in",
    "✅ Polls open 7 AM — vote early to avoid queues",
    "✅ Look for the indelible ink mark on your left index finger after voting",
    "",
    "Powered by CivicGuide AI — eci.gov.in",
  ].join("\n");

  const location = "Your designated polling booth — check voterportal.eci.gov.in";

  // Use tomorrow as a placeholder date (user can adjust in Calendar UI)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split("T")[0].replace(/-/g, "");

  // Build Google Calendar URL
  const params = new URLSearchParams({
    action:   "TEMPLATE",
    text:     title,
    details:  description,
    location: location,
    dates:    `${dateStr}/${dateStr}`,   // all-day event
    trp:      "false",
  });

  const calendarUrl = `https://calendar.google.com/calendar/render?${params.toString()}`;

  // Open in new tab
  window.open(calendarUrl, "_blank", "noopener,noreferrer");

  // Visual feedback
  if (btn) {
    const original = btn.textContent;
    btn.textContent = "✅ Reminder Added! Check Google Calendar";
    btn.classList.add("added");
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove("added");
    }, 4000);
  }
}

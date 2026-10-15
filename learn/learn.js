/* learn/learn.js · interest picker, contact form and copy fallback for learn/index.html.
   Vanilla JS. Makes no network request unless FORM_ENDPOINT below is set. */

/* ============================== CONFIG ==============================
   FORM_ENDPOINT
   Leave "" and the form opens the visitor's mail client (mailto:) with the
   details pre-filled. Set it to a hosted URL (a worker, function or form
   service) and the form will instead POST JSON like:
   {
     "email": "", "name": "", "organisation": "", "role": "",
     "interests": ["WESO", "WESO Energy"], "message": "", "time": "",
     "page": "https://.../learn/", "sent_at": "2026-10-15T12:00:00.000Z"
   }
   If that POST fails the page falls back to mailto: automatically.
   ==================================================================== */
const FORM_ENDPOINT = "";

const MAIL_TO = "alpine@lunaclassicdao.com";
const MAIL_SUBJECT = "WESO: request a call";

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KEYS = ["weso", "rebase", "defi", "energy"];
  const LABELS = { weso: "WESO", rebase: "reBASE", defi: "WESO DeFi", energy: "WESO Energy" };

  /* ---------- interest picker, synced with the form checkboxes ---------- */
  const selected = new Set();
  const picks = Array.from(document.querySelectorAll(".pick[data-key]"));
  const boxes = Array.from(document.querySelectorAll('input[name="interests"]'));
  const facts = Array.from(document.querySelectorAll(".fact[data-key]"));
  const empty = $("pick-empty");
  const clearBtn = $("pick-clear");
  const status = $("pick-status");

  function render() {
    picks.forEach((b) => b.setAttribute("aria-pressed", selected.has(b.dataset.key) ? "true" : "false"));
    boxes.forEach((c) => { c.checked = selected.has(c.value); });
    facts.forEach((f) => { f.hidden = !selected.has(f.dataset.key); });
    const chosen = KEYS.filter((k) => selected.has(k)).map((k) => LABELS[k]);
    empty.hidden = chosen.length > 0;
    clearBtn.hidden = chosen.length === 0;
    status.textContent = chosen.length ? "Showing: " + chosen.join(", ") : "Nothing selected";
  }

  function toggle(key, on) {
    if (!LABELS[key]) return;
    if (on === undefined) on = !selected.has(key);
    if (on) selected.add(key); else selected.delete(key);
    render();
  }

  picks.forEach((b) => b.addEventListener("click", () => toggle(b.dataset.key)));
  boxes.forEach((c) => c.addEventListener("change", () => toggle(c.value, c.checked)));
  $("pick-all").addEventListener("click", () => { KEYS.forEach((k) => selected.add(k)); render(); });
  clearBtn.addEventListener("click", () => { selected.clear(); render(); });

  /* ---------- URL prefill: ?email=... ---------- */
  try {
    const params = new URLSearchParams(window.location.search);
    const email = (params.get("email") || "").trim();
    if (email && email.length <= 254) $("f-email").value = email;
  } catch (_) { /* ignore malformed query strings */ }

  /* ---------- form ---------- */
  const form = $("call-form");
  const sendBtn = $("send-btn");
  const hint = $("send-hint");
  let lastText = "";

  if (FORM_ENDPOINT) {
    hint.textContent = "Sends your details to WESO. If that fails, your mail app opens instead.";
  }

  function collect() {
    const val = (id) => ($(id).value || "").trim();
    return {
      email: val("f-email"),
      name: val("f-name"),
      organisation: val("f-org"),
      role: val("f-role"),
      interests: KEYS.filter((k) => selected.has(k)).map((k) => LABELS[k]),
      message: val("f-message"),
      time: val("f-time"),
      page: window.location.origin + window.location.pathname,
      sent_at: new Date().toISOString()
    };
  }

  function plainText(d) {
    const v = (s) => (s ? s : "(not given)");
    return [
      "Request a call about WESO",
      "",
      "Email: " + v(d.email),
      "Name: " + v(d.name),
      "Organisation: " + v(d.organisation),
      "Role: " + v(d.role),
      "Interests: " + (d.interests.length ? d.interests.join(", ") : "(none selected)"),
      "Preferred call or video time: " + v(d.time),
      "",
      "Message:",
      v(d.message),
      "",
      "Sent from " + d.page
    ].join("\n");
  }

  function mailtoUrl(body) {
    return "mailto:" + MAIL_TO + "?subject=" + encodeURIComponent(MAIL_SUBJECT) + "&body=" + encodeURIComponent(body);
  }

  function finish(viaMail) {
    $("fallback-why").textContent = viaMail
      ? "If no mail app opened, copy the details and send them yourself:"
      : "Sent. If you want a copy for your records:";
    $("copy-text").value = lastText;
    $("fallback").hidden = false;
    const done = $("done");
    done.hidden = false;
    done.focus({ preventScroll: true });
    done.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = collect();
    const body = plainText(data);
    lastText = "To: " + MAIL_TO + "\nSubject: " + MAIL_SUBJECT + "\n\n" + body;

    if (FORM_ENDPOINT) {
      sendBtn.disabled = true;
      const label = sendBtn.textContent;
      sendBtn.textContent = "Sending…";
      try {
        const r = await fetch(FORM_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        finish(false);
        return;
      } catch (err) {
        toast("Could not reach the server. Opening your mail app instead.");
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = label;
      }
    }

    /* mailto path: reveal the confirmation and fallback first, then hand off to the mail client */
    finish(true);
    window.location.href = mailtoUrl(body);
  });

  /* ---------- copy fallback ---------- */
  $("copy-btn").addEventListener("click", async () => {
    const text = lastText || ("To: " + MAIL_TO + "\nSubject: " + MAIL_SUBJECT + "\n\n" + plainText(collect()));
    $("copy-text").value = text;
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); ok = true; } catch (_) { ok = false; }
    }
    if (!ok) {
      const ta = $("copy-text");
      const details = ta.closest("details");
      if (details) details.open = true;
      ta.focus();
      ta.select();
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
    }
    toast(ok ? "Details copied. Paste them into an email to " + MAIL_TO : "Copy blocked by the browser. The text is selected below, copy it by hand.");
  });

  /* ---------- toast (reuses #toast from the stats page styles) ---------- */
  let toastTimer = 0;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  render();
})();

const API_BASE = "http://localhost:5000";
const CHANNEL_NAME = "vfa-demo";
const STORAGE_KEY = "vfa-wallet-last-result";
const channel = new BroadcastChannel(CHANNEL_NAME);

let busy = false;

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  const text = await res.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function fetchIntent(intentId) {
  return api(`${API_BASE}/intent/${intentId}`);
}

async function approveIntent(intentId) {
  return api(`${API_BASE}/intent/${intentId}/approve`, {
    method: "POST",
    body: JSON.stringify({ approvedBy: "someone-wallet" })
  });
}

async function rejectIntent(intentId) {
  return api(`${API_BASE}/intent/${intentId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason: "user-rejected" })
  });
}

function setButtonsDisabled(disabled) {
  const approveBtn = document.getElementById("approveBtn");
  const rejectBtn = document.getElementById("rejectBtn");

  if (approveBtn) approveBtn.disabled = disabled;
  if (rejectBtn) rejectBtn.disabled = disabled;
}

function setResultText(text) {
  const resultEl = document.getElementById("result");
  if (resultEl) resultEl.textContent = text;
}

function setStatusText(text) {
  const statusEl = document.getElementById("walletStatus");
  if (statusEl) statusEl.textContent = text;
}

function setCardState(state) {
  const card = document.getElementById("content");
  if (!card) return;

  card.classList.remove("approved", "rejected");

  if (state) card.classList.add(state);
}

function lockDecisionUI(type) {
  const approveBtn = document.getElementById("approveBtn");
  const rejectBtn = document.getElementById("rejectBtn");

  if (!approveBtn || !rejectBtn) return;

  approveBtn.disabled = true;
  rejectBtn.disabled = true;

  if (type === "approved") {
    approveBtn.textContent = "Approved ✔";
    rejectBtn.style.display = "none";
  }

  if (type === "rejected") {
    rejectBtn.textContent = "Rejected ✖";
    approveBtn.style.display = "none";
  }
}

function publishResult(message) {
  const payload = { ...message, sentAt: Date.now() };
  channel.postMessage(payload);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function renderIntent(intent, session) {
  const el = document.getElementById("content");

  const sessionAccepted = session?.vfaAccepted ? "accepted" : "not accepted";
  const intentStatus = intent?.status || "-";
  const isPending = intentStatus === "pending" || intentStatus === "requested";

  el.innerHTML = `
    <h2>VFA Intent Review</h2>
    <p><strong>Origin:</strong> ${escapeHtml(location.origin)}</p>
    <p><strong>VFA session:</strong> ${escapeHtml(session?.sessionId || "-")}</p>
    <p><strong>Negotiation:</strong> ${escapeHtml(sessionAccepted)}</p>
    <p><strong>Mode:</strong> ${escapeHtml(session?.mode || "-")}</p>
    <hr>
    <p><strong>Intent:</strong> ${escapeHtml(intent.intent)}</p>
    <p><strong>Environment:</strong> ${escapeHtml(intent.env)}</p>
    <p><strong>Service:</strong> ${escapeHtml(intent.service)}</p>
    <p><strong>Commit:</strong> ${escapeHtml(intent.commit)}</p>
    <p><strong>Requested by:</strong> ${escapeHtml(intent.requestedBy)}</p>
    <p><strong>Status:</strong> ${escapeHtml(intentStatus)}</p>
    <p id="walletStatus"><strong>Wallet status:</strong> waiting for decision</p>
    <button id="approveBtn">Approve</button>
    <button id="rejectBtn">Reject</button>
    <pre id="result"></pre>
  `;

  if (!isPending) {

    const approveBtn = document.getElementById("approveBtn");
    const rejectBtn = document.getElementById("rejectBtn");

    if (approveBtn) approveBtn.remove();
    if (rejectBtn) rejectBtn.remove();

    const statusEl = document.getElementById("walletStatus");

    if (intentStatus === "approved") {
      statusEl.textContent = "✔ Wallet status: approved";
      statusEl.classList.add("status-approved");
      setCardState("approved");
    }

    if (intentStatus === "rejected") {
      statusEl.textContent = "✖ Wallet status: rejected";
      statusEl.classList.add("status-rejected");
      setCardState("rejected");
    }

    setResultText("This intent is already finalized.");

    return;
  }

  document.getElementById("approveBtn").onclick = async () => {
    if (busy) return;
    busy = true;

    setButtonsDisabled(true);
    setStatusText("Wallet status: approving…");
    setResultText("Approving…");

    try {
      const data = await approveIntent(intent.intentId);
      setResultText(JSON.stringify(data, null, 2));

      if (data.ok) {
        setStatusText("Wallet status: approved");
        setCardState("approved");
        lockDecisionUI("approved");
        publishResult({
          type: "vfa-wallet-approved",
          intentId: intent.intentId,
          sessionId: intent.sessionId,
          token: data.token,
          payload: data.payload,
          source: "wallet-ui"
        });
        return;
      }

      setStatusText("Wallet status: approve failed");
      setButtonsDisabled(false);
      busy = false;
    } catch (err) {
      const payload = err?.data ? JSON.stringify(err.data, null, 2) : String(err);
      setStatusText("Wallet status: approve error");
      setResultText(`Approve error:\n${payload}`);
      setButtonsDisabled(false);
      busy = false;
    }
  };

  document.getElementById("rejectBtn").onclick = async () => {
    if (busy) return;
    busy = true;

    setButtonsDisabled(true);
    setStatusText("Wallet status: rejecting…");
    setResultText("Rejecting…");

    try {
      const data = await rejectIntent(intent.intentId);
      setResultText(JSON.stringify(data, null, 2));

      if (data.ok) {
        setStatusText("Wallet status: rejected");
        setCardState("rejected");
        lockDecisionUI("rejected");
        publishResult({
          type: "vfa-wallet-rejected",
          intentId: intent.intentId,
          sessionId: intent.sessionId,
          source: "wallet-ui"
        });
        return;
      }

      setStatusText("Wallet status: reject failed");
      setButtonsDisabled(false);
      busy = false;
    } catch (err) {
      const payload = err?.data ? JSON.stringify(err.data, null, 2) : String(err);
      setStatusText("Wallet status: reject error");
      setResultText(`Reject error:\n${payload}`);
      setButtonsDisabled(false);
      busy = false;
    }
  };
}

async function main() {
  const intentId = qs("intentId");
  const el = document.getElementById("content");

  if (!intentId) {
    el.innerHTML = "<p>Missing <code>intentId</code> in URL.</p>";
    return;
  }

  setStatusText?.("Wallet status: loading intent…");

  const data = await fetchIntent(intentId);

  if (!data.ok) {
    el.innerHTML = `<p>Error: ${escapeHtml(data.error || "unknown")}</p>`;
    return;
  }

  renderIntent(data.intent, data.session);
}

main().catch(err => {
  const payload = err?.data ? JSON.stringify(err.data, null, 2) : String(err);
  document.getElementById("content").innerHTML = `<pre>${escapeHtml(payload)}</pre>`;
});
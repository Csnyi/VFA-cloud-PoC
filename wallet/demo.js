(() => {
    const GATEWAY = "http://localhost:7000";
    const POLICY = "http://localhost:5000";
    const STORAGE_KEY = "vfa-wallet-last-result";
    const channel = new BroadcastChannel("vfa-demo");

    const state = {
        mode: null,
        sessionId: null,
        intentId: null,
        walletUrl: null,
        token: null,
        service: "payments-api",
        env: "production",
        commit: "web-demo"
    };

    let walletResultTimer = null;
    let logCounter = 0;

    const $ = (id) => document.getElementById(id);

    const nodes = ["Client", "Gateway", "Policy", "Sandbox", "Prod", "Wallet"];
    const lines = ["ClientGateway", "GatewayPolicy", "PolicyWallet", "WalletPolicy", "GatewayProd", "GatewaySandbox"];

    /* =========================================================
       BASIC UI HELPERS
    ========================================================= */

    function resetVisual() {
        nodes.forEach((name) => {
            const el = $(`node${name}`);
            if (!el) return;
            el.classList.remove("active", "ok", "error");
        });

        lines.forEach((name) => {
            const el = $(`line${name}`);
            if (!el) return;
            el.classList.remove("active", "ok", "error");
        });
    }

    function setNode(name, kind = "active") {
        const el = $(`node${name}`);
        if (!el) return;

        el.classList.remove("active", "ok", "error");
        el.classList.add(kind);
    }

    function setLine(name, kind = "active") {
        const el = $(`line${name}`);
        if (!el) return;

        el.classList.remove("active", "ok", "error");
        el.classList.add(kind);
    }

    function writeConsole(msg) {
        const consoleEl = $("console");
        if (!consoleEl) return;

        logCounter += 1;

        const line = document.createElement("div");
        line.textContent = `${String(logCounter).padStart(3, "0")} | ${msg}`;

        consoleEl.appendChild(line);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function writeConsoleClear() {
        const consoleEl = $("console");
        if (!consoleEl) return;

        consoleEl.innerHTML = "";
        logCounter = 0;
    }

    function writeJson(data) {
        const box = $("jsonBox");
        if (!box) return;

        box.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    }

    function updateFacts() {
        if ($("sessionId")) $("sessionId").textContent = state.sessionId || "—";
        if ($("intentId")) $("intentId").textContent = state.intentId || "—";

        if ($("walletUrl")) {
            $("walletUrl").innerHTML = state.walletUrl
                ? `<a class="link" href="${state.walletUrl}" target="_blank" rel="noopener noreferrer">${state.walletUrl}</a>`
                : "—";
        }

        if ($("commitValue")) $("commitValue").textContent = state.commit;
        if ($("serviceValue")) $("serviceValue").textContent = state.service;
        if ($("envValue")) $("envValue").textContent = state.env;
    }

    function setDot(id, color) {
        const el = $(id);
        if (el) el.style.background = color;
    }

    function setStatus({ mode = "—", decision = "—", negotiation = "—", visa = "—" } = {}) {
        if ($("modeLabel")) $("modeLabel").textContent = mode;
        if ($("decisionLabel")) $("decisionLabel").textContent = decision;
        if ($("negotiationLabel")) $("negotiationLabel").textContent = negotiation;
        if ($("visaLabel")) $("visaLabel").textContent = visa;

        setDot("dotMode", mode === "sandbox" ? "#f1c40f" : mode === "deny" ? "#e74c3c" : mode === "production" ? "#2ecc71" : "#6ea8ff");
        setDot("dotDecision", decision === "sandbox" ? "#f1c40f" : decision === "deny" ? "#e74c3c" : decision === "production" ? "#2ecc71" : "#6ea8ff");
        setDot("dotNegotiation", negotiation === "accepted" ? "#2ecc71" : negotiation === "missing" ? "#f1c40f" : "#6ea8ff");
        setDot("dotVisa", visa === "issued" ? "#2ecc71" : visa === "missing" ? "#e74c3c" : "#6ea8ff");
    }

    function updateButtons() {
        if ($("btnApprove")) {
            $("btnApprove").disabled = !state.intentId || !!state.token;
        }
        if ($("btnOpenWallet")) {
            $("btnOpenWallet").disabled = !state.walletUrl;
        }
    }

    function normalizeWalletUrl(rawUrl, intentId) {
        const fallback = new URL(`index.html?intentId=${encodeURIComponent(intentId)}`, location.href);

        if (!rawUrl) return fallback.href;

        try {
            const url = new URL(rawUrl, location.href);
            if (!url.searchParams.get("intentId")) {
                url.searchParams.set("intentId", intentId);
            }
            return url.href;
        } catch {
            return fallback.href;
        }
    }

    /* =========================================================
       PROTOCOL MONITOR
    ========================================================= */

    function setProtoState(value) {
        const el = $("protoState");
        if (el) el.textContent = value;
    }

    function clearActorMarks() {
        document.querySelectorAll(".actor").forEach((el) => {
            el.classList.remove("active", "done", "error");
        });
    }

    function clearActorActive() {
        document.querySelectorAll(".actor").forEach((el) => {
            el.classList.remove("active");
        });
    }

    function setActorActive(...ids) {
        clearActorActive();
        ids.forEach((id) => {
            const el = $(`actor-${id}`);
            if (el) el.classList.add("active");
        });
    }

    function setActorDone(...ids) {
        ids.forEach((id) => {
            const el = $(`actor-${id}`);
            if (!el) return;
            el.classList.remove("active", "error");
            el.classList.add("done");
        });
    }

    function setActorError(...ids) {
        ids.forEach((id) => {
            const el = $(`actor-${id}`);
            if (!el) return;
            el.classList.remove("active", "done");
            el.classList.add("error");
        });
    }

    function resetProtocolView() {
        setProtoState("IDLE");
        clearActorMarks();
    }

    function protocolStep(stateName, message, activeActors = []) {
        setProtoState(stateName);
        setActorActive(...activeActors);
        writeConsole(message);
    }

    /* =========================================================
       NETWORK / STORAGE
    ========================================================= */

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

    function stopWalletResultWatch() {
        if (walletResultTimer) {
            clearInterval(walletResultTimer);
            walletResultTimer = null;
        }
    }

    function startWalletResultWatch() {
        stopWalletResultWatch();

        walletResultTimer = setInterval(() => {
            if (!state.intentId || state.token) return;

            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return;

                const msg = JSON.parse(raw);
                handleWalletMessage(msg, "storage-poll").catch(console.error);
            } catch {
                // ignore malformed localStorage values
            }
        }, 800);
    }

    /* =========================================================
       FLOW STEPS
    ========================================================= */

    async function createSession() {
        protocolStep("SESSION_REQUEST", "Client → Gateway : VFA presence / connect kérés", ["client", "gateway"]);

        setNode("Client", "active");
        setNode("Gateway", "active");
        setLine("ClientGateway", "active");

        const data = await api(`${GATEWAY}/connect/request`, {
            method: "POST",
            body: JSON.stringify({
                clientId: "browser-demo",
                target: "deploy-target",
                vfa: true,
                version: "0.1",
                mode: "required"
            })
        });

        state.sessionId = data.sessionId;
        updateFacts();

        setLine("ClientGateway", "ok");
        setLine("GatewayPolicy", "ok");
        setNode("Client", "ok");
        setNode("Gateway", "ok");
        setNode("Policy", "ok");

        setActorDone("client", "gateway");
        setActorActive("gateway", "policy");
        setProtoState("SESSION_ACCEPTED");

        setStatus({
            mode: state.mode || "—",
            decision: "—",
            negotiation: data.vfaAccepted ? "accepted" : "missing",
            visa: state.token ? "issued" : "—"
        });

        writeConsole(`Session létrejött: ${data.sessionId}`);
        writeConsole(`VFA negotiation: ${data.status || (data.vfaAccepted ? "accepted" : "missing")}`);
        writeJson(data);
    }

    async function createIntent() {
        protocolStep("INTENT_REQUEST", "Gateway / Client → Policy : intent kérés", ["gateway", "policy"]);

        setNode("Policy", "active");
        setLine("GatewayPolicy", "active");

        const data = await api(`${POLICY}/intent/request`, {
            method: "POST",
            body: JSON.stringify({
                sessionId: state.sessionId,
                intent: "deploy",
                service: state.service,
                env: state.env,
                commit: state.commit,
                requestedBy: "browser-demo"
            })
        });

        state.intentId = data.intentId;
        state.walletUrl = normalizeWalletUrl(data.walletUrl, data.intentId);
        updateFacts();

        setNode("Policy", "ok");
        setNode("Wallet", "active");
        setLine("PolicyWallet", "active");

        setProtoState("WAITING_WALLET");
        setActorDone("policy");
        setActorActive("policy", "wallet");

        updateButtons();
        startWalletResultWatch();

        writeConsole(`Intent létrejött: ${data.intentId}`);
        writeConsole("Policy → Wallet : jóváhagyás szükséges");
        writeJson({ ...data, normalizedWalletUrl: state.walletUrl });
    }

    async function approveIntentHere() {
        if (!state.intentId || state.token) return;

        setProtoState("WALLET_APPROVING");
        setActorActive("wallet", "policy");

        setNode("Wallet", "ok");
        setNode("Policy", "active");
        setLine("PolicyWallet", "ok");
        setLine("WalletPolicy", "active");

        writeConsole("Approve a dashboardból…");

        const data = await api(`${POLICY}/intent/${state.intentId}/approve`, {
            method: "POST",
            body: JSON.stringify({ approvedBy: "dashboard-wallet" })
        });

        state.token = data.token;

        setNode("Wallet", "ok");
        setNode("Policy", "ok");
        setLine("WalletPolicy", "ok");

        setProtoState("APPROVED");
        setActorDone("wallet", "policy");

        updateButtons();

        setStatus({
            mode: state.mode || "—",
            decision: "approved",
            negotiation: "accepted",
            visa: "issued"
        });

        writeConsole("Wallet → Policy : APPROVED");
        writeConsole("Policy → Gateway : ALLOW");
        writeJson(data);

        await finishProduction();
    }

    async function finishProduction() {
        if (!state.sessionId || !state.intentId || !state.token) {
            writeConsole("Hiányzó session / intent / token.");
            return;
        }

        setProtoState("DEPLOYING");
        setActorActive("gateway", "production");

        setNode("Gateway", "active");
        setNode("Prod", "active");
        setLine("GatewayProd", "active");

        writeConsole("Gateway ellenőriz: valid visa → production route…");

        const data = await api(`${GATEWAY}/deploy`, {
            method: "POST",
            body: JSON.stringify({
                sessionId: state.sessionId,
                token: state.token,
                service: state.service,
                env: state.env,
                commit: state.commit,
                requestedBy: "browser-demo"
            })
        });

        stopWalletResultWatch();

        setNode("Gateway", "ok");
        setNode("Prod", "ok");
        setLine("GatewayProd", "ok");

        setProtoState("DEPLOY_SUCCESS");
        setActorDone("client", "gateway", "policy", "wallet", "production");

        setStatus({
            mode: "production",
            decision: data.gatewayDecision || "production",
            negotiation: "accepted",
            visa: "issued"
        });

        writeConsole("Gateway → Production : deploy");
        writeConsole("Eredmény: valid visa után a gateway a PRODUCTION targetre továbbított.");
        writeJson(data);
    }

    /* =========================================================
       DEMO MODES
    ========================================================= */

    async function runSandbox() {
        hardReset("sandbox");

        protocolStep("SANDBOX_REQUEST", "Client → Gateway : deploy kérés VFA nélkül", ["client", "gateway"]);

        setNode("Client", "active");
        setNode("Gateway", "active");
        setLine("ClientGateway", "active");

        setStatus({
            mode: "sandbox",
            decision: "—",
            negotiation: "missing",
            visa: "—"
        });

        const data = await api(`${GATEWAY}/deploy`, {
            method: "POST",
            body: JSON.stringify({
                service: state.service,
                env: state.env,
                commit: state.commit,
                requestedBy: "browser-demo"
            })
        });

        setNode("Client", "ok");
        setNode("Gateway", "ok");
        setNode("Sandbox", "ok");
        setLine("ClientGateway", "ok");
        setLine("GatewaySandbox", "ok");

        setProtoState("SANDBOX_ROUTED");
        setActorDone("client", "gateway");
        setActorActive("gateway");
        setActorDone("production");
        setActorError("wallet");

        setStatus({
            mode: "sandbox",
            decision: data.gatewayDecision || "sandbox",
            negotiation: "missing",
            visa: "—"
        });

        writeConsole("Gateway → Sandbox : fallback route");
        writeConsole("Eredmény: a kérés SANDBOX targetre került.");
        writeJson(data);
    }

    async function runDeny() {
        hardReset("deny");

        setStatus({
            mode: "deny",
            decision: "—",
            negotiation: "—",
            visa: "missing"
        });

        await createSession();

        setProtoState("DENY_REQUEST");
        setActorActive("gateway", "production");

        writeConsole("Deny demo: van VFA session, de nincs visa. Most deploy kérés következik token nélkül…");

        const data = await api(`${GATEWAY}/deploy`, {
            method: "POST",
            body: JSON.stringify({
                sessionId: state.sessionId,
                service: state.service,
                env: state.env,
                commit: state.commit,
                requestedBy: "browser-demo"
            })
        }).catch((err) => err.data || { error: err.message });

        setNode("Gateway", "error");
        setNode("Prod", "error");
        setLine("GatewayProd", "error");

        setProtoState("DEPLOY_BLOCKED");
        setActorDone("client");
        setActorError("gateway", "production");

        setStatus({
            mode: "deny",
            decision: data.gatewayDecision || "deny",
            negotiation: "accepted",
            visa: "missing"
        });

        writeConsole("Gateway → Client : 403 / deny");
        writeConsole("Eredmény: a gateway megtagadta a kérést, mert hiányzik a visa.");
        writeJson(data);
    }

    async function runProduction() {
        hardReset("production");

        setStatus({
            mode: "production",
            decision: "—",
            negotiation: "—",
            visa: "—"
        });

        writeConsole("Production flow indítása");

        await createSession();
        await createIntent();
        updateButtons();

        writeConsole("Production demo előkészítve.");
        writeConsole("Nyisd meg a walletet és approve-olj vagy rejectelj.");
        writeConsole("A dashboard a wallet üzenetére automatikusan továbblép.");
    }

    /* =========================================================
       WALLET MESSAGE HANDLING
    ========================================================= */

    async function handleWalletMessage(msg, source = "channel") {
        if (!msg || !state.intentId) return;
        if (msg.intentId && msg.intentId !== state.intentId) return;

        const type = msg.type || "";
        const isApproved = type === "intent-approved" || type === "vfa-wallet-approved";
        const isRejected = type === "intent-rejected" || type === "vfa-wallet-rejected";

        if (!isApproved && !isRejected) return;

        writeConsole(`Wallet válasz érkezett (${source})`);
        writeConsole(JSON.stringify(msg));

        if (isApproved) {
            if (state.token && msg.token && state.token === msg.token) return;

            if (msg.token) {
                state.token = msg.token;
            }

            setNode("Wallet", "ok");
            setNode("Policy", "ok");
            setLine("PolicyWallet", "ok");
            setLine("WalletPolicy", "ok");

            setProtoState("APPROVED");
            setActorDone("wallet");
            setActorActive("policy", "gateway");

            updateButtons();

            setStatus({
                mode: state.mode || "—",
                decision: "approved",
                negotiation: "accepted",
                visa: "issued"
            });

            writeConsole("Wallet → Policy : APPROVED");
            writeConsole("Policy → Gateway : ALLOW");
            writeJson(msg);

            try {
                await finishProduction();
            } catch (err) {
                showError(err);
            }
            return;
        }

        if (isRejected) {
            stopWalletResultWatch();

            setNode("Wallet", "error");
            setNode("Policy", "error");
            setLine("PolicyWallet", "error");
            setLine("WalletPolicy", "error");

            setProtoState("REJECTED");
            setActorError("wallet");
            setActorActive("policy", "gateway");

            updateButtons();

            setStatus({
                mode: state.mode || "—",
                decision: "deny",
                negotiation: "accepted",
                visa: "missing"
            });

            writeConsole("Wallet → Policy : REJECTED");
            writeConsole("Policy → Gateway : DENY");
            writeJson(msg);
        }
    }

    /* =========================================================
       RESET / ERROR
    ========================================================= */

    function hardReset(mode = null) {
        stopWalletResultWatch();
        resetVisual();
        resetProtocolView();
        writeConsoleClear();

        state.mode = mode;
        state.sessionId = null;
        state.intentId = null;
        state.walletUrl = null;
        state.token = null;

        updateFacts();
        updateButtons();

        setStatus({
            mode: mode || "—",
            decision: "—",
            negotiation: "—",
            visa: "—"
        });

        writeConsole("Készen áll. Indíts egy demo módot.");
        writeJson({});
    }

    function showError(err) {
        const data = err && err.data ? err.data : { error: String(err) };
        writeConsole("Hiba történt.");
        writeJson(data);
        console.error(err);
    }

    /* =========================================================
       EVENTS
    ========================================================= */

    channel.onmessage = (ev) => {
        handleWalletMessage(ev.data || {}, "BroadcastChannel").catch(console.error);
    };

    window.addEventListener("storage", (ev) => {
        if (ev.key !== STORAGE_KEY || !ev.newValue) return;

        try {
            const msg = JSON.parse(ev.newValue);
            handleWalletMessage(msg, "storage-event").catch(console.error);
        } catch {
            // ignore malformed storage payloads
        }
    });

    if ($("btnSandbox")) $("btnSandbox").addEventListener("click", () => runSandbox().catch(showError));
    if ($("btnDeny")) $("btnDeny").addEventListener("click", () => runDeny().catch(showError));
    if ($("btnProd")) $("btnProd").addEventListener("click", () => runProduction().catch(showError));
    if ($("btnApprove")) $("btnApprove").addEventListener("click", () => approveIntentHere().catch(showError));

    if ($("btnOpenWallet")) {
        $("btnOpenWallet").addEventListener("click", () => {
            if (!state.walletUrl) return;
            window.open(state.walletUrl, "_blank", "noopener,noreferrer");
            writeConsole(`Wallet megnyitva: ${state.walletUrl}`);
            writeConsole("A dashboard a wallet eseményére vár.");
        });
    }

    if ($("btnReset")) $("btnReset").addEventListener("click", () => hardReset());

    updateFacts();
    hardReset();
})();
from __future__ import annotations

import os

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

POLICY_SERVER_BASE = os.environ.get("POLICY_SERVER_BASE", "http://policy-server:5000")
DEPLOY_TARGET_BASE = os.environ.get("DEPLOY_TARGET_BASE", "http://deploy-target:5001")
SANDBOX_TARGET_BASE = os.environ.get("SANDBOX_TARGET_BASE", "http://sandbox-target:5002")


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "vfa-gateway"})


@app.post("/connect/request")
def connect_request():
    data = request.get_json(force=True)
    resp = requests.post(f"{POLICY_SERVER_BASE}/connect/request", json=data, timeout=10)
    return jsonify(resp.json()), resp.status_code


def fetch_session(session_id: str):
    resp = requests.get(f"{POLICY_SERVER_BASE}/connect/{session_id}", timeout=10)
    if resp.status_code != 200:
        return None
    data = resp.json()
    return data.get("session")


def route_to_sandbox(data: dict, reason: str, session: dict | None = None):
    upstream_resp = requests.post(
        f"{SANDBOX_TARGET_BASE}/deploy",
        json={
            "service": data.get("service"),
            "env": data.get("env"),
            "commit": data.get("commit"),
            "sessionId": data.get("sessionId"),
            "requestedBy": data.get("requestedBy", "demo-client"),
        },
        timeout=10,
    )

    try:
        upstream_data = upstream_resp.json()
    except Exception:
        upstream_data = {"ok": False, "error": "invalid_sandbox_response"}

    return jsonify({
        "ok": True,
        "gatewayDecision": "sandbox",
        "reason": reason,
        "session": session,
        "upstream": upstream_data,
    }), 200


@app.post("/deploy")
def deploy():
    data = request.get_json(force=True)

    session_id = data.get("sessionId")
    token = data.get("token")
    service = data.get("service")
    env = data.get("env")
    commit = data.get("commit")
    requested_by = data.get("requestedBy", "demo-client")

    # 1) nincs session -> sandbox
    if not session_id:
        return route_to_sandbox(data, "missing_session_id")

    session = fetch_session(session_id)

    # 2) ismeretlen session -> sandbox
    if not session:
        return route_to_sandbox(data, "unknown_session")

    # 3) nincs VFA elfogadva -> sandbox
    if not session.get("vfaAccepted"):
        return route_to_sandbox(data, "vfa_not_accepted", session=session)

    # 4) van VFA session, de nincs token -> deny
    if not token:
        return jsonify({
            "ok": False,
            "gatewayDecision": "deny",
            "reason": "missing_token_for_vfa_session",
            "session": session,
        }), 403

    verify_resp = requests.post(
        f"{POLICY_SERVER_BASE}/visa/verify",
        json={"token": token},
        timeout=10,
    )
    verify_data = verify_resp.json()

    if not verify_data.get("ok"):
        return jsonify({
            "ok": False,
            "gatewayDecision": "deny",
            "reason": "invalid_visa",
            "details": verify_data,
            "session": session,
        }), 403

    payload = verify_data.get("payload", {})

    if payload.get("aud") != "vfa-gateway":
        return jsonify({
            "ok": False,
            "gatewayDecision": "deny",
            "reason": "invalid_audience",
            "session": session,
        }), 403

    if payload.get("sessionId") != session_id:
        return jsonify({
            "ok": False,
            "gatewayDecision": "deny",
            "reason": "session_mismatch",
            "session": session,
        }), 403

    if payload.get("intent") != "deploy":
        return jsonify({
            "ok": False,
            "gatewayDecision": "deny",
            "reason": "invalid_intent",
            "session": session,
        }), 403

    if payload.get("service") != service:
        return jsonify({
            "ok": False,
            "gatewayDecision": "deny",
            "reason": "service_mismatch",
            "session": session,
        }), 403

    if payload.get("env") != env:
        return jsonify({
            "ok": False,
            "gatewayDecision": "deny",
            "reason": "env_mismatch",
            "session": session,
        }), 403

    if payload.get("commit") != commit:
        return jsonify({
            "ok": False,
            "gatewayDecision": "deny",
            "reason": "commit_mismatch",
            "session": session,
        }), 403

    upstream_resp = requests.post(
        f"{DEPLOY_TARGET_BASE}/deploy",
        json={
            "sessionId": session_id,
            "service": service,
            "env": env,
            "commit": commit,
            "approvedBy": payload.get("approvedBy"),
            "requestedBy": requested_by,
            "intentId": payload.get("intentId"),
        },
        timeout=10,
    )

    try:
        upstream_data = upstream_resp.json()
    except Exception:
        upstream_data = {"ok": False, "error": "invalid_upstream_response"}

    return jsonify({
        "ok": upstream_resp.ok,
        "gatewayDecision": "production",
        "reason": "valid_vfa_visa",
        "session": session,
        "visaPayload": payload,
        "upstream": upstream_data,
    }), upstream_resp.status_code


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7000, debug=True)
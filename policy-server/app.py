from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

HMAC_SECRET = os.environ.get("VFA_HMAC_SECRET", "CHANGE_ME_DEV_SECRET").encode("utf-8")
TOKEN_TTL_SECONDS = int(os.environ.get("VFA_TOKEN_TTL_SECONDS", "300"))
SESSION_TTL_SECONDS = int(os.environ.get("VFA_SESSION_TTL_SECONDS", "300"))

SESSIONS: dict[str, dict[str, Any]] = {}
INTENTS: dict[str, dict[str, Any]] = {}
TOKENS: dict[str, dict[str, Any]] = {}


def now_ts() -> int:
    return int(time.time())


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def sign_payload(payload: dict[str, Any]) -> str:
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = b64url_encode(payload_json)
    sig = hmac.new(HMAC_SECRET, payload_b64.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = b64url_encode(sig)
    return f"{payload_b64}.{sig_b64}"


def verify_token(token: str) -> tuple[bool, str, dict[str, Any] | None]:
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        expected_sig = hmac.new(HMAC_SECRET, payload_b64.encode("utf-8"), hashlib.sha256).digest()
        given_sig = b64url_decode(sig_b64)

        if not hmac.compare_digest(expected_sig, given_sig):
            return False, "invalid_signature", None

        payload = json.loads(b64url_decode(payload_b64).decode("utf-8"))

        if payload.get("exp", 0) < now_ts():
            return False, "expired", payload

        token_id = payload.get("tokenId")
        stored = TOKENS.get(token_id)
        if not stored:
            return False, "unknown_token", payload

        if stored.get("revoked", False):
            return False, "revoked", payload

        return True, "ok", payload
    except Exception as exc:
        return False, f"malformed_token: {exc}", None


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "policy-server"})


@app.post("/connect/request")
def connect_request():
    data = request.get_json(force=True)

    client_id = data.get("clientId", "demo-client")
    target = data.get("target", "deploy-target")
    vfa = bool(data.get("vfa", False))
    version = data.get("version", "0.1")
    mode = data.get("mode", "required")

    session_id = secrets.token_hex(8)
    created_at = now_ts()
    expires_at = created_at + SESSION_TTL_SECONDS

    vfa_accepted = vfa and version == "0.1"

    status = "negotiated" if vfa_accepted else "fallback"

    SESSIONS[session_id] = {
        "sessionId": session_id,
        "clientId": client_id,
        "target": target,
        "vfaRequested": vfa,
        "version": version,
        "mode": mode,
        "vfaAccepted": vfa_accepted,
        "status": status,
        "createdAt": created_at,
        "expiresAt": expires_at,
    }

    return jsonify({
        "ok": True,
        "sessionId": session_id,
        "vfaAccepted": vfa_accepted,
        "status": status,
        "next": "intent_handshake" if vfa_accepted else "fallback",
    }), 201


@app.get("/connect/<session_id>")
def get_session(session_id: str):
    session = SESSIONS.get(session_id)
    if not session:
        return jsonify({"ok": False, "error": "session_not_found"}), 404
    return jsonify({"ok": True, "session": session})


@app.post("/intent/request")
def create_intent():
    data = request.get_json(force=True)

    session_id = data.get("sessionId")
    if not session_id:
        return jsonify({"ok": False, "error": "missing_session_id"}), 400

    session = SESSIONS.get(session_id)
    if not session:
        return jsonify({"ok": False, "error": "session_not_found"}), 404

    if not session.get("vfaAccepted"):
        return jsonify({"ok": False, "error": "vfa_not_negotiated"}), 403

    service = data.get("service", "payments-api")
    env = data.get("env", "production")
    commit_hash = data.get("commit", "unknown")
    requested_by = data.get("requestedBy", "demo-client")
    intent_type = data.get("intent", "deploy")

    intent_id = secrets.token_hex(8)
    created_at = now_ts()
    expires_at = created_at + TOKEN_TTL_SECONDS

    INTENTS[intent_id] = {
        "intentId": intent_id,
        "sessionId": session_id,
        "intent": intent_type,
        "service": service,
        "env": env,
        "commit": commit_hash,
        "requestedBy": requested_by,
        "status": "pending",
        "createdAt": created_at,
        "expiresAt": expires_at,
        "approvedBy": None,
        "approvedAt": None,
        "tokenId": None,
    }

    return jsonify({
        "ok": True,
        "intentId": intent_id,
        "walletUrl": f"http://localhost:8080/?intentId={intent_id}",
    }), 201


@app.get("/intent/<intent_id>")
def get_intent(intent_id: str):
    item = INTENTS.get(intent_id)
    if not item:
        return jsonify({"ok": False, "error": "intent_not_found"}), 404

    session = SESSIONS.get(item["sessionId"])
    return jsonify({
        "ok": True,
        "intent": item,
        "session": session,
    })


@app.get("/intent/<intent_id>/token")
def get_token_for_intent(intent_id: str):
    item = INTENTS.get(intent_id)
    if not item:
        return jsonify({"ok": False, "error": "intent_not_found"}), 404

    token_id = item.get("tokenId")
    if not token_id:
        return jsonify({"ok": False, "error": "token_not_issued"}), 404

    token_row = TOKENS.get(token_id)
    if not token_row:
        return jsonify({"ok": False, "error": "token_not_found"}), 404

    return jsonify({"ok": True, "token": token_row["token"]})


@app.post("/intent/<intent_id>/approve")
def approve_intent(intent_id: str):
    item = INTENTS.get(intent_id)
    if not item:
        return jsonify({"ok": False, "error": "intent_not_found"}), 404

    if item["status"] != "pending":
        return jsonify({"ok": False, "error": "intent_not_pending"}), 400

    session = SESSIONS.get(item["sessionId"])
    if not session or not session.get("vfaAccepted"):
        return jsonify({"ok": False, "error": "invalid_session"}), 403

    data = request.get_json(force=True, silent=True) or {}
    approved_by = data.get("approvedBy", "wallet-user")

    token_id = secrets.token_hex(8)
    issued_at = now_ts()
    exp = issued_at + TOKEN_TTL_SECONDS

    payload = {
        "tokenId": token_id,
        "iss": "vfa-policy-server",
        "sub": "deploy-operation",
        "aud": "vfa-gateway",
        "sessionId": item["sessionId"],
        "intentId": intent_id,
        "intent": item["intent"],
        "env": item["env"],
        "service": item["service"],
        "commit": item["commit"],
        "requestedBy": item["requestedBy"],
        "approvedBy": approved_by,
        "iat": issued_at,
        "exp": exp,
    }

    token = sign_payload(payload)

    TOKENS[token_id] = {
        "tokenId": token_id,
        "intentId": intent_id,
        "sessionId": item["sessionId"],
        "token": token,
        "createdAt": issued_at,
        "expiresAt": exp,
        "revoked": False,
    }

    item["status"] = "approved"
    item["approvedBy"] = approved_by
    item["approvedAt"] = issued_at
    item["tokenId"] = token_id

    return jsonify({"ok": True, "token": token, "payload": payload})


@app.post("/intent/<intent_id>/reject")
def reject_intent(intent_id: str):
    item = INTENTS.get(intent_id)
    if not item:
        return jsonify({"ok": False, "error": "intent_not_found"}), 404

    if item["status"] != "pending":
        return jsonify({"ok": False, "error": "intent_not_pending"}), 400

    item["status"] = "rejected"
    return jsonify({"ok": True, "status": "rejected"})


@app.post("/visa/verify")
def visa_verify():
    data = request.get_json(force=True)
    token = data.get("token", "")
    ok, reason, payload = verify_token(token)
    return jsonify({"ok": ok, "reason": reason, "payload": payload}), (200 if ok else 400)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
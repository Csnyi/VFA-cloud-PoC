from __future__ import annotations

import time

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "deploy-target"})


@app.post("/deploy")
def deploy():
    data = request.get_json(force=True)

    session_id = data.get("sessionId")
    service = data.get("service")
    env = data.get("env")
    commit = data.get("commit")
    approved_by = data.get("approvedBy")
    requested_by = data.get("requestedBy")
    intent_id = data.get("intentId")

    if not session_id:
        return jsonify({"ok": False, "error": "missing_session_id"}), 400

    if env != "production":
        return jsonify({"ok": False, "error": "only_production_demo_supported"}), 400

    return jsonify({
        "ok": True,
        "message": "deploy accepted by protected target",
        "deploy": {
            "sessionId": session_id,
            "service": service,
            "env": env,
            "commit": commit,
            "approvedBy": approved_by,
            "requestedBy": requested_by,
            "intentId": intent_id,
            "executedAt": int(time.time()),
        }
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
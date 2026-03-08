from __future__ import annotations

import time

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "sandbox-target"})


@app.post("/deploy")
def deploy():
    data = request.get_json(force=True, silent=True) or {}

    return jsonify({
        "ok": True,
        "message": "request routed to SANDBOX target",
        "sandbox": True,
        "deploy": {
            "service": data.get("service"),
            "env": data.get("env"),
            "commit": data.get("commit"),
            "sessionId": data.get("sessionId"),
            "requestedBy": data.get("requestedBy"),
            "executedAt": int(time.time()),
        }
    })
    

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)
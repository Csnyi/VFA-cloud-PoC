# VFA-cloud-PoC

Proof of Concept implementation of the **Virtual Flow Agreement (VFA)** protocol applied to cloud operations.

The goal of this project is to demonstrate how **wallet-mediated intent verification** can control sensitive actions in a cloud environment.

Instead of directly executing operations, requests pass through a **multi-entity verification flow** involving a policy server and a user-controlled wallet.

---

# Concept

VFA introduces a **verification layer between intent and execution**.

Before a sensitive action (for example a production deployment) can occur, the system performs a verification handshake between several entities.

Client → Gateway → Policy → Wallet → Policy → Gateway → Production

Only after the wallet confirms the intent and the policy server issues a **visa token**, the gateway allows the operation.

---

# Demo Flow

Example scenario implemented in this PoC:

1. Client requests a production deployment
2. Gateway starts VFA negotiation
3. Policy server creates an intent
4. Wallet displays the intent
5. User approves or rejects
6. Policy server issues a signed visa token
7. Gateway allows or blocks the deployment

---

# Components

## Dashboard

Interactive visual simulator showing the VFA protocol flow.

Displays:

- client request
- policy negotiation
- wallet approval
- gateway routing decision

---

## Wallet

Minimal wallet interface used to:

- review intents
- approve or reject actions
- send the decision back to the policy system

---

## Policy Server

Responsible for:

- generating intents
- verifying wallet decisions
- issuing visa tokens

---

## Gateway

The gateway enforces the decision.

Based on VFA verification it routes requests to:

- production
- sandbox
- deny

---

# Motivation

Modern infrastructure automation allows extremely powerful operations to be triggered automatically.

The VFA model explores an alternative approach where critical operations require **explicit and verifiable human intent confirmation**.

Potential use cases include:

- production deployments
- infrastructure changes
- financial operations
- API access control
- privileged operations

---

# Project Status

Research prototype / proof of concept.

This repository focuses on **visualizing and validating the protocol flow**, not on production-ready security implementation.

---

# License

Apache-2.0
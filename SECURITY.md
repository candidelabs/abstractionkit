# Security Policy

## Supported Versions

Only the latest stable version published to npm is supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.3.1   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in AbstractionKit, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email **team@candidelabs.com** with:

- A description of the vulnerability
- Steps to reproduce or a proof of concept
- The affected version(s)
- Any potential impact assessment

We will acknowledge receipt within **48 hours** and aim to provide an initial assessment within **5 business days**.

## Scope

The following are in scope for security reports:

- Incorrect UserOperation encoding or signing that could lead to unauthorized transactions
- Signature validation bypasses
- Vulnerabilities in calldata encoding (e.g., MetaTransaction, MultiSend)
- Issues that could cause loss of funds through misuse of the library's API
- Dependency vulnerabilities that directly affect AbstractionKit

The following are **out of scope**:

- Vulnerabilities in third-party bundlers, paymasters, or RPC providers
- Issues in the underlying Smart contracts (Ex:Safe smart contracts or EntryPoint contracts). Report those to the respective teams. 
- Denial of service against external services
- Social engineering

## Disclosure Policy

- We follow coordinated disclosure. Please allow us reasonable time to address the issue before any public disclosure.
- We will credit reporters in the fix announcement unless they prefer to remain anonymous.

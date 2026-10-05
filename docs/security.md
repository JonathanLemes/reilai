# Security model

ReilAI controls coding agents that can run commands on your computer, so access is
treated as root-equivalent. This document describes every way in and how it is protected.

## Surfaces

| Surface | Listens on | Who can use it | Protection |
| --- | --- | --- | --- |
| Daemon | `127.0.0.1:7410` | CLI, web service, tunnel (same user) | Random bearer token in `~/.reilai/daemon.json` (mode 0600), loopback only |
| Web service | `0.0.0.0:7420` | Browsers / installed PWA | Access token (`~/.reilai/web-token`), method allowlist. Put it behind HTTPS (Tailscale Serve, Caddy…) when used outside a trusted network |
| Tunnel | `0.0.0.0:7430` (+ optional relay uplink) | Paired native apps | End-to-end encrypted channel below, device allowlist, method allowlist |
| Relay | public host | Nobody (forwards opaque frames) | Sees only ciphertext and a routing id |

Remote clients (web and tunnel) can only call the methods in `REMOTE_METHODS`
(`packages/protocol`). Pairing management (`pairing.create`, `devices.authorize`) is local only.

## Tunnel channel

Primitives available natively on every platform: **X25519**, **HKDF-SHA256**, **AES-256-GCM**
(Node/Bun `crypto`, Android Tink + JCE, iOS CryptoKit). Happy uses the same family
(NaCl box key exchange + AES-256-GCM data keys); ReilAI adds forward secrecy and mutual
authentication on every connection.

Keys:

- **Machine key** `S_m`: long-term X25519 pair in `~/.reilai/machine.key.json` (0600).
- **Device key** `D_c`: long-term X25519 pair created on the phone, stored in
  `EncryptedSharedPreferences` (Android Keystore backed).
- **Ephemeral keys** `e_c`, `e_s`: fresh per connection.

Handshake (one round trip):

```
C → S  { t: "hello", v: 1, dpk: D_c.pub, epk: e_c.pub }
S → C  { t: "hello", v: 1, mpk: S_m.pub, epk: e_s.pub }

ikm = DH(e_c, e_s) ‖ DH(e_c, S_m) ‖ DH(D_c, S_m)
th  = SHA-256("reilai-v1" ‖ dpk ‖ epk_c ‖ mpk ‖ epk_s)
k_c2s ‖ k_s2c = HKDF-SHA256(ikm, salt = th, info = "reilai/v1/keys", L = 64)
```

- `DH(e_c, e_s)` gives forward secrecy: recorded traffic stays private even if long-term keys leak later.
- `DH(e_c, S_m)` authenticates the computer: the phone pins `mpk` from the QR code, and only the
  holder of `S_m` can derive the keys.
- `DH(D_c, S_m)` authenticates the phone: a device that replays someone else's `dpk` cannot derive the keys.

Frames after the handshake: `{ n, c }` where `c = AES-256-GCM(k, nonce = 0⁴ ‖ n₆₄, aad = "c2s"|"s2c")`.
`n` must be exactly the next counter, so replayed, dropped or reordered frames kill the
connection. Any failure closes the session; there is no resync.

## Pairing

`reilai pair` creates a one-time token (24 random bytes, 10 minutes, memory only) and shows
`reilai://pair?k=<machine key>&t=<token>&u=<tunnel urls>&n=<name>` as a QR code.

The first encrypted frame from the phone is `{ t: "auth", pair: <token>, name }`. The daemon
checks the token in constant time, registers the device public key and burns the token.
Later connections authenticate by key alone. `reilai devices revoke <id>` (or Settings) removes
a device and the tunnel drops its live connection immediately.

The token travels inside the encrypted channel, so a relay or network observer that sees the
handshake cannot use it. Treat the QR code itself as a secret while it is valid.

## Known limits

- The web service uses a bearer token over plain HTTP by default. Use HTTPS outside your LAN/Tailnet.
- Anyone with your Unix account can read `~/.reilai` and therefore control the daemon.
- The relay can see connection timing and sizes, and can drop traffic.

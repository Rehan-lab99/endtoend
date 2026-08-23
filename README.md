# ShareClone P2P WebRTC

A Shareli-style room sharing starter that uses Socket.IO only for room/signaling and WebRTC DataChannels for peer-to-peer text and file transfer.

## Run on Windows

```bash
npm install
npm start
```

Open http://localhost:5000

## How to test

1. Create/open a room.
2. Open the same room URL on a second device/browser.
3. Wait for `P2P connected`.
4. Send text or a file.

## Hosting

Deploy the Node app to a WebSocket-capable host such as Render. Build: `npm install`. Start: `npm start`.

For production, add TURN servers for users behind restrictive NATs. STUN alone does not guarantee connectivity.

## Large files

The browser sends 16KB chunks through a WebRTC DataChannel and applies backpressure. The server does not receive the file bytes. WebRTC DataChannels are protected by DTLS.

The receiver in this starter collects chunks in browser memory before offering a download. For very large files, the next production improvement is File System Access API streaming, plus resumable transfers and per-transfer acknowledgements.

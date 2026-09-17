# WhatsApp Service (Baileys)

Small TypeScript HTTP service using [Baileys](https://github.com/WhiskeySockets/Baileys).

It provides the same initial functionality as the original `whatsapp-service`:

- QR-code login with persistent local auth
- Ready/connection status
- Send text messages
- Send media from a URL
- Express HTTP API

This first version intentionally does **not** include a group message listener.

## Requirements

- Node.js 20+
- A WhatsApp account that can link a device

## Install and run

```bash
npm install
npm run build
npm start
```

Scan the QR code shown in the terminal from WhatsApp's **Linked devices** screen.
Credentials are stored in `auth_info_baileys/` and must not be committed.

Optional configuration:

```bash
PORT=3001
WHATSAPP_AUTH_DIR=auth_info_baileys
LOG_LEVEL=info
```

## API

### Health

```bash
curl -i http://localhost:3001/health
```

Returns HTTP 200 when WhatsApp is connected and HTTP 503 otherwise.

### Send text

The `to` value must be a WhatsApp JID, for example `6281234567890@s.whatsapp.net`.

```bash
curl -X POST http://localhost:3001/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "to": "62895333537537@s.whatsapp.net",
    "message": "Hello from Baileys"
  }'
```

For a group, use its JID ending in `@g.us`.

### Send media

```bash
curl -X POST http://localhost:3001/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "to": "62895333537537@s.whatsapp.net",
    "message": "Here is your image!",
    "media_url": "https://fastly.picsum.photos/id/513/200/300.jpg?hmac=KcBD-M89_o9rkXWW6PS2yEfAMCfd3TH9McppOsf3GZ0"
  }'
```

Images, videos, audio, and other content types are handled based on the response `Content-Type`.

## Notes

- Baileys authentication is not compatible with the old `whatsapp-web.js` `LocalAuth` directory. A new QR scan is required.
- Do not expose this service publicly without authentication. The initial API intentionally has no auth middleware.
- The service reconnects automatically unless WhatsApp explicitly logs the device out.
- Remove `auth_info_baileys/` and restart to link a different WhatsApp account.

## License

ISC

import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import type { WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode-terminal";

const app = express();
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

const PORT = Number(process.env.PORT ?? 3001);
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR ?? "auth_info_baileys";
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

let sock: WASocket | null = null;
let connectionState: "connecting" | "open" | "closed" = "connecting";
let reconnectTimer: NodeJS.Timeout | undefined;
let isShuttingDown = false;

function getSocket(): WASocket {
  if (!sock || connectionState !== "open") {
    throw new Error("WhatsApp is not connected");
  }
  return sock;
}

async function startWhatsApp(): Promise<void> {
  if (isShuttingDown) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const nextSocket = makeWASocket({
    auth: state,
    version,
    browser: Browsers.ubuntu("Chrome"),
    logger: logger.child({ component: "baileys" }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock = nextSocket;
  connectionState = "connecting";

  nextSocket.ev.on("creds.update", saveCreds);
  nextSocket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("Scan this QR code with WhatsApp > Linked devices:");
      QRCode.generate(qr, { small: true });
    }

    if (connection === "open") {
      connectionState = "open";
      console.log("WhatsApp client is ready!");
      return;
    }

    if (connection !== "close") return;

    connectionState = "closed";
    sock = null;
    const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
      ?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;

    if (loggedOut) {
      console.error("WhatsApp logged out. Remove the auth directory and restart to scan again.");
      return;
    }

    console.error("WhatsApp connection closed; reconnecting in 5 seconds.");
    reconnectTimer = setTimeout(() => {
      startWhatsApp().catch((error) => {
        console.error("Failed to reconnect:", error);
      });
    }, 5000);
  });
}

function mediaTypeFromContentType(contentType: string): "image" | "video" | "audio" | "document" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "document";
}

app.get("/health", (_req: Request, res: Response) => {
  res.status(connectionState === "open" ? 200 : 503).json({
    service: "whatsapp-service-baileys",
    whatsapp: connectionState,
  });
});

app.post("/send-message", async (req: Request, res: Response) => {
  const { to, message, media_url: mediaUrl } = req.body as {
    to?: string;
    message?: string;
    media_url?: string;
  };

  if (!to || !message) {
    res.status(400).json({ error: 'Missing "to" or "message" in request body' });
    return;
  }

  try {
    const client = getSocket();

    if (!mediaUrl) {
      await client.sendMessage(to, { text: message });
    } else {
      const response = await fetch(mediaUrl);
      if (!response.ok) {
        throw new Error(`Failed to download media: HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const buffer = Buffer.from(await response.arrayBuffer());
      const mediaType = mediaTypeFromContentType(contentType);

      if (mediaType === "image") {
        await client.sendMessage(to, { image: buffer, caption: message, mimetype: contentType });
      } else if (mediaType === "video") {
        await client.sendMessage(to, { video: buffer, caption: message, mimetype: contentType });
      } else if (mediaType === "audio") {
        await client.sendMessage(to, { audio: buffer, mimetype: contentType });
      } else {
        await client.sendMessage(to, { document: buffer, caption: message, mimetype: contentType, fileName: "attachment" });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to send message:", error);
    const messageText = error instanceof Error ? error.message : "Failed to send message";
    res.status(messageText === "WhatsApp is not connected" ? 503 : 500).json({ error: messageText });
  }
});

app.listen(PORT, () => {
  console.log(`HTTP server is running on port ${PORT}`);
  startWhatsApp().catch((error) => {
    console.error("Failed to initialize WhatsApp:", error);
    connectionState = "closed";
  });
});

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  sock?.ws?.close();
  console.log(`Shut down after ${signal}`);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

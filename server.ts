import express from "express";
import cors from "cors";
import path from "path";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, remove } from "firebase/database";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// --- State Models ---
interface Session {
  id: string;
  avatarSeed: string;
  name: string;
  connectedRoomId: string | null;
  lastActive: number;
}

interface FileAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  file?: FileAttachment;
}

interface Room {
  id: string;
  peerA: string;
  peerB: string;
  messages: Message[];
  typing: { [sessionId: string]: boolean };
  createdTime: number;
}

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string; // Base64 data
  uploaderSessionId: string;
  roomId: string;
}

// --- Live Active WebSockets Store (In-Memory Only) ---
const activeSockets = new Map<string, WebSocket>();

function cleanUndefined(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined);
  }
  if (typeof obj === "object") {
    const cleaned: any = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined) {
        cleaned[key] = cleanUndefined(val);
      }
    }
    return cleaned;
  }
  return obj;
}

// --- Firebase RTDB Helper Functions ---
async function getSession(id: string): Promise<Session | null> {
  try {
    const snap = await get(ref(db, `sessions/${id}`));
    return snap.exists() ? (snap.val() as Session) : null;
  } catch (e) {
    console.error(`Error reading session ${id}:`, e);
    return null;
  }
}

async function saveSession(session: Session): Promise<void> {
  try {
    const payload = cleanUndefined({
      id: session.id,
      avatarSeed: session.avatarSeed,
      name: session.name,
      connectedRoomId: session.connectedRoomId,
      lastActive: session.lastActive
    });
    await set(ref(db, `sessions/${session.id}`), payload);
  } catch (e) {
    console.error(`Error saving session ${session.id}:`, e);
  }
}

async function deleteSession(id: string): Promise<void> {
  try {
    await remove(ref(db, `sessions/${id}`));
  } catch (e) {
    console.error(`Error deleting session ${id}:`, e);
  }
}

async function getRoom(id: string): Promise<Room | null> {
  try {
    const snap = await get(ref(db, `rooms/${id}`));
    if (snap.exists()) {
      const room = snap.val() as Room;
      if (!room.messages) room.messages = [];
      if (!room.typing) room.typing = {};
      return room;
    }
    return null;
  } catch (e) {
    console.error(`Error reading room ${id}:`, e);
    return null;
  }
}

async function saveRoom(room: Room): Promise<void> {
  try {
    const payload = cleanUndefined({
      id: room.id,
      peerA: room.peerA,
      peerB: room.peerB,
      messages: room.messages || [],
      typing: room.typing || {},
      createdTime: room.createdTime
    });
    await set(ref(db, `rooms/${room.id}`), payload);
  } catch (e) {
    console.error(`Error saving room ${room.id}:`, e);
  }
}

async function deleteRoom(id: string): Promise<void> {
  try {
    await remove(ref(db, `rooms/${id}`));
  } catch (e) {
    console.error(`Error deleting room ${id}:`, e);
  }
}

async function getFile(id: string): Promise<UploadedFile | null> {
  try {
    const snap = await get(ref(db, `files/${id}`));
    return snap.exists() ? (snap.val() as UploadedFile) : null;
  } catch (e) {
    console.error(`Error reading file ${id}:`, e);
    return null;
  }
}

async function saveFile(file: UploadedFile): Promise<void> {
  try {
    const payload = cleanUndefined(file);
    await set(ref(db, `files/${file.id}`), payload);
  } catch (e) {
    console.error(`Error saving file ${file.id}:`, e);
  }
}

async function deleteFile(id: string): Promise<void> {
  try {
    await remove(ref(db, `files/${id}`));
  } catch (e) {
    console.error(`Error deleting file ${id}:`, e);
  }
}

// Clean up idle sessions (inactive for > 30 minutes)
setInterval(async () => {
  const now = Date.now();
  const idleTimeout = 30 * 60 * 1000; // 30 minutes

  try {
    const sessionsSnap = await get(ref(db, "sessions"));
    if (sessionsSnap.exists()) {
      const allSessions = sessionsSnap.val() as Record<string, Session>;
      for (const [id, session] of Object.entries(allSessions)) {
        const hasLiveSocket = activeSockets.has(id);
        if (now - session.lastActive > idleTimeout && !hasLiveSocket) {
          console.log(`Cleaning up idle session: ${id}`);
          if (session.connectedRoomId) {
            const room = await getRoom(session.connectedRoomId);
            if (room) {
              const peerId = room.peerA === id ? room.peerB : room.peerA;
              const peerSocket = activeSockets.get(peerId);
              if (peerSocket) {
                const peerSession = await getSession(peerId);
                if (peerSession) {
                  peerSession.connectedRoomId = null;
                  await saveSession(peerSession);
                }
                if (peerSocket.readyState === WebSocket.OPEN) {
                  peerSocket.send(JSON.stringify({ type: "peer-disconnected", reason: "timeout" }));
                }
              }
              await deleteRoom(session.connectedRoomId);
            }
          }
          await deleteSession(id);
        }
      }
    }

    // Clean up unused files belonging to deleted rooms
    const filesSnap = await get(ref(db, "files"));
    if (filesSnap.exists()) {
      const allFiles = filesSnap.val() as Record<string, UploadedFile>;
      for (const [fileId, file] of Object.entries(allFiles)) {
        const roomSnap = await get(ref(db, `rooms/${file.roomId}`));
        if (!roomSnap.exists()) {
          await deleteFile(fileId);
        }
      }
    }
  } catch (err) {
    console.error("Error in periodic cleanup interval:", err);
  }
}, 10 * 60 * 1000); // Check every 10 minutes

// Helper to generate a unique ID
function generateUUID(): string {
  return [
    randomBytes(4).toString("hex"),
    randomBytes(2).toString("hex"),
    randomBytes(2).toString("hex"),
    randomBytes(2).toString("hex"),
    randomBytes(6).toString("hex"),
  ].join("-");
}

const adjectives = ["Neon", "Quantum", "Cyber", "Sonic", "Lunar", "Solar", "Pixel", "Astral", "Aero", "Hyper"];
const nouns = ["Photon", "Matrix", "Echo", "Wave", "Vector", "Pulse", "Nova", "Flux", "Orbit", "Glitch"];

function generateRandomName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

async function startServer() {
  const app = express();
  app.use(cors());
  const PORT = Number(process.env.PORT) || 3001;

  // Body parser with comfortable limit for file sharing (e.g. 15MB)
  app.use(express.json({ limit: "20mb" }));

  // --- API Routes ---

  // Register session / Handshake
  app.post("/api/session/register", async (req, res) => {
    let { sessionId } = req.body;
    let isNew = false;
    let session: Session | null = null;

    if (sessionId) {
      session = await getSession(sessionId);
    }

    if (session) {
      session.lastActive = Date.now();
      await saveSession(session);
    } else {
      isNew = true;
      const newId = sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : generateUUID();
      session = {
        id: newId,
        avatarSeed: Math.random().toString(36).substring(7),
        name: generateRandomName(),
        connectedRoomId: null,
        lastActive: Date.now(),
      };
      await saveSession(session);
    }

    res.json({
      success: true,
      isNew,
      session: {
        id: session.id,
        avatarSeed: session.avatarSeed,
        name: session.name,
        connectedRoomId: session.connectedRoomId,
      },
    });
  });

  // Upload file endpoint
  app.post("/api/upload", async (req, res) => {
    const { sessionId, roomId, name, type, size, data } = req.body;

    if (!sessionId || !roomId || !name || !data) {
      res.status(400).json({ success: false, error: "Missing required fields" });
      return;
    }

    // Verify session
    const session = await getSession(sessionId);
    if (!session || session.connectedRoomId !== roomId) {
      res.status(403).json({ success: false, error: "Unauthorized session or invalid room" });
      return;
    }

    // Verify room
    const room = await getRoom(roomId);
    if (!room || (room.peerA !== sessionId && room.peerB !== sessionId)) {
      res.status(403).json({ success: false, error: "Unauthorized access to room" });
      return;
    }

    // Max 15MB upload limit (additional server-side safety check)
    const sizeInBytes = Buffer.byteLength(data, "base64");
    if (sizeInBytes > 15 * 1024 * 1024) {
      res.status(400).json({ success: false, error: "File exceeds 15MB limit" });
      return;
    }

    const fileId = generateUUID();
    await saveFile({
      id: fileId,
      name,
      type: type || "application/octet-stream",
      size: size || sizeInBytes,
      data,
      uploaderSessionId: sessionId,
      roomId,
    });

    res.json({ success: true, fileId });
  });

  // Secure download/view file endpoint
  app.get("/api/file/:fileId", async (req, res) => {
    const { fileId } = req.params;
    const { sessionId } = req.query;

    if (!fileId || !sessionId) {
      res.status(400).send("Missing fileId or sessionId parameter");
      return;
    }

    const file = await getFile(fileId);
    if (!file) {
      res.status(404).send("File not found");
      return;
    }

    // Verify the user downloading is a participant in the room the file was shared in
    const session = await getSession(sessionId as string);
    if (!session || session.connectedRoomId !== file.roomId) {
      res.status(403).send("Unauthorized download access");
      return;
    }

    const room = await getRoom(file.roomId);
    if (!room || (room.peerA !== sessionId && room.peerB !== sessionId)) {
      res.status(403).send("Unauthorized download access");
      return;
    }

    // Serve file from base64 representation
    const fileBuffer = Buffer.from(file.data, "base64");
    res.setHeader("Content-Type", file.type);
    res.setHeader("Content-Length", fileBuffer.length);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.name)}"`
    );
    res.send(fileBuffer);
  });

  const server = http.createServer(app);

  // --- WebSocket Setup ---
  const wss = new WebSocketServer({ server });

  // Quick helper to safely send JSON to a client
  function sendJson(ws: WebSocket, payload: any) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  wss.on("connection", (ws, req) => {
    let currentSessionId: string | null = null;

    ws.on("message", async (rawMessage) => {
      try {
        const payload = JSON.parse(rawMessage.toString());
        const { type } = payload;

        if (type === "register-ws") {
          const { sessionId } = payload;
          const session = await getSession(sessionId);
          if (session) {
            currentSessionId = sessionId;
            activeSockets.set(sessionId, ws);
            session.lastActive = Date.now();
            await saveSession(session);

            console.log(`WebSocket registered for session: ${sessionId}`);

            // Let client know registration is complete and push state
            sendJson(ws, {
              type: "ws-registered",
              sessionId,
              name: session.name,
              connectedRoomId: session.connectedRoomId,
            });

            // If session already belongs to an active room, synchronize room history
            if (session.connectedRoomId) {
              const room = await getRoom(session.connectedRoomId);
              if (room) {
                const peerId = room.peerA === sessionId ? room.peerB : room.peerA;
                const peerSession = await getSession(peerId);
                const peerSocket = activeSockets.get(peerId);

                sendJson(ws, {
                  type: "room-sync",
                  roomId: room.id,
                  messages: room.messages || [],
                  peer: peerSession ? {
                    id: peerSession.id,
                    name: peerSession.name,
                    avatarSeed: peerSession.avatarSeed,
                    online: !!peerSocket && peerSocket.readyState === WebSocket.OPEN,
                  } : null,
                });

                // Notify other peer that this user is online/reconnected
                if (peerSocket) {
                  sendJson(peerSocket, {
                    type: "peer-status-change",
                    online: true,
                  });
                }
              }
            }
          } else {
            sendJson(ws, { type: "error", message: "Invalid or expired session" });
          }
        }

        // Keep Alive / Heartbeat
        if (type === "ping") {
          if (currentSessionId) {
            const session = await getSession(currentSessionId);
            if (session) {
              session.lastActive = Date.now();
              await saveSession(session);
            }
          }
          sendJson(ws, { type: "pong" });
        }

        // Connection request flow
        if (type === "request-connection") {
          const { targetSessionId } = payload;
          if (!currentSessionId) return;

          const sender = await getSession(currentSessionId);
          const target = await getSession(targetSessionId);

          if (!sender) {
            sendJson(ws, { type: "error", message: "Your session is invalid" });
            return;
          }

          if (!target) {
            sendJson(ws, { type: "error", message: "Recipient QR session has expired or is invalid" });
            return;
          }

          if (sender.id === target.id) {
            sendJson(ws, { type: "error", message: "You cannot connect with your own session" });
            return;
          }

          if (target.connectedRoomId) {
            sendJson(ws, { type: "error", message: "Recipient is currently busy in another active chat session" });
            return;
          }

          if (sender.connectedRoomId) {
            sendJson(ws, { type: "error", message: "You are already connected to an active room. Please disconnect first." });
            return;
          }

          const targetSocket = activeSockets.get(target.id);
          // Forward connection request to target
          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            sendJson(targetSocket, {
              type: "incoming-request",
              sender: {
                id: sender.id,
                name: sender.name,
                avatarSeed: sender.avatarSeed,
              },
            });
            // Acknowledge request sent
            sendJson(ws, { type: "request-sent", targetId: target.id });
          } else {
            sendJson(ws, { type: "error", message: "Recipient is offline. Wait for them to reconnect their QR scanner." });
          }
        }

        // Respond connection flow (accept / decline)
        if (type === "respond-connection") {
          const { targetSessionId, accept } = payload;
          if (!currentSessionId) return;

          const responder = await getSession(currentSessionId);
          const sender = await getSession(targetSessionId);

          if (!responder || !sender) {
            sendJson(ws, { type: "error", message: "Session invalid or expired" });
            return;
          }

          const senderSocket = activeSockets.get(sender.id);

          if (!accept) {
            // Forward decline message to sender
            if (senderSocket) {
              sendJson(senderSocket, {
                type: "connection-declined",
                responderName: responder.name,
              });
            }
            return;
          }

          // Create standard secure Room
          if (responder.connectedRoomId || sender.connectedRoomId) {
            sendJson(ws, { type: "error", message: "One of the peers is already connected in a chat room." });
            return;
          }

          const roomId = `room-${generateUUID()}`;
          const newRoom: Room = {
            id: roomId,
            peerA: sender.id,
            peerB: responder.id,
            messages: [],
            typing: {
              [sender.id]: false,
              [responder.id]: false,
            },
            createdTime: Date.now(),
          };

          await saveRoom(newRoom);

          sender.connectedRoomId = roomId;
          responder.connectedRoomId = roomId;
          await saveSession(sender);
          await saveSession(responder);

          const responderSocket = activeSockets.get(responder.id);

          // Notify both peers of established session
          const payloadToSender = {
            type: "connection-established",
            roomId,
            peer: {
              id: responder.id,
              name: responder.name,
              avatarSeed: responder.avatarSeed,
              online: !!responderSocket && responderSocket.readyState === WebSocket.OPEN,
            },
          };

          const payloadToResponder = {
            type: "connection-established",
            roomId,
            peer: {
              id: sender.id,
              name: sender.name,
              avatarSeed: sender.avatarSeed,
              online: !!senderSocket && senderSocket.readyState === WebSocket.OPEN,
            },
          };

          if (senderSocket) sendJson(senderSocket, payloadToSender);
          if (responderSocket) sendJson(responderSocket, payloadToResponder);
        }

        // Chat messages
        if (type === "chat-message") {
          const { roomId, text, file } = payload;
          if (!currentSessionId) return;

          const sender = await getSession(currentSessionId);
          if (!sender || sender.connectedRoomId !== roomId) {
            sendJson(ws, { type: "error", message: "Access unauthorized to this chat room" });
            return;
          }

          const room = await getRoom(roomId);
          if (!room || (room.peerA !== currentSessionId && room.peerB !== currentSessionId)) {
            sendJson(ws, { type: "error", message: "Room not found or unauthorized" });
            return;
          }

          const newMessage: Message = {
            id: generateUUID(),
            senderId: currentSessionId,
            senderName: sender.name,
            text: text || "",
            timestamp: Date.now(),
            file: file ? {
              id: file.id,
              name: file.name,
              type: file.type,
              size: file.size,
            } : undefined,
          };

          if (!room.messages) room.messages = [];
          room.messages.push(newMessage);
          await saveRoom(room);

          const peerId = room.peerA === currentSessionId ? room.peerB : room.peerA;
          const peerSocket = activeSockets.get(peerId);

          // Deliver message to sender (as confirmation)
          sendJson(ws, {
            type: "message-received",
            roomId,
            message: newMessage,
          });

          // Deliver message to peer
          if (peerSocket) {
            sendJson(peerSocket, {
              type: "message-received",
              roomId,
              message: newMessage,
            });
          }
        }

        // Typing states
        if (type === "typing") {
          const { roomId, isTyping } = payload;
          if (!currentSessionId) return;

          const room = await getRoom(roomId);
          if (!room || (room.peerA !== currentSessionId && room.peerB !== currentSessionId)) return;

          if (!room.typing) room.typing = {};
          room.typing[currentSessionId] = !!isTyping;
          await saveRoom(room);

          const peerId = room.peerA === currentSessionId ? room.peerB : room.peerA;
          const peerSocket = activeSockets.get(peerId);

          if (peerSocket) {
            sendJson(peerSocket, {
              type: "peer-typing",
              isTyping: !!isTyping,
            });
          }
        }

        // Delete message (local and synced)
        if (type === "delete-message") {
          const { roomId, messageId } = payload;
          if (!currentSessionId) return;

          const room = await getRoom(roomId);
          if (!room || (room.peerA !== currentSessionId && room.peerB !== currentSessionId)) return;

          if (!room.messages) room.messages = [];
          const msgIndex = room.messages.findIndex((m) => m.id === messageId);
          if (msgIndex !== -1) {
            // Check if sender is current user (only sender can delete from server room history for security)
            if (room.messages[msgIndex].senderId === currentSessionId) {
              room.messages.splice(msgIndex, 1);
              await saveRoom(room);

              const peerId = room.peerA === currentSessionId ? room.peerB : room.peerA;
              const peerSocket = activeSockets.get(peerId);

              // Notify peer
              if (peerSocket) {
                sendJson(peerSocket, {
                  type: "message-deleted",
                  roomId,
                  messageId,
                });
              }

              // Confirm to current user
              sendJson(ws, {
                type: "message-deleted",
                roomId,
                messageId,
              });
            } else {
              sendJson(ws, { type: "error", message: "You can only delete your own messages" });
            }
          }
        }

        // Disconnect Room / Leave chat
        if (type === "leave-room") {
          const { roomId } = payload;
          if (!currentSessionId) return;

          const room = await getRoom(roomId);
          if (room && (room.peerA === currentSessionId || room.peerB === currentSessionId)) {
            const peerId = room.peerA === currentSessionId ? room.peerB : room.peerA;
            const peerSocket = activeSockets.get(peerId);

            // Clean room references
            const s1 = await getSession(room.peerA);
            const s2 = await getSession(room.peerB);
            if (s1) {
              s1.connectedRoomId = null;
              await saveSession(s1);
            }
            if (s2) {
              s2.connectedRoomId = null;
              await saveSession(s2);
            }

            await deleteRoom(roomId);

            // Clean files uploaded in this room
            try {
              const filesSnap = await get(ref(db, "files"));
              if (filesSnap.exists()) {
                const allFiles = filesSnap.val() as Record<string, UploadedFile>;
                for (const [fileId, file] of Object.entries(allFiles)) {
                  if (file.roomId === roomId) {
                    await deleteFile(fileId);
                  }
                }
              }
            } catch (err) {
              console.error("Error cleaning files on room leave:", err);
            }

            // Notify peer
            if (peerSocket) {
              sendJson(peerSocket, {
                type: "peer-disconnected",
                reason: "left",
              });
            }

            // Confirm to sender
            sendJson(ws, {
              type: "peer-disconnected",
              reason: "you-left",
            });
          }
        }
      } catch (err) {
        console.error("Error processing websocket message:", err);
      }
    });

    ws.on("close", async () => {
      if (currentSessionId) {
        if (activeSockets.get(currentSessionId) === ws) {
          activeSockets.delete(currentSessionId);
        }
        console.log(`WebSocket closed for session: ${currentSessionId}`);

        const session = await getSession(currentSessionId);
        if (session && session.connectedRoomId) {
          const room = await getRoom(session.connectedRoomId);
          if (room) {
            const peerId = room.peerA === currentSessionId ? room.peerB : room.peerA;
            const peerSocket = activeSockets.get(peerId);
            if (peerSocket) {
              sendJson(peerSocket, {
                type: "peer-status-change",
                online: false,
              });
            }
          }
        }
      }
    });
  });

  const isProd = process.env.NODE_ENV === "production" || !!process.env.PORT;
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          port: 24679,
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

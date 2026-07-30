import { useEffect, useRef, useState } from "react";
import React from "react";
import {
  QrCode,
  ScanLine,
  Wifi,
  WifiOff,
  Moon,
  Sun,
  X,
  Bell,
  Sparkles,
  Zap,
  UserCheck,
  Check,
  AlertCircle,
  GraduationCap,
  Github,
  Globe,
  Code2,
  Shield,
  Lock,
  ServerCrash,
  EyeOff,
  Bot,
  MessageSquare,
  Send,
  HelpCircle
} from "lucide-react";
import { Message, Peer, Session, JoinRequest } from "./types";
import { playNotificationSound, getAvatarGradient, getInitials } from "./utils";
import QrGenerator from "./components/QrGenerator";
import QrScanner from "./components/QrScanner";
import ChatRoom from "./components/ChatRoom";
import { db } from "./firebase";
import { ref, set, get, update, remove, onValue, push, onDisconnect } from "firebase/database";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateRandomName(): string {
  return "User";
}

interface StarParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  maxLife: number;
  life: number;
}

const CustomCursor: React.FC = () => {
  const [stars, setStars] = useState<StarParticle[]>([]);
  const lastPosition = useRef({ x: 0, y: 0 });
  const requestRef = useRef<number | null>(null);

  useEffect(() => {
    const colors = [
      "text-cyan-400 shadow-cyan-400/50",
      "text-indigo-400 shadow-indigo-400/50",
      "text-purple-400 shadow-purple-400/50",
      "text-emerald-400 shadow-emerald-400/50",
      "text-pink-400 shadow-pink-400/50"
    ];

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate distance moved
      const dx = e.clientX - lastPosition.current.x;
      const dy = e.clientY - lastPosition.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Only spawn a star if mouse moved more than 8 pixels
      if (dist > 8) {
        const newStar: StarParticle = {
          id: Date.now() + Math.random(),
          x: e.clientX,
          y: e.clientY,
          // Random velocity heading outwards
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2 - 1, // slight upward drift initially
          size: Math.random() * 8 + 8, // 8px to 16px
          color: colors[Math.floor(Math.random() * colors.length)],
          maxLife: 35, // frames
          life: 35
        };

        setStars((prev) => [...prev.slice(-30), newStar]); // Keep at most 30 active stars
        lastPosition.current = { x: e.clientX, y: e.clientY };
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  // Update particles positions and fade in requestAnimationFrame
  useEffect(() => {
    const updateStars = () => {
      setStars((prev) =>
        prev
          .map((star) => ({
            ...star,
            x: star.x + star.vx,
            y: star.y + star.vy + 0.1, // slight gravity
            life: star.life - 1,
            // slow down horizontal movement
            vx: star.vx * 0.98,
            vy: star.vy * 0.98
          }))
          .filter((star) => star.life > 0)
      );
      requestRef.current = requestAnimationFrame(updateStars);
    };
    requestRef.current = requestAnimationFrame(updateStars);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <>
      {stars.map((star) => {
        const opacity = star.life / star.maxLife;
        const scale = 0.5 + (star.life / star.maxLife) * 0.5;
        return (
          <div
            key={star.id}
            className={`fixed pointer-events-none z-[99999] -translate-x-1/2 -translate-y-1/2 transition-opacity duration-75 ${star.color} hidden md:block`}
            style={{
              left: `${star.x}px`,
              top: `${star.y}px`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              opacity: opacity,
              transform: `translate3d(-50%, -50%, 0) scale(${scale})`,
              filter: `drop-shadow(0 0 4px currentColor)`
            }}
          >
            <Sparkles style={{ width: "100%", height: "100%" }} />
          </div>
        );
      })}
    </>
  );
};

export default function App() {
  // --- Core State ---
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<"home" | "generate" | "scan" | "chat">(() => {
    return localStorage.getItem("qr_e2e_connected_room_id") ? "chat" : "home";
  });
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // --- Guide Chatbot State ---
  const [isBotOpen, setIsBotOpen] = useState(false);
  const [botMessages, setBotMessages] = useState<Array<{ id: number; text: string; sender: "bot" | "user" }>>([
    {
      id: 1,
      text: "Hi! I am the Instant Guide Bot. 🤖 Ask me how to use the app, explain buttons, or request security details!",
      sender: "bot"
    }
  ]);
  const [botInput, setBotInput] = useState("");
  const botMessagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll guide bot messages
  useEffect(() => {
    if (isBotOpen) {
      botMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [botMessages, isBotOpen]);

  const handleCloseBot = () => {
    setIsBotOpen(false);
    setBotMessages([
      {
        id: 1,
        text: "Hi! I am the Instant Guide Bot. 🤖 Ask me how to use the app, explain buttons, or request security details!",
        sender: "bot"
      }
    ]);
  };

  const handleSendBotMessage = (text: string) => {
    if (text === "Clear History ✖") {
      setBotMessages([
        {
          id: 1,
          text: "Hi! I am the Instant Guide Bot. 🤖 Ask me how to use the app, explain buttons, or request security details!",
          sender: "bot"
        }
      ]);
      return;
    }
    if (!text.trim()) return;

    const userMsgId = Date.now();
    setBotMessages((prev) => [...prev, { id: userMsgId, text, sender: "user" }]);
    setBotInput("");

    setTimeout(() => {
      let reply = "";

      switch (text) {
        case "How to create chat?":
          reply = "💡 How to Create a Chat Room:\n\n1. On the home page, click the 'Create Chat' button.\n2. You will instantly generate a new room. A pairing QR Code and a 6-digit Invite Code will appear on the screen.\n3. Keep this screen open. Share the QR code or send the 6-digit Invite Code to the person you want to pair with.";
          break;
        case "How to join?":
          reply = "📲 How to Join an Existing Chat Room:\n\n1. On the home page, click the 'Join Chat' button.\n2. This opens your camera to scan the host's room QR Code. If you cannot scan, click 'Enter Code' and type the host's 6-digit Invite Code.\n3. Once submitted, wait a moment for a member in the chat room to click 'Approve' to securely authorize your entry.";
          break;
        case "Is it secure?":
          reply = "🛡️ Is Instant Secure?\n\nYes, absolutely. Instant is designed with privacy-first architecture. It features client-side End-to-End Encryption (E2E), stores zero message logs on servers, and sends messages directly peer-to-peer using WebRTC. Even if signaling databases are compromised, no one can decrypt your messages without the secret pairing key.";
          break;
        case "Explain buttons":
          reply = "⚙️ Home Screen Buttons Explained:\n\n- Create Chat: Launches a new host session and generates invite keys.\n- Join Chat: Activates the scanner/input code reader to join a room.\n- Sun/Moon (Header): Toggles between light mode and dark mode.\n- Active/Offline Status: Indicates if your client is connected to signaling servers.\n- Developed By Card: Displays details and GitHub link for the developer Satyajit Pratihar.";
          break;
        case "File sharing guide":
          reply = "📎 File Sharing Guide:\n\n1. Inside the chat room, click the '+ File' button next to the message input box.\n2. Select the file you want to share. The file is split into chunks, encrypted client-side using AES-GCM 256, and streamed directly peer-to-peer.\n3. The recipient's browser receives the chunks, decrypts them, and compiles them back into a downloadable file.";
          break;
        case "How to pairing QR?":
          reply = "🔗 How QR Pairing Works:\n\nThe QR code contains the temporary room session ID and the secret WebCrypto key (after the '#' hash character). When a guest scans the QR code, their browser extracts the decryption key and connects directly via signaling to establish a WebRTC connection.";
          break;
        case "How does E2E work?":
          reply = "🔐 How E2E Encryption Works:\n\n- Your browser generates an AES-GCM 256-bit symmetric key.\n- Messages are encrypted client-side using this key before leaving the browser.\n- Only people who scanned/entered the room code have the key, so only they can read the chats.";
          break;
        case "What is WebRTC?":
          reply = "⚡ What is WebRTC?\n\nWebRTC (Web Real-Time Communication) is a browser technology that allows direct peer-to-peer data transfer without sending data through a middleman server.";
          break;
        case "Who is developer?":
          reply = "👨‍💻 About the Developer:\n\nDeveloped by Satyajit Pratihar, an IT Student at Guru Nanak Institute of Technology (GNIT), who builds secure, modern, and high-performance web applications.";
          break;
        case "Is it free to use?":
          reply = "🆓 Yes! Instant is 100% free, open-source, and does not contain ads, paywalls, or registrations.";
          break;
        case "Does it store files?":
          reply = "📂 File Storage Policy:\n\nInstant does NOT store files. Files are encrypted, transferred directly peer-to-peer, and are completely removed from existence once the chat session closes.";
          break;
        case "How to add peer?":
          reply = "➕ How to add another Peer:\n\nSimply click the 'QR Code' icon in the chat header or sidebar to display the room QR code again, and let another person scan it to join.";
          break;
        case "How to close room?":
          reply = "✖ How to close the room:\n\nClick the exit door button in the top header. If you are the Host, this will disconnect all peers and wipe all database references.";
          break;
        case "What is ephemeral?":
          reply = "⏳ What is Ephemeral:\n\n'Ephemeral' means short-lived. Your chat session only exists as long as your browser tab is open. There is no permanent storage, search history, or server log.";
          break;
        case "Can I use on mobile?":
          reply = "📱 Mobile Support:\n\nYes! Instant is fully responsive and optimized for mobile screens, tablets, and desktops. You can scan QR codes using your phone's camera.";
          break;
        case "How to toggle dark mode?":
          reply = "🌗 How to toggle Dark Mode:\n\nClick the Sun/Moon icon in the top header of the landing page or the chat room to switch between dark and light themes.";
          break;
        case "Is registration needed?":
          reply = "🚫 No Registration:\n\nYou do not need an email, phone number, or password. Simply generate a session and start sharing instantly.";
          break;
        case "How to send messages?":
          reply = "💬 How to send messages:\n\nType your message in the chat input bar and hit Enter or click the Send button. All messages are encrypted instantly.";
          break;
        case "Can host read chats?":
          reply = "👁 Can the Host read my chats?\n\nThe Host has the same decryption key as other participants. However, nobody outside the active session room can read or intercept the messages.";
          break;
        case "What if host leaves?":
          reply = "🚪 What if the Host leaves?\n\nIf the Host leaves, the database references are deleted, and all guests are notified that the room is offline to ensure absolute privacy.";
          break;
        case "Are chats encrypted?":
          reply = "🔐 Are all chats encrypted?\n\nYes! Every single message, file, and system notification is fully encrypted inside your browser before transmitting.";
          break;
        case "Does it work offline?":
          reply = "🔌 Does it work offline?\n\nIt requires an internet connection to pair peers via the signaling database initially, but after establishing WebRTC, direct peer data transfer is localized.";
          break;
        case "Supported file sizes?":
          reply = "📦 Supported File Sizes:\n\nInstant supports sharing files of varying sizes (up to 50MB-100MB depending on your browser's WebRTC buffer limits).";
          break;
        case "What is Firebase role?":
          reply = "🔥 What is Firebase's role?\n\nFirebase Realtime Database acts purely as an ephemeral signaling channel to exchange WebRTC session descriptions. It holds zero unencrypted data.";
          break;
        case "Instant QR pairing info":
          reply = "🔗 Instant QR Pairing Info:\n\nThe pairing QR code contains details like room session ID and the WebCrypto secret key. This key does not upload to database logs, ensuring your connection security.";
          break;
        default:
          reply = "🤖 I'm here to guide you! Click any of the options below to learn how the app works, what the buttons do, or check its security.";
          break;
      }

      setBotMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, text: reply, sender: "bot" }
      ]);
    }, 450);
  };

  // --- Real-time Peer State ---
  const [peer, setPeer] = useState<Peer | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [autoShowInvite, setAutoShowInvite] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [waitingForGroupApprove, setWaitingForGroupApprove] = useState<string | null>(null);
  const [roomMemberName, setRoomMemberName] = useState<string>("");
  const [keepAlive3h, setKeepAlive3h] = useState<boolean>(() => localStorage.getItem("qr_e2e_keep_alive_3h") === "true");
  const [roomExpiresAt, setRoomExpiresAt] = useState<number | null>(null);
  const [showHostOfflineModal, setShowHostOfflineModal] = useState<boolean>(false);
  const [knockVolume, setKnockVolume] = useState<number>(() => {
    return Number(localStorage.getItem("knock_volume") || "0.2");
  });

  useEffect(() => {
    localStorage.setItem("qr_e2e_keep_alive_3h", keepAlive3h ? "true" : "false");
  }, [keepAlive3h]);

  useEffect(() => {
    localStorage.setItem("qr_e2e_dark_theme", isDarkMode ? "true" : "false");
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", isDarkMode ? "#0A0A0C" : "#F8FAFC");
    }
    document.body.style.backgroundColor = isDarkMode ? "#0A0A0C" : "#F8FAFC";
    document.documentElement.style.backgroundColor = isDarkMode ? "#0A0A0C" : "#F8FAFC";
  }, [isDarkMode]);

  // --- Sync connectedRoomId to localStorage to prevent home screen flash on reload ---
  useEffect(() => {
    if (session?.connectedRoomId) {
      localStorage.setItem("qr_e2e_connected_room_id", session.connectedRoomId);
    } else if (session) {
      localStorage.removeItem("qr_e2e_connected_room_id");
    }
  }, [session?.connectedRoomId, session]);

  // --- Manage session onDisconnect based on keepAlive5h toggle ---
  useEffect(() => {
    if (!session?.id) return;
    const sessionRef = ref(db, `sessions/${session.id}`);
    // Always cancel onDisconnect to prevent session removal on refresh or tab switch
    onDisconnect(sessionRef).cancel();
  }, [session?.id]);

  const [incomingRequest, setIncomingRequest] = useState<{
    id: string;
    name: string;
    avatarSeed: string;
  } | null>(null);

  // --- Pairing Flow Flags ---
  const [isConnecting, setIsConnecting] = useState(false);
  const [waitingForResponse, setWaitingForResponse] = useState<string | null>(null); // name of peer we requested

  // --- Connection Refs ---
  const autoConnectRef = useRef<string | null>(null);
  const isHostRef = useRef<boolean>(false);
  const isLeavingRef = useRef<boolean>(false);
  const peersCountRef = useRef<number>(0);
  const lastKnockTimeRef = useRef<number>(0);

  // --- Custom Toast Dispatcher ---
  const addToast = (message: string, type: "success" | "error" | "info" = "info") => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // --- Heartbeat & Status Updater ---
  useEffect(() => {
    if (!session?.id) return;

    const interval = setInterval(() => {
      update(ref(db, `sessions/${session.id}`), {
        lastActive: Date.now()
      });
    }, 10000);

    update(ref(db, `sessions/${session.id}`), {
      lastActive: Date.now()
    });

    return () => clearInterval(interval);
  }, [session?.id]);

  // --- Instant cleanup on refresh/unload/close page removed to keep connection on refresh ---

  // --- Real-time Session listener (incoming requests & pairing status) ---
  useEffect(() => {
    if (!session?.id) return;

    const mySessionRef = ref(db, `sessions/${session.id}`);
    const unsubscribeMySession = onValue(mySessionRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.val();

      // Handle connectedRoomId changes
      if (data.connectedRoomId && data.connectedRoomId !== session.connectedRoomId) {
        if (isLeavingRef.current) return;
        setSession((prev) => prev ? { ...prev, connectedRoomId: data.connectedRoomId } : null);
        setWaitingForResponse(null);
        setWaitingForGroupApprove(null);
        setIsConnecting(false);
        setView("chat");
      }

      // Handle incoming connection requests
      if (data.incomingRequests) {
        const requests = Object.values(data.incomingRequests);
        if (requests.length > 0) {
          const req: any = requests[0];
          playNotificationSound("request");
          setIncomingRequest(req);
        }
      } else {
        setIncomingRequest(null);
      }

      // Handle pairingStatus changes
      if (data.pairingStatus) {
        const { type, roomId, peerName } = data.pairingStatus;
        if (type === "declined") {
          setWaitingForResponse(null);
          setWaitingForGroupApprove(null);
          setIsConnecting(false);
          addToast(`${peerName || "Host"} declined your chat join request.`, "error");
          update(mySessionRef, { pairingStatus: null });
        } else if (type === "accepted") {
          playNotificationSound("success");
          setWaitingForResponse(null);
          setWaitingForGroupApprove(null);
          setIsConnecting(false);
          setIncomingRequest(null);
          isHostRef.current = false; // Guest joined, not host
          setView("chat");
          addToast("Successfully joined chat room!", "success");
          update(mySessionRef, { pairingStatus: null });
        }
      }
    });

    return () => unsubscribeMySession();
  }, [session?.id, session?.connectedRoomId]);

  const [viewportHeight, setViewportHeight] = useState(typeof window !== "undefined" ? window.innerHeight : 800);
  const [isKeyboardLocked, setIsKeyboardLocked] = useState(false);
  const isKeyboardLockedRef = React.useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateHeight = () => {
      // When keyboard is locked, don't update viewport height — keeps layout frozen
      if (isKeyboardLockedRef.current) return;
      const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      setViewportHeight(height);
      if (view === "chat" && (window.scrollY !== 0 || window.scrollX !== 0)) {
        window.scrollTo(0, 0);
      }
    };

    window.visualViewport?.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("scroll", updateHeight);
    window.addEventListener("resize", updateHeight);
    window.addEventListener("scroll", updateHeight);

    updateHeight();

    return () => {
      window.visualViewport?.removeEventListener("resize", updateHeight);
      window.visualViewport?.removeEventListener("scroll", updateHeight);
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("scroll", updateHeight);
    };
  }, [view]);

  // Lock body/html scrolling during active chat session to prevent browser drag scrolling
  useEffect(() => {
    if (view === "chat") {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
      document.documentElement.style.overflow = "auto";
    }
    return () => {
      document.body.style.overflow = "auto";
      document.documentElement.style.overflow = "auto";
    };
  }, [view]);

  // --- Real-time Chat Room & Peer sync listener ---
  useEffect(() => {
    if (!session?.connectedRoomId || !session?.id) {
      setPeer(null);
      setPeers([]);
      setPeerOnline(false);
      setPeerTyping(false);
      setMessages([]);
      return;
    }

    isLeavingRef.current = false; // Reset leaving flag on entry to room
    const roomId = session.connectedRoomId;
    const roomRef = ref(db, `rooms/${roomId}`);

    // Periodically update my heartbeat inside the room members node
    const heartbeatInterval = setInterval(() => {
      if (session?.id) {
        update(ref(db, `rooms/${roomId}/members/${session.id}`), {
          lastActive: Date.now()
        }).catch((err) => console.error("Heartbeat failed:", err));
      }
    }, 12000);

    let roomUnsubscribe: () => void;

    roomUnsubscribe = onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        // Unsubscribe immediately to prevent subsequent callback triggers
        if (roomUnsubscribe) roomUnsubscribe();

        // Room was closed/deleted
        if (isLeavingRef.current) return;
        const wasInChat = session?.connectedRoomId !== null;

        setPeer(null);
        setPeers([]);
        setPeerOnline(false);
        setPeerTyping(false);
        setMessages([]);

        if (wasInChat) {
          update(ref(db, `sessions/${session.id}`), { connectedRoomId: null });
          setSession((prev) => prev ? { ...prev, connectedRoomId: null } : null);
          setView("home");
          setShowHostOfflineModal(true);
        }
        return;
      }

      const roomData = snapshot.val();
      const createdTime = roomData.createdTime || Date.now();
      const expiresAt = roomData.expiresAt || (createdTime + 3 * 60 * 60 * 1000);

      // Check if room has expired (3 hours)
      if (Date.now() > expiresAt) {
        if (roomUnsubscribe) roomUnsubscribe();

        // Delete room and files from DB
        remove(ref(db, `rooms/${roomId}`)).catch(err => console.error("Error auto-deleting room:", err));
        remove(ref(db, `files/${roomId}`)).catch(err => console.error("Error auto-deleting room files:", err));

        setPeer(null);
        setPeers([]);
        setPeerOnline(false);
        setPeerTyping(false);
        setMessages([]);
        setSession((prev) => prev ? { ...prev, connectedRoomId: null } : null);
        update(ref(db, `sessions/${session.id}`), { connectedRoomId: null }).catch(err => console.error("Error clearing session room:", err));
        setView("home");
        addToast("Chat session expired after 3 hours.", "info");
        return;
      }

      setRoomExpiresAt(expiresAt);

      const membersMap = roomData.members || {};
      const isHost = roomData.creatorId === session.id || (!roomData.creatorId && Object.keys(membersMap)[0] === session.id);

      // Sync knock nudge
      if (roomData.knock) {
        const knockVal = roomData.knock;
        if (knockVal.senderId !== session.id) {
          if (knockVal.timestamp > lastKnockTimeRef.current && Date.now() - knockVal.timestamp < 4000) {
            lastKnockTimeRef.current = knockVal.timestamp;
            playNotificationSound("knock", knockVolume);
            addToast(`${knockVal.senderName || "Peer"} knocked you!`, "info");
          }
        }
      }

      // Sync join requests
      if (roomData.joinRequests) {
        const reqs = Object.values(roomData.joinRequests) as JoinRequest[];
        const sortedReqs = reqs.sort((a, b) => b.timestamp - a.timestamp);
        setJoinRequests((prev) => {
          if (sortedReqs.length > prev.length) {
            const existingIds = new Set(prev.map((r) => r.id));
            const newReq = sortedReqs.find((r) => !existingIds.has(r.id));
            if (newReq) {
              playNotificationSound("request");
              addToast(`${newReq.name} is requesting to join the chat.`, "info");
            }
          }
          return sortedReqs;
        });
      } else {
        setJoinRequests([]);
      }

      // Sync messages
      if (roomData.messages) {
        const msgList: Message[] = [];
        Object.entries(roomData.messages).forEach(([id, val]: [string, any]) => {
          const isExpiredFile = val.file && Date.now() > val.timestamp + 5 * 60 * 1000;
          if (isExpiredFile) {
            // Delete file chunks first, then the message node to keep DB consistent
            remove(ref(db, `files/${roomId}/${val.file.id}`))
              .catch(err => console.error("Error auto-deleting file:", err))
              .finally(() => {
                remove(ref(db, `rooms/${roomId}/messages/${id}`))
                  .catch(err => console.error("Error auto-deleting message:", err));
              });
          } else {
            msgList.push({
              id,
              senderId: val.senderId,
              senderName: val.senderId === session.id ? (membersMap[session.id]?.name || val.senderName || session.name) : (membersMap[val.senderId]?.name || val.senderName || "Member"),
              text: val.text,
              timestamp: val.timestamp,
              file: val.file || undefined,
              replyTo: val.replyTo || undefined
            });
          }
        });
        msgList.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // Play sound for incoming message
        setMessages((prev) => {
          if (msgList.length > prev.length) {
            const lastMsg = msgList[msgList.length - 1];
            if (lastMsg && lastMsg.senderId !== session.id) {
              playNotificationSound("message");
            }
          }
          return msgList;
        });
      } else {
        setMessages([]);
      }

      // Sync other members as Peers
      const peersList: Peer[] = Object.entries(membersMap)
        .filter(([id]) => id !== session.id)
        .map(([id, val]: [string, any]) => ({
          id,
          name: val.name || "Member",
          avatarSeed: val.avatarSeed || "default",
          online: Date.now() - (val.lastActive || 0) < 25000
        }));
      setPeers(peersList);
      peersCountRef.current = peersList.length;

      // Register disconnect cleanup handlers
      const myMemberRef = ref(db, `rooms/${roomId}/members/${session.id}`);
      const myTypingRef = ref(db, `rooms/${roomId}/typing/${session.id}`);
      const roomNodeRef = ref(db, `rooms/${roomId}`);

      if (keepAlive3h) {
        // If keep alive is enabled, do NOT set onDisconnect remove handlers
        onDisconnect(myMemberRef).cancel();
        onDisconnect(myTypingRef).cancel();
        onDisconnect(roomNodeRef).cancel();
      } else {
        // If keep alive is disabled, mark ourselves offline on disconnect instead of removing
        onDisconnect(ref(db, `rooms/${roomId}/members/${session.id}/lastActive`)).set(0);
        onDisconnect(myTypingRef).remove();
        onDisconnect(roomNodeRef).cancel();
      }

      // Sync my name in this room
      const myMemberName = membersMap[session.id]?.name || session.name;
      setRoomMemberName(myMemberName);

      // If the current user is the host/creator, store it in ref for unload keepalive checks
      isHostRef.current = isHost;

      // Set fallback peer for 1-to-1 visual backward compatibility
      if (peersList.length > 0) {
        setPeer(peersList[0]);
      } else {
        setPeer(null);
      }

      // Set fallback health indicator for 1-to-1 visual backward compatibility
      const hasOnlinePeer = peersList.some(p => p.online);
      setPeerOnline(hasOnlinePeer);

      // Sync typing
      const typingMap = roomData.typing || {};
      const typingIds = Object.entries(typingMap)
        .filter(([id, isTyping]) => id !== session.id && isTyping)
        .map(([id]) => id);
      setPeerTyping(typingIds.length > 0);

      const typingNamesList = typingIds.map(id => membersMap[id]?.name || "Someone");
      setTypingNames(typingNamesList);
    });

    return () => {
      clearInterval(heartbeatInterval);
      if (roomUnsubscribe) {
        roomUnsubscribe();
      }

      // Clean up disconnect handlers
      const myMemberRef = ref(db, `rooms/${roomId}/members/${session.id}`);
      const myTypingRef = ref(db, `rooms/${roomId}/typing/${session.id}`);
      const roomNodeRef = ref(db, `rooms/${roomId}`);
      onDisconnect(myMemberRef).cancel();
      onDisconnect(myTypingRef).cancel();
      onDisconnect(roomNodeRef).cancel();
    };
  }, [session?.connectedRoomId, session?.id, keepAlive3h]);

  // --- Grace period for offline peers (Disabled to prevent auto-disconnect) ---
  useEffect(() => {
    // Disabled auto-disconnect so that users stay in the room until they manually disconnect.
    // This allows the host/peers to refresh or close their tab temporarily without breaking the connection.
    return;
  }, [view, peers.length, peerOnline, keepAlive3h, session?.connectedRoomId]);

  // --- Handshake & Register Session ---
  useEffect(() => {
    // 1. Theme restoration
    const cachedTheme = localStorage.getItem("qr_e2e_dark_theme");
    if (cachedTheme !== null) {
      setIsDarkMode(cachedTheme === "true");
    }

    // 2. Scan URL parameter extractor
    const urlParams = new URLSearchParams(window.location.search);
    const scanTargetId = urlParams.get("scan");
    if (scanTargetId) {
      autoConnectRef.current = scanTargetId;
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 3. Register or restore session
    const savedSessionId = localStorage.getItem("qr_e2e_session_id");

    const initializeSession = async () => {
      // --- Expired Session & Room cleanup (Removed for performance) ---
      // Fetching all rooms on client startup downloads the entire database (including large files)
      // which causes massive loading delays. We skip this global cleanup.

      let activeSession: Session | null = null;

      if (savedSessionId) {
        try {
          const snap = await get(ref(db, `sessions/${savedSessionId}`));
          if (snap.exists()) {
            activeSession = snap.val() as Session;
          }
        } catch (e) {
          console.error("Error fetching session:", e);
        }
      }

      if (!activeSession) {
        const newId = savedSessionId && /^[0-9a-f-]{36}$/i.test(savedSessionId) ? savedSessionId : generateUUID();
        // Check keepAlive3h directly from localStorage for correctness during initialization
        const isKeepAlive = localStorage.getItem("qr_e2e_keep_alive_3h") === "true";
        activeSession = {
          id: newId,
          avatarSeed: Math.random().toString(36).substring(7),
          name: generateRandomName(),
          connectedRoomId: null,
          lastActive: Date.now()
        };
        if (isKeepAlive) {
          activeSession.expiresAt = Date.now() + 3 * 60 * 60 * 1000;
        }
        try {
          await set(ref(db, `sessions/${newId}`), activeSession);
        } catch (e) {
          console.error("Error creating session:", e);
        }
      }

      // Cleanup logic removed to prevent massive database downloads

      // Always cancel disconnect handler to prevent session deletion on refresh/tab switch
      onDisconnect(ref(db, `sessions/${activeSession.id}`)).cancel();

      if (activeSession.connectedRoomId) {
        const roomId = activeSession.connectedRoomId;
        try {
          // Fetch room node to verify existence and check age
          const roomSnap = await get(ref(db, `rooms/${roomId}`));
          if (roomSnap.exists()) {
            const roomData = roomSnap.val();
            const createdTime = roomData.createdTime || Date.now();
            const expiresAt = roomData.expiresAt || (createdTime + 3 * 60 * 60 * 1000);

            if (Date.now() > expiresAt) {
              // Expired room! Delete from DB.
              await remove(ref(db, `rooms/${roomId}`));
              await remove(ref(db, `files/${roomId}`));
              activeSession.connectedRoomId = null;
              await update(ref(db, `sessions/${activeSession.id}`), { connectedRoomId: null });
            } else {
              // Re-insert or update our member status to be online
              await update(ref(db, `rooms/${roomId}/members/${activeSession.id}`), {
                id: activeSession.id,
                name: activeSession.name,
                avatarSeed: activeSession.avatarSeed,
                joinedAt: Date.now(),
                lastActive: Date.now()
              });
              setView("chat");
            }
          } else {
            activeSession.connectedRoomId = null;
            await update(ref(db, `sessions/${activeSession.id}`), { connectedRoomId: null });
          }
        } catch (err) {
          console.error("Failed to recover room members status:", err);
        }
      }

      setSession(activeSession);
      localStorage.setItem("qr_e2e_session_id", activeSession.id);

      // Auto connect if parameter exists
      if (autoConnectRef.current) {
        const target = autoConnectRef.current;
        autoConnectRef.current = null;
        setTimeout(() => {
          requestConnection(target, activeSession!);
        }, 800);
      }
    };

    initializeSession();
  }, []);

  // --- Create Chat Room Hook (Add Member Flow) ---
  const handleCreateRoom = async () => {
    if (!session) return;
    isLeavingRef.current = false; // Reset leaving flag to allow connection state changes

    const newRoomId = generateUUID();
    try {
      const roomData: Record<string, any> = {
        id: newRoomId,
        creatorId: session.id,
        createdTime: Date.now(),
        expiresAt: Date.now() + 3 * 60 * 60 * 1000, // Always set 3h expiry
        members: {
          [session.id]: {
            id: session.id,
            name: "Host",
            avatarSeed: session.avatarSeed,
            joinedAt: Date.now(),
            lastActive: Date.now()
          }
        }
      };
      await set(ref(db, `rooms/${newRoomId}`), roomData);

      isHostRef.current = true; // Mark as host
      await update(ref(db, `sessions/${session.id}`), {
        connectedRoomId: newRoomId,
        name: "Host"
      });

      setSession((prev) => prev ? { ...prev, connectedRoomId: newRoomId, name: "Host" } : null);
      setAutoShowInvite(true); // Open invite modal automatically in chat room
      setView("chat");
      addToast("Chat room created! Ready to invite members.", "success");
    } catch (err) {
      console.error("Failed to create room:", err);
      addToast("Failed to create chat room.", "error");
    }
  };

  // --- Dispatch Connection Request ---
  const requestConnection = async (targetId: string, currentSession = session) => {
    isLeavingRef.current = false; // Reset leaving flag to allow connection state changes
    const activeSess = currentSession || session;
    if (!activeSess) return;

    const sanitized = targetId.trim().replace(/[-\s]/g, "");

    // 1. If it's a 6-digit code:
    if (/^\d{6}$/.test(sanitized)) {
      setIsConnecting(true);
      try {
        const codeSnap = await get(ref(db, `codes/${sanitized}`));
        if (codeSnap.exists()) {
          const val = codeSnap.val();
          const roomId = val.roomId;

          if (roomId) {
            // Write a join request instantly in the background
            set(ref(db, `rooms/${roomId}/joinRequests/${activeSess.id}`), {
              id: activeSess.id,
              name: activeSess.name,
              avatarSeed: activeSess.avatarSeed,
              timestamp: Date.now()
            }).catch((err) => {
              console.error("Failed to send join request:", err);
            });

            setWaitingForGroupApprove(roomId);
            setView("home"); // Redirect to home so they are not stuck on the scanner view
            addToast("Join request sent. Awaiting approval...", "info");
          } else {
            addToast("This invite code is expired or invalid.", "error");
          }
        } else {
          addToast("Invalid invite code.", "error");
        }
      } catch (err) {
        console.error("Code lookup failed:", err);
        addToast("Failed to verify invite code.", "error");
      } finally {
        setIsConnecting(false);
      }
      return;
    }

    if (targetId === activeSess.id) {
      addToast("You cannot join your own room.", "error");
      return;
    }

    setIsConnecting(true);
    try {
      // Fetch the host's session to retrieve their connectedRoomId
      const hostSnap = await get(ref(db, `sessions/${targetId}`));
      if (hostSnap.exists()) {
        const hostData = hostSnap.val();
        const roomId = hostData.connectedRoomId;
        if (roomId) {
          // Write a group join request to the room instantly in the background
          set(ref(db, `rooms/${roomId}/joinRequests/${activeSess.id}`), {
            id: activeSess.id,
            name: activeSess.name,
            avatarSeed: activeSess.avatarSeed,
            timestamp: Date.now()
          }).catch((err) => {
            console.error("Failed to send join request:", err);
          });

          setWaitingForGroupApprove(roomId);
          setView("home"); // Redirect to home so they are not stuck on the scanner view
          addToast("Join request sent. Awaiting approval...", "info");
        } else {
          addToast("This user is not currently in an active chat room.", "error");
        }
      } else {
        addToast("Host session expired or not found.", "error");
      }
    } catch (err) {
      console.error("QR connection request failed:", err);
      addToast("Failed to send join request.", "error");
    } finally {
      setIsConnecting(false);
    }
  };

  // --- Respond to Incoming Connection ---
  const respondConnection = async (accept: boolean) => {
    if (!incomingRequest || !session) return;
    const senderId = incomingRequest.id;

    try {
      await remove(ref(db, `sessions/${session.id}/incomingRequests/${senderId}`));

      if (!accept) {
        await update(ref(db, `sessions/${senderId}`), {
          pairingStatus: { type: "declined", peerName: session.name }
        });
        addToast("Pairing invitation declined.", "info");
      } else {
        const newRoomId = generateUUID();

        await set(ref(db, `rooms/${newRoomId}`), {
          id: newRoomId,
          createdTime: Date.now(),
          expiresAt: Date.now() + 3 * 60 * 60 * 1000, // Set 3h expiry
          members: {
            [session.id]: {
              id: session.id,
              name: "Host",
              avatarSeed: session.avatarSeed,
              joinedAt: Date.now(),
              lastActive: Date.now()
            },
            [senderId]: {
              id: senderId,
              name: "User 1",
              avatarSeed: incomingRequest.avatarSeed,
              joinedAt: Date.now(),
              lastActive: Date.now()
            }
          }
        });

        await update(ref(db, `sessions/${senderId}`), {
          connectedRoomId: newRoomId,
          name: "User 1",
          pairingStatus: { type: "accepted", roomId: newRoomId }
        });

        isHostRef.current = true; // Mark as host
        await update(ref(db, `sessions/${session.id}`), {
          connectedRoomId: newRoomId,
          name: "Host"
        });
        setSession((prev) => prev ? { ...prev, connectedRoomId: newRoomId, name: "Host" } : null);
        setView("chat");
      }
    } catch (e) {
      console.error("Responding to connection failed:", e);
      addToast("Failed to respond to request.", "error");
    }
    setIncomingRequest(null);
  };

  // --- Respond to Group Join Request ---
  const respondGroupConnection = async (requester: JoinRequest, accept: boolean) => {
    if (!session?.connectedRoomId) return;
    const roomId = session.connectedRoomId;
    const senderId = requester.id;

    try {
      // 1. Remove from joinRequests node
      await remove(ref(db, `rooms/${roomId}/joinRequests/${senderId}`));

      if (accept) {
        // Fetch current members to determine the next User index
        const roomSnap = await get(ref(db, `rooms/${roomId}/members`));
        const members = roomSnap.exists() ? roomSnap.val() : {};
        const guestCount = Object.values(members).filter((m: any) => m.name !== "Host").length;
        const assignedName = `User ${guestCount + 1}`;

        // 2. Add to members list of the room
        await set(ref(db, `rooms/${roomId}/members/${senderId}`), {
          id: senderId,
          name: assignedName,
          avatarSeed: requester.avatarSeed,
          joinedAt: Date.now(),
          lastActive: Date.now()
        });

        // 3. Update joining session connectedRoomId, name, and pairingStatus
        await update(ref(db, `sessions/${senderId}`), {
          connectedRoomId: roomId,
          name: assignedName,
          pairingStatus: { type: "accepted", roomId }
        });

        addToast(`${requester.name} has joined the chat!`, "success");
        playNotificationSound("success");
      } else {
        // 3. Notify joiner they were declined
        await update(ref(db, `sessions/${senderId}`), {
          pairingStatus: { type: "declined", peerName: session.name }
        });
        addToast(`Declined join request from ${requester.name}.`, "info");
      }
    } catch (err) {
      console.error("Failed to respond to group join request", err);
      addToast("Failed to process request.", "error");
    }
  };

  // --- Cancel My Join Request ---
  const cancelJoinRequest = async () => {
    if (!waitingForGroupApprove || !session) return;
    const roomId = waitingForGroupApprove;
    try {
      await remove(ref(db, `rooms/${roomId}/joinRequests/${session.id}`));
    } catch (err) {
      console.error("Failed to cancel join request:", err);
    }
    setWaitingForGroupApprove(null);
    addToast("Cancelled join request.", "info");
  };

  // --- Disconnect Active Chat Room ---
  const leaveRoom = async (showToast = true) => {
    if (!session?.connectedRoomId) return;
    const roomId = session.connectedRoomId;
    isLeavingRef.current = true;
    const isHost = isHostRef.current;
    isHostRef.current = false; // Reset host status

    // 1. Perform local state updates immediately so the UI is responsive and never gets stuck
    setSession((prev) => prev ? { ...prev, connectedRoomId: null, name: "User" } : null);
    setPeers([]);
    setMessages([]);
    setView("home");
    localStorage.removeItem("qr_e2e_connected_room_id");
    if (showToast === true || (showToast && typeof showToast !== "boolean")) {
      addToast("You left the chat room.", "info");
    }

    // 2. Perform database cleanup asynchronously in the background
    try {
      update(ref(db, `sessions/${session.id}`), { connectedRoomId: null, name: "User" });

      if (isHost) {
        // Delete invite codes linked to this room
        try {
          const codesSnap = await get(ref(db, "codes"));
          if (codesSnap.exists()) {
            const codes = codesSnap.val();
            Object.entries(codes).forEach(([code, data]: [string, any]) => {
              if (data?.roomId === roomId) {
                remove(ref(db, `codes/${code}`));
              }
            });
          }
        } catch (err) {
          console.error("Failed to clean up room codes:", err);
        }
        remove(ref(db, `rooms/${roomId}`));
      } else {
        remove(ref(db, `rooms/${roomId}/members/${session.id}`));
        remove(ref(db, `rooms/${roomId}/typing/${session.id}`));

        const roomSnap = await get(ref(db, `rooms/${roomId}`));
        if (roomSnap.exists()) {
          const roomData = roomSnap.val();
          const remainingMembers = Object.keys(roomData.members || {});
          if (remainingMembers.length === 0) {
            remove(ref(db, `rooms/${roomId}`));
          }
        }
      }
    } catch (e) {
      console.error("Background database cleanup failed:", e);
    }
  };

  // --- Knock Nudge Hook ---
  const sendKnock = async () => {
    if (!session?.connectedRoomId) return;
    const roomId = session.connectedRoomId;
    try {
      await set(ref(db, `rooms/${roomId}/knock`), {
        senderId: session.id,
        senderName: roomMemberName || session.name,
        timestamp: Date.now()
      });
      playNotificationSound("knock", knockVolume);
      addToast("You knocked the peer!", "success");
    } catch (e) {
      console.error("Failed to send knock:", e);
      addToast("Failed to knock peer", "error");
    }
  };

  // --- Send Message Hook ---
  const sendMessage = async (text: string, fileId?: string, fileMeta?: any, replyTo?: Message["replyTo"]) => {
    if (!session?.connectedRoomId) return;
    const roomId = session.connectedRoomId;

    try {
      const messagesRef = ref(db, `rooms/${roomId}/messages`);
      const newMsgRef = push(messagesRef);
      await set(newMsgRef, {
        id: newMsgRef.key,
        senderId: session.id,
        senderName: roomMemberName || session.name, // Save sender name directly inside the message
        text,
        timestamp: Date.now(),
        file: fileId ? { id: fileId, ...fileMeta } : null,
        replyTo: replyTo || null
      });
    } catch (e) {
      console.error("Failed to send message:", e);
      addToast("Failed to send message", "error");
    }
  };

  // --- Synced Message Deletion Hook ---
  const deleteMessage = async (messageId: string) => {
    if (!session?.connectedRoomId) return;
    const roomId = session.connectedRoomId;

    try {
      // 1. Fetch the message to get associated file id before deleting
      const msgSnap = await get(ref(db, `rooms/${roomId}/messages/${messageId}`));

      if (msgSnap.exists()) {
        const msg = msgSnap.val();

        // 2. Delete the file chunks node first (if any) before removing the message
        if (msg.file?.id) {
          try {
            await remove(ref(db, `files/${roomId}/${msg.file.id}`));
          } catch (fileErr) {
            // File may already be gone (expired). Log and continue with message deletion.
            console.warn("File node already removed or inaccessible:", fileErr);
          }
        }
      }

      // 3. Delete the message node — this propagates to all connected peers via realtime listener
      await remove(ref(db, `rooms/${roomId}/messages/${messageId}`));

    } catch (e) {
      console.error("Failed to delete message:", e);
      addToast("Failed to delete message", "error");
    }
  };

  // --- Update typing indicator state ---
  const handleSetTyping = async (isTyping: boolean) => {
    if (!session?.connectedRoomId) return;
    try {
      await set(ref(db, `rooms/${session.connectedRoomId}/typing/${session.id}`), isTyping);
    } catch (e) {
      console.error("Failed to update typing status:", e);
    }
  };

  // --- Refresh QR / Reset Profile ---
  const handleRefreshSession = async () => {
    if (session?.connectedRoomId) {
      await leaveRoom(false);
    }

    localStorage.removeItem("qr_e2e_session_id");
    const newId = generateUUID();
    const newSession: Session = {
      id: newId,
      avatarSeed: Math.random().toString(36).substring(7),
      name: generateRandomName(),
      connectedRoomId: null,
      lastActive: Date.now()
    };
    if (keepAlive3h) {
      newSession.expiresAt = Date.now() + 3 * 60 * 60 * 1000;
    }

    try {
      await set(ref(db, `sessions/${newId}`), newSession);
      setSession(newSession);
      localStorage.setItem("qr_e2e_session_id", newId);
      addToast("Secure session refreshed successfully!", "success");
    } catch (e) {
      console.error("Failed to refresh session:", e);
    }
  };

  // --- Toggle Light/Dark Mode ---
  const handleToggleTheme = () => {
    const nextVal = !isDarkMode;
    setIsDarkMode(nextVal);
    localStorage.setItem("qr_e2e_dark_theme", String(nextVal));
  };

  return (
    <div
      id="app-theme-root"
      style={view === "chat" ? { height: `${viewportHeight}px` } : undefined}
      className={`font-sans transition-colors duration-300 w-full ${isDarkMode ? "bg-sleek-body text-slate-100" : "bg-slate-50 text-slate-800"
        } ${view === "chat" ? "fixed left-0 top-0 overflow-hidden" : "min-h-[100dvh]"}`}
    >
      <CustomCursor />
      {/* Background Decorative Tech Grids */}
      <div id="grid-background" className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div
          id="neon-grid-pattern"
          className={`absolute inset-0 bg-[linear-gradient(to_right,rgba(6,182,212,0.025)_1px,transparent_1px),linear-gradient(to_bottom,rgba(6,182,212,0.025)_1px,transparent_1px)] bg-[size:4rem_4rem]`}
        />
        <div
          id="neon-blur-spotlight-1"
          className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-cyan-500/10 blur-[140px] animate-pulse"
        />
        <div
          id="neon-blur-spotlight-2"
          className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-indigo-500/10 blur-[140px] animate-pulse"
        />
      </div>

      <div
        id="main-content-scroller"
        className={`relative z-10 flex flex-col ${view === "chat" ? "w-full h-full px-0 md:px-8 py-0 md:py-3 justify-between overflow-hidden md:max-w-7xl md:mx-auto" : "max-w-7xl mx-auto min-h-[100dvh] px-4 md:px-8 justify-between pb-4 md:pb-6"
          }`}
      >
        {/* Navigation / Control Header */}
        <header
          id="global-nav-bar"
          className={`sticky top-0 z-40 flex items-center justify-between py-3 px-6 my-2 rounded-3xl border select-none transition-colors duration-300 ${view === "chat" ? "hidden md:flex" : "flex"
            } ${isDarkMode
              ? "bg-sleek-card border-white/5 shadow-lg shadow-black/35"
              : "bg-white border-slate-200/80 shadow-md"
            }`}
        >
          <div id="brand-logo" className="flex items-center gap-3">
            <div
              id="brand-badge"
              className="w-10 h-10 bg-gradient-to-tr from-cyan-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white"
            >
              <Zap className="w-5 h-5" />
            </div>
            <div className="text-left">
              <h1 className="text-xl font-bold tracking-tight leading-tight">
                <span className={isDarkMode ? "bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400" : "text-slate-900"}>
                  Instant07
                </span>
              </h1>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none">
                Pair & Share
              </p>
            </div>
          </div>

          <div id="nav-actions" className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Active</span>
            </div>

            {/* Dark Mode switcher */}
            <button
              id="theme-toggle-btn"
              onClick={handleToggleTheme}
              className={`p-2.5 rounded-xl border cursor-pointer transition-all ${isDarkMode
                ? "border-white/10 hover:border-cyan-500/50 text-amber-400 bg-white/5"
                : "border-slate-200 hover:border-indigo-600 text-indigo-600 bg-white"
                }`}
              title={isDarkMode ? "Switch to Light Theme" : "Switch to Dark Theme"}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Core Router Body */}
        <main
          id="view-renderer-canvas"
          className={`flex-1 flex flex-col min-h-0 ${view === "chat"
            ? "justify-start py-0 md:py-4 overflow-hidden"
            : "justify-center py-4"
            }`}
        >
          {view === "home" && (
            <div id="hero-view" className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center text-center lg:text-left max-w-7xl mx-auto animate-slide-up py-2 md:py-4 w-full">
              {/* Left Side: Heading, Info, and Notice */}
              <div className="lg:col-span-7 flex flex-col items-center lg:items-start text-center lg:text-left space-y-6">
                <div id="hero-heading" className="space-y-4">
                  <h2 className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-tight lg:leading-[1.05]">
                    Connect Instantly with <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400">Secure QR Codes</span>
                  </h2>
                  <p className="text-sm md:text-base text-slate-400 leading-relaxed max-w-lg mx-auto lg:mx-0">
                    A modern, secure E2E platform for sharing messages and files instantly. Zero logging, zero sign-ups, and absolute privacy.
                  </p>
                </div>

                {/* Development Notice Banner */}
                <div id="dev-notice-banner" className="max-w-md p-4 rounded-3xl border text-sm font-semibold flex items-center justify-center lg:justify-start gap-2.5 shadow-sm bg-amber-500/10 border-amber-500/20 text-amber-500 w-full">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Notice: Some features are under active development.</span>
                </div>

                {/* Security and Feature Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full pt-4">
                  {/* Card 1 */}
                  <div className={`p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-lg text-left group ${isDarkMode
                    ? "bg-white/5 border-white/5 hover:border-cyan-500/30 hover:shadow-cyan-500/5 text-white"
                    : "bg-slate-50 border-slate-200 hover:border-indigo-400 hover:shadow-indigo-500/5 text-slate-800"
                    }`}>
                    <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 w-fit mb-3 group-hover:scale-110 transition-transform">
                      <Shield className="w-5 h-5 animate-pulse" />
                    </div>
                    <h5 className="font-bold text-xs uppercase tracking-wider text-cyan-400 mb-1">AES-256 E2E</h5>
                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                      All messages and files are encrypted client-side using WebCrypto keys.
                    </p>
                  </div>

                  {/* Card 2 */}
                  <div className={`p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-lg text-left group ${isDarkMode
                    ? "bg-white/5 border-white/5 hover:border-indigo-500/30 hover:shadow-indigo-500/5 text-white"
                    : "bg-slate-50 border-slate-200 hover:border-indigo-400 hover:shadow-indigo-500/5 text-slate-800"
                    }`}>
                    <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 w-fit mb-3 group-hover:scale-110 transition-transform">
                      <Lock className="w-5 h-5" />
                    </div>
                    <h5 className="font-bold text-xs uppercase tracking-wider text-indigo-400 mb-1">Zero Logging</h5>
                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                      No server persistence. Active keys are held purely in ephemeral state.
                    </p>
                  </div>

                  {/* Card 3 */}
                  <div className={`p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-lg text-left group ${isDarkMode
                    ? "bg-white/5 border-white/5 hover:border-purple-500/30 hover:shadow-purple-500/5 text-white"
                    : "bg-slate-50 border-slate-200 hover:border-indigo-400 hover:shadow-indigo-500/5 text-slate-800"
                    }`}>
                    <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 w-fit mb-3 group-hover:scale-110 transition-transform">
                      <ServerCrash className="w-5 h-5" />
                    </div>
                    <h5 className="font-bold text-xs uppercase tracking-wider text-purple-400 mb-1">DATA</h5>
                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                      Peers share data directly when online. No central databases, no trace.
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Side: Action Buttons & Developer Credits Stacked */}
              <div className="lg:col-span-5 flex flex-col gap-6 w-full max-w-md mx-auto">
                <div id="action-buttons-grid" className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full select-none">
                  <button
                    id="btn-generate-flow"
                    onClick={handleCreateRoom}
                    className="flex flex-col items-center gap-4 p-6 rounded-[2rem] border transition-all duration-300 cursor-pointer bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-xl shadow-cyan-500/10 border-white/5 hover:scale-[1.02] group"
                  >
                    <div className="p-4 rounded-2xl bg-white/10 text-white">
                      <QrCode className="w-8 h-8 group-hover:rotate-6 transition-transform" />
                    </div>
                    <div className="text-center">
                      <h4 className="font-bold text-base">Create Chat</h4>
                      <p className="text-[11px] text-cyan-100/80 mt-1">
                        Start a new group chat room instantly
                      </p>
                    </div>
                  </button>

                  <button
                    id="btn-scan-flow"
                    onClick={() => setView("scan")}
                    className={`flex flex-col items-center gap-4 p-6 rounded-[2rem] border transition-all duration-300 cursor-pointer hover:scale-[1.02] group ${isDarkMode
                      ? "bg-white/5 border-white/5 hover:border-cyan-500/30 hover:bg-white/10 text-white"
                      : "bg-white border-slate-200 hover:border-indigo-600 hover:bg-slate-50 text-slate-800"
                      }`}
                  >
                    <div className="p-4 rounded-2xl bg-cyan-500/10 text-cyan-400">
                      <ScanLine className="w-8 h-8 group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="text-center">
                      <h4 className="font-bold text-base">Join Chat</h4>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Scan QR or enter 6-digit invite code
                      </p>
                    </div>
                  </button>
                </div>

                {/* Developer/App Credits Card */}
                <div
                  id="developer-credits-card"
                  className={`relative overflow-hidden p-5 rounded-[2rem] border text-center transition-all duration-500 hover:scale-[1.03] hover:-translate-y-1 hover:shadow-xl w-full group ${isDarkMode
                    ? "bg-gradient-to-br from-[#121216] via-indigo-950/15 to-[#1c1c24] border-cyan-500/25 shadow-md shadow-cyan-500/5 hover:border-cyan-400/50 hover:shadow-cyan-500/10"
                    : "bg-gradient-to-br from-white via-indigo-50/20 to-purple-50/30 border-slate-200/80 shadow-sm hover:border-indigo-400 hover:shadow-indigo-500/10"
                    }`}
                >
                  {/* Subtle Hover Radial Gradient Glow Effect */}
                  <div className="absolute -inset-24 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.15),transparent_60%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                  {/* Floating sparkle icon header ornament */}
                  <div className="absolute top-4 right-4 text-cyan-400/40 group-hover:text-cyan-400 group-hover:rotate-12 transition-all duration-500">
                    <Sparkles className="w-4 h-4 animate-pulse" />
                  </div>

                  <div className="relative z-10 flex flex-col items-center">
                    <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-black flex items-center gap-1.5 justify-center mb-1">
                      <Code2 className="w-3 h-3 text-cyan-400" />
                      Project Developer
                    </p>

                    <h4 className="text-sm md:text-base font-black bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent uppercase tracking-wider leading-none">
                      Satyajit Pratihar
                    </h4>

                    <div className="inline-flex items-center gap-1 mt-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shadow-sm animate-pulse">
                      <GraduationCap className="w-3.5 h-3.5" />
                      <span>GNIT - IT Student</span>
                    </div>

                    {/* Creative details section */}
                    <div className="mt-3.5 w-full border-t border-slate-200 dark:border-white/5 pt-3.5 space-y-1.5 text-left text-[10px] text-slate-600 dark:text-slate-400 font-semibold max-w-[240px]">
                      <p className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0"></span>
                        <span className="truncate">Guru Nanak Institute of Technology</span>
                      </p>
                      <p className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0"></span>
                        <span>Frontend & Mobile App Developer</span>
                      </p>
                      <p className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0"></span>
                        <span>Secure Web Application Builder</span>
                      </p>
                    </div>

                    {/* Actions/Social Footer */}
                    <div className="mt-4 flex justify-center w-full gap-2">
                      <a
                        href="https://github.com/satyajitpratihar07"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-xl transition-all hover:scale-[1.03] active:scale-[0.97] cursor-pointer shadow-sm ${isDarkMode
                          ? "bg-slate-950/80 hover:bg-slate-950 border border-white/5 hover:border-cyan-400 text-cyan-400"
                          : "bg-slate-100 hover:bg-slate-200 border border-slate-200 text-indigo-600"
                          }`}
                      >
                        <Github className="w-3.5 h-3.5" />
                        GitHub Profile
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === "scan" && (
            <div id="scan-view" className="animate-slide-up">
              <QrScanner
                onScanSuccess={requestConnection}
                onCancel={() => setView("home")}
                isDarkMode={isDarkMode}
              />
            </div>
          )}

          {view === "chat" && !session && (
            <div className="flex-grow flex flex-col items-center justify-center py-20 space-y-4">
              <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
              <p className={`text-sm font-semibold tracking-wider ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                Re-connecting to secure chat...
              </p>
            </div>
          )}

          {view === "chat" && session && (
            <div id="chat-view" className="animate-fade-in w-full h-full max-w-full md:max-w-[95%] xl:max-w-[1400px] mx-auto overflow-hidden flex flex-col flex-1 min-h-0">
              <ChatRoom
                roomId={session.connectedRoomId || ""}
                sessionId={session.id}
                sessionName={roomMemberName || session.name}
                avatarSeed={session.avatarSeed}
                peer={peer}
                peers={peers}
                messages={messages}
                peerOnline={peerOnline}
                peerTyping={peerTyping}
                typingNames={typingNames}
                joinRequests={joinRequests}
                onSendMessage={sendMessage}
                onSendKnock={sendKnock}
                knockVolume={knockVolume}
                onChangeKnockVolume={setKnockVolume}
                onDeleteMessage={deleteMessage}
                onSetTyping={handleSetTyping}
                onLeaveRoom={leaveRoom}
                onScanSuccess={requestConnection}
                onRespondJoinRequest={respondGroupConnection}
                isDarkMode={isDarkMode}
                autoShowInvite={autoShowInvite}
                keepAlive3h={keepAlive3h}
                onToggleKeepAlive={() => setKeepAlive3h((prev) => !prev)}
                isHost={isHostRef.current}
                roomExpiresAt={roomExpiresAt || Date.now() + 3 * 60 * 60 * 1000}
                isKeyboardLocked={isKeyboardLocked}
                onKeyboardLockChange={(locked) => {
                  isKeyboardLockedRef.current = locked;
                  setIsKeyboardLocked(locked);
                }}
              />
            </div>
          )}
        </main>
      </div>

      {/* --- Overlay 1: Incoming Invitation Request Card --- */}
      {incomingRequest && (
        <div id="incoming-modal-backdrop" className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div
            id="incoming-modal-card"
            className="w-full max-w-[420px] bg-[#16161A] border border-cyan-500/30 rounded-3xl p-6 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.8),0_0_20px_rgba(34,211,238,0.2)] z-50 animate-in fade-in slide-in-from-top-4 duration-500 text-left"
          >
            <div className="flex items-start gap-5">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0 border border-cyan-500/20 shadow-inner">
                <Bell className="w-6 h-6 animate-bounce" />
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-black text-white tracking-tight mb-1">New Connection Request</h4>
                <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                  User <span className="text-cyan-400 font-mono font-bold text-xs bg-cyan-500/10 px-1.5 py-0.5 rounded">{incomingRequest.name}</span> wants to establish a secure peer channel with you.
                </p>
                <div className="flex gap-3">
                  <button
                    id="btn-incoming-accept"
                    onClick={() => respondConnection(true)}
                    className="flex-1 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl transition-all hover:scale-[1.02] cursor-pointer text-center text-xs"
                  >
                    Accept
                  </button>
                  <button
                    id="btn-incoming-decline"
                    onClick={() => respondConnection(false)}
                    className="flex-1 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold rounded-xl transition-all hover:scale-[1.02] cursor-pointer text-center text-xs"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Overlay 2: Outgoing Request Loader --- */}
      {isConnecting && (
        <div id="outgoing-loader-backdrop" className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
          <div
            id="outgoing-loader-card"
            className="w-full max-w-[400px] bg-[#16161A] border border-cyan-500/30 rounded-3xl p-6 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.8),0_0_20px_rgba(34,211,238,0.2)] z-50 text-center relative"
          >
            <div id="spinning-loader" className="flex justify-center mb-5">
              <div className="w-12 h-12 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
            </div>
            <h4 className="text-lg font-black text-white tracking-tight">Pairing in progress...</h4>
            <p className="text-xs text-slate-400 mt-2 px-4 leading-relaxed">
              Sending secure request to QR code owner. Awaiting authorization response...
            </p>
          </div>
        </div>
      )}

      {/* --- Overlay 3: Group Join Approval Loader --- */}
      {waitingForGroupApprove && (
        <div id="group-join-loader-backdrop" className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
          <div
            id="group-join-loader-card"
            className="w-full max-w-[400px] bg-[#16161A] border border-cyan-500/30 rounded-3xl p-6 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.8),0_0_20px_rgba(34,211,238,0.2)] text-center relative animate-scale-up"
          >
            <div id="spinning-loader" className="flex justify-center mb-5">
              <div className="w-12 h-12 rounded-full border-4 border-t-cyan-400 border-cyan-500/10 animate-spin shadow-[0_0_15px_rgba(34,211,238,0.3)]" />
            </div>
            <h4 className="text-lg font-black text-white tracking-tight">Requesting Entry...</h4>
            <p className="text-xs text-slate-400 mt-2 px-4 leading-relaxed">
              Your join request has been delivered. Please wait for a chat room member to approve you.
            </p>
            <button
              onClick={cancelJoinRequest}
              className="mt-6 px-5 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold rounded-xl transition-all hover:scale-[1.02] cursor-pointer text-xs uppercase tracking-wider"
            >
              Cancel Request
            </button>
          </div>
        </div>
      )}
      {/* Host Offline Alert Modal */}
      {showHostOfflineModal && (
        <div id="host-offline-modal-backdrop" className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div
            id="host-offline-modal-card"
            className={`w-full max-w-[380px] p-6 rounded-3xl border shadow-2xl text-center animate-scale-up backdrop-blur-md ${isDarkMode ? "bg-slate-900/95 border-rose-500/30 text-white" : "bg-white/95 border-slate-200 text-slate-800"
              }`}
          >
            <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto mb-4 border border-rose-500/20 shadow-inner">
              <AlertCircle className="w-8 h-8 animate-pulse" />
            </div>
            <h3 className="text-xl font-black tracking-tight mb-2 uppercase">
              Host Now Offline
            </h3>
            <p className={`text-xs mb-6 leading-relaxed ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
              The chat room host has disconnected. All messages and files have been permanently deleted from the database.
            </p>
            <button
              id="btn-close-host-offline"
              onClick={() => setShowHostOfflineModal(false)}
              className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-all hover:scale-[1.02] cursor-pointer text-center text-xs uppercase tracking-wider shadow-lg shadow-rose-600/15"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {/* --- Floating Guide Chatbot Component --- */}
      <div id="guide-chatbot-container" className="fixed bottom-6 right-6 z-[90] select-none">
        {/* Floating Toggle Button */}
        <button
          id="btn-chatbot-trigger"
          onClick={() => isBotOpen ? handleCloseBot() : setIsBotOpen(true)}
          className={`flex items-center justify-center w-14 h-14 rounded-full border shadow-2xl transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95 group relative ${isBotOpen
            ? "bg-[#18181b]/95 border-rose-500/40 text-rose-400 shadow-rose-500/10"
            : isDarkMode
              ? "bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 border-cyan-500/30 text-white shadow-cyan-500/15"
              : "bg-gradient-to-tr from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 border-indigo-500/20 text-white shadow-indigo-500/15"
            }`}
        >
          {isBotOpen ? (
            <X className="w-6 h-6 transition-transform group-hover:rotate-90 duration-300" />
          ) : (
            <>
              <Bot className="w-6 h-6 animate-pulse" />
              {/* Notification dot */}
              <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 border border-white dark:border-[#090b10] rounded-full animate-ping" />
              <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 border border-white dark:border-[#090b10] rounded-full" />
            </>
          )}
        </button>

        {/* Full Page Chatbot Window Panel */}
        <div
          id="chatbot-window-panel"
          className={`fixed inset-0 z-[100] flex flex-col overflow-hidden backdrop-blur-xl transition-all duration-500 ${
            isBotOpen
              ? "opacity-100 pointer-events-auto scale-100"
              : "opacity-0 pointer-events-none scale-95"
          } ${
            isDarkMode ? "bg-[#0A0A0C]/98 text-white" : "bg-slate-50/98 text-slate-800"
          }`}
        >
          {/* Header */}
          <div className="max-w-5xl mx-auto w-full flex items-center justify-between px-6 py-6 md:py-8 shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-400 via-indigo-400 to-purple-400 flex items-center justify-center text-white shadow-lg animate-pulse">
                <Bot className="w-6 h-6" />
              </div>
              <div className="text-left">
                <h3 className="text-lg md:text-xl font-black uppercase tracking-wider bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                  Instant Assistant & Guide
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>Interactive System Walkthrough</span>
                </p>
              </div>
            </div>
            <button
              onClick={handleCloseBot}
              className={`p-3 rounded-full border transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center ${
                isDarkMode 
                  ? "bg-white/5 border-white/10 hover:border-rose-500 hover:text-rose-400 text-slate-400" 
                  : "bg-slate-100 border-slate-200 hover:border-rose-500 hover:text-rose-600 text-slate-600"
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 max-w-5xl mx-auto w-full px-6 flex flex-col gap-6 pb-6 overflow-hidden">
            {/* Messages Display Box */}
            <div className={`flex-1 p-6 rounded-[2rem] border shadow-2xl flex flex-col overflow-hidden ${
              isDarkMode 
                ? "bg-[#121216]/60 border-cyan-500/20 shadow-cyan-500/5" 
                : "bg-white/80 border-slate-200/80 shadow-slate-200/50"
            }`}>
              <div className="overflow-y-auto flex-1 space-y-4 pr-2 custom-scrollbar text-xs md:text-sm leading-relaxed">
                {botMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex w-full ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] p-4 rounded-3xl text-left whitespace-pre-wrap shadow-sm border ${
                        msg.sender === "user"
                          ? isDarkMode
                            ? "bg-gradient-to-tr from-cyan-500 to-indigo-600 border-cyan-500/25 text-white rounded-br-none font-bold"
                            : "bg-gradient-to-tr from-indigo-500 to-cyan-500 border-indigo-500/20 text-white rounded-br-none font-bold"
                          : isDarkMode
                            ? "bg-[#090b10] border-white/5 text-slate-300 rounded-bl-none font-semibold"
                            : "bg-slate-50 border-slate-200/60 text-slate-600 rounded-bl-none font-semibold"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
                <div ref={botMessagesEndRef} />
              </div>
            </div>

            {/* Options Chips Section */}
            <div className="flex-shrink-0 space-y-3 pb-2">
              <div className="text-left">
                <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Select a topic to ask the assistant
                </h4>
              </div>

              {/* Fully visible Grid of Chips (Non-Scrollable!) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 w-full select-none">
                {[
                  "How to create chat?",
                  "How to join?",
                  "Is it secure?",
                  "Explain buttons",
                  "File sharing guide",
                  "How to pairing QR?",
                  "How does E2E work?",
                  "What is WebRTC?",
                  "Who is developer?",
                  "Is it free to use?",
                  "Does it store files?",
                  "How to add peer?",
                  "How to close room?",
                  "What is ephemeral?",
                  "Can I use on mobile?",
                  "How to toggle dark mode?",
                  "Is registration needed?",
                  "How to send messages?",
                  "Can host read chats?",
                  "What if host leaves?",
                  "Are chats encrypted?",
                  "Does it work offline?",
                  "Supported file sizes?",
                  "What is Firebase role?",
                  "Instant QR pairing info",
                  "Clear History ✖"
                ].map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendBotMessage(q)}
                    className={`px-3 py-2.5 rounded-2xl text-[11px] font-bold tracking-tight transition-all active:scale-95 cursor-pointer text-center border shadow-sm ${
                      isDarkMode
                        ? q === "Clear History ✖"
                          ? "bg-rose-950/40 border-rose-500/35 hover:bg-rose-900 text-rose-300"
                          : "bg-white/5 border-white/5 hover:border-cyan-500/40 hover:bg-white/10 text-cyan-400"
                        : q === "Clear History ✖"
                          ? "bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-600"
                          : "bg-white border-slate-200 hover:border-indigo-500 hover:bg-slate-50 text-indigo-600"
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="toast-banners-holder" className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 md:top-6 md:bottom-auto md:left-1/2 md:-translate-x-1/2 md:-translate-y-0 z-[100] flex flex-col items-center gap-2.5 w-[calc(100%-2rem)] max-w-xs md:max-w-sm pointer-events-none select-none">
        {toasts.map((toast) => (
          <div
            id={`toast-${toast.id}`}
            key={toast.id}
            className={`p-4 rounded-2xl shadow-2xl flex items-center gap-3 border pointer-events-auto animate-scale-up text-xs md:text-sm font-semibold max-w-full ${toast.type === "success"
              ? "bg-[#061c12]/95 border-emerald-400/80 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.35)] backdrop-blur-md"
              : toast.type === "error"
                ? "bg-[#1f090d]/95 border-rose-500/80 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.35)] backdrop-blur-md"
                : isDarkMode
                  ? "bg-[#090b10]/95 border-cyan-500/40 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.25)] backdrop-blur-md"
                  : "bg-white/95 border-slate-200 text-slate-700 backdrop-blur-md shadow-slate-200/50"
              }`}
          >
            {toast.type === "success" ? (
              <Check className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : toast.type === "error" ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            ) : (
              <Bell className="w-4 h-4 shrink-0 text-cyan-400" />
            )}
            <span className="text-left flex-1 break-words">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  Code2
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

export default function App() {
  // --- Core State ---
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<"home" | "generate" | "scan" | "chat">(() => {
    return localStorage.getItem("qr_e2e_connected_room_id") ? "chat" : "home";
  });
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

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
        className={`relative z-10 flex flex-col ${view === "chat" ? "w-full h-full px-0 md:px-8 py-0 md:py-3 justify-between overflow-hidden md:max-w-7xl md:mx-auto" : "max-w-7xl mx-auto min-h-[100dvh] px-4 md:px-8 justify-between pb-8 md:pb-12"
          }`}
      >
        {/* Navigation / Control Header */}
        <header
          id="global-nav-bar"
          className={`sticky top-0 z-40 flex items-center justify-between py-4 px-6 my-4 rounded-3xl border select-none transition-colors duration-300 ${view === "chat" ? "hidden md:flex" : "flex"
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
                  Instant 2.0
                </span>
              </h1>
              <p className={`text-[10px] font-medium uppercase tracking-widest ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
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
              : "justify-center py-8"
            }`}
        >
          {view === "home" && (
            <div id="hero-view" className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center text-center lg:text-left max-w-5xl mx-auto animate-slide-up py-4 md:py-8 w-full">
              {/* Left Side: Heading, Info, and Notice */}
              <div className="lg:col-span-7 flex flex-col items-center lg:items-start text-center lg:text-left space-y-6">
                <div id="hero-heading" className="space-y-4">
                  <h2 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-tight">
                    Connect Instantly with <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400">Secure QR Codes</span>
                  </h2>
                  <p className="text-sm md:text-base text-slate-400 leading-relaxed max-w-lg mx-auto lg:mx-0">
                    A modern, secure E2E platform for sharing messages and files instantly. Zero logging, zero sign-ups, and absolute privacy.
                  </p>
                </div>

                {/* Development Notice Banner */}
                <div id="dev-notice-banner" className="max-w-md p-4 rounded-3xl border text-sm font-semibold flex items-center justify-center lg:justify-start gap-2.5 shadow-sm bg-amber-500/10 border-amber-500/20 text-amber-500">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Notice: Some features are under active development.</span>
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
                  className={`relative overflow-hidden p-5 rounded-[2rem] border text-center transition-all duration-500 hover:scale-[1.03] hover:-translate-y-1 hover:shadow-xl w-full group ${
                    isDarkMode
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
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-xl transition-all hover:scale-[1.03] active:scale-[0.97] cursor-pointer shadow-sm ${
                          isDarkMode
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

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
  AlertCircle
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
  const adjectives = ["Secure", "Crypto", "Swift", "Silent", "Shadow", "Alpha", "Zenith", "Quantum", "Cipher", "Vortex"];
  const nouns = ["Peer", "Node", "Link", "Ghost", "Falcon", "Nova", "Pulse", "Beacon", "Matrix", "Cipher"];
  return adjectives[Math.floor(Math.random() * adjectives.length)] + " " + nouns[Math.floor(Math.random() * nouns.length)];
}

export default function App() {
  // --- Core State ---
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<"home" | "generate" | "scan" | "chat">("home");
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

  // --- Real-time Session listener (incoming requests & pairing status) ---
  useEffect(() => {
    if (!session?.id) return;

    const mySessionRef = ref(db, `sessions/${session.id}`);
    const unsubscribeMySession = onValue(mySessionRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.val();

      // Handle connectedRoomId changes
      if (data.connectedRoomId && data.connectedRoomId !== session.connectedRoomId) {
        setSession((prev) => prev ? { ...prev, connectedRoomId: data.connectedRoomId } : null);
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
          addToast("Successfully joined chat room!", "success");
          update(mySessionRef, { pairingStatus: null });
        }
      }
    });

    return () => unsubscribeMySession();
  }, [session?.id, session?.connectedRoomId]);

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

    const roomUnsubscribe = onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        // Room was closed/deleted
        setPeer(null);
        setPeers([]);
        setPeerOnline(false);
        setPeerTyping(false);
        setMessages([]);
        setSession((prev) => prev ? { ...prev, connectedRoomId: null } : null);
        setView("home");
        addToast("Active room was closed or peer left.", "info");
        return;
      }

      const roomData = snapshot.val();
      const membersMap = roomData.members || {};

      // Security check: Kick out of chat room if user is not an approved member
      if (!membersMap[session.id]) {
        setPeer(null);
        setPeers([]);
        setPeerOnline(false);
        setPeerTyping(false);
        setMessages([]);
        setSession((prev) => prev ? { ...prev, connectedRoomId: null } : null);
        update(ref(db, `sessions/${session.id}`), { connectedRoomId: null });
        setView("home");
        addToast("Access denied. You are not a member of this chat room.", "error");
        return;
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
        const msgList: Message[] = Object.entries(roomData.messages).map(([id, val]: [string, any]) => ({
          id,
          senderId: val.senderId,
          senderName: val.senderId === session.id ? session.name : (membersMap[val.senderId]?.name || val.senderName || "Member"),
          text: val.text,
          timestamp: val.timestamp,
          file: val.file || undefined
        })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

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

      // Register disconnect cleanup handlers
      const myMemberRef = ref(db, `rooms/${roomId}/members/${session.id}`);
      const myTypingRef = ref(db, `rooms/${roomId}/typing/${session.id}`);
      const roomNodeRef = ref(db, `rooms/${roomId}`);

      onDisconnect(myMemberRef).remove();
      onDisconnect(myTypingRef).remove();

      // If no other peers are present, delete the entire room on disconnect
      if (peersList.length === 0) {
        onDisconnect(roomNodeRef).remove();
      } else {
        onDisconnect(roomNodeRef).cancel();
      }

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
      roomUnsubscribe();

      // Cancel onDisconnect handlers for this room session
      const myMemberRef = ref(db, `rooms/${roomId}/members/${session.id}`);
      const myTypingRef = ref(db, `rooms/${roomId}/typing/${session.id}`);
      const roomNodeRef = ref(db, `rooms/${roomId}`);
      onDisconnect(myMemberRef).cancel();
      onDisconnect(myTypingRef).cancel();
      onDisconnect(roomNodeRef).cancel();
    };
  }, [session?.connectedRoomId, session?.id]);

  // --- Handshake & Register Session ---
  useEffect(() => {
    // 1. Theme restoration
    const cachedTheme = localStorage.getItem("qr_p2p_dark_theme");
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
    const savedSessionId = localStorage.getItem("qr_p2p_session_id");

    const initializeSession = async () => {
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
        activeSession = {
          id: newId,
          avatarSeed: Math.random().toString(36).substring(7),
          name: generateRandomName(),
          connectedRoomId: null,
          lastActive: Date.now()
        };
        try {
          await set(ref(db, `sessions/${newId}`), activeSession);
        } catch (e) {
          console.error("Error creating session:", e);
        }
      }

      // Clean up session node on disconnect/refresh
      onDisconnect(ref(db, `sessions/${activeSession.id}`)).remove();

      setSession(activeSession);
      localStorage.setItem("qr_p2p_session_id", activeSession.id);

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

    const newRoomId = generateUUID();
    try {
      await set(ref(db, `rooms/${newRoomId}`), {
        id: newRoomId,
        createdTime: Date.now(),
        members: {
          [session.id]: {
            id: session.id,
            name: session.name,
            avatarSeed: session.avatarSeed,
            joinedAt: Date.now(),
            lastActive: Date.now()
          }
        }
      });

      await update(ref(db, `sessions/${session.id}`), {
        connectedRoomId: newRoomId
      });

      setSession((prev) => prev ? { ...prev, connectedRoomId: newRoomId } : null);
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
            // Write a join request instead of directly joining
            await set(ref(db, `rooms/${roomId}/joinRequests/${activeSess.id}`), {
              id: activeSess.id,
              name: activeSess.name,
              avatarSeed: activeSess.avatarSeed,
              timestamp: Date.now()
            });

            setWaitingForGroupApprove(roomId);
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
          // Write a group join request to the room
          await set(ref(db, `rooms/${roomId}/joinRequests/${activeSess.id}`), {
            id: activeSess.id,
            name: activeSess.name,
            avatarSeed: activeSess.avatarSeed,
            timestamp: Date.now()
          });

          setWaitingForGroupApprove(roomId);
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
          members: {
            [session.id]: {
              id: session.id,
              name: session.name,
              avatarSeed: session.avatarSeed,
              joinedAt: Date.now(),
              lastActive: Date.now()
            },
            [senderId]: {
              id: senderId,
              name: incomingRequest.name,
              avatarSeed: incomingRequest.avatarSeed,
              joinedAt: Date.now(),
              lastActive: Date.now()
            }
          },
          createdTime: Date.now()
        });

        await update(ref(db, `sessions/${senderId}`), {
          connectedRoomId: newRoomId,
          pairingStatus: { type: "accepted", roomId: newRoomId }
        });

        await update(ref(db, `sessions/${session.id}`), {
          connectedRoomId: newRoomId
        });
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
        // 2. Add to members list of the room
        await set(ref(db, `rooms/${roomId}/members/${senderId}`), {
          id: senderId,
          name: requester.name,
          avatarSeed: requester.avatarSeed,
          joinedAt: Date.now(),
          lastActive: Date.now()
        });

        // 3. Update joining session connectedRoomId and pairingStatus
        await update(ref(db, `sessions/${senderId}`), {
          connectedRoomId: roomId,
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
  const leaveRoom = async () => {
    if (!session?.connectedRoomId) return;
    const roomId = session.connectedRoomId;

    try {
      // 1. Remove myself from room members list
      await remove(ref(db, `rooms/${roomId}/members/${session.id}`));

      // 2. Clear typing indicator if active
      await remove(ref(db, `rooms/${roomId}/typing/${session.id}`));

      // 3. Clear my session connectedRoomId
      await update(ref(db, `sessions/${session.id}`), { connectedRoomId: null });

      // 4. If no members left in the room, clean it up from database
      const roomSnap = await get(ref(db, `rooms/${roomId}`));
      if (roomSnap.exists()) {
        const roomData = roomSnap.val();
        const remainingMembers = Object.keys(roomData.members || {});
        if (remainingMembers.length === 0) {
          await remove(ref(db, `rooms/${roomId}`));
        }
      }

      setSession((prev) => prev ? { ...prev, connectedRoomId: null } : null);
      setPeers([]);
      setMessages([]);
      setView("home");
      addToast("You left the chat room.", "info");
    } catch (e) {
      console.error("Failed to leave room:", e);
      setSession((prev) => prev ? { ...prev, connectedRoomId: null } : null);
      setView("home");
    }
  };

  // --- Send Message Hook ---
  const sendMessage = async (text: string, fileId?: string, fileMeta?: any) => {
    if (!session?.connectedRoomId) return;
    const roomId = session.connectedRoomId;

    try {
      const messagesRef = ref(db, `rooms/${roomId}/messages`);
      const newMsgRef = push(messagesRef);
      await set(newMsgRef, {
        id: newMsgRef.key,
        senderId: session.id,
        senderName: session.name, // Save sender name directly inside the message
        text,
        timestamp: Date.now(),
        file: fileId ? { id: fileId, ...fileMeta } : null
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
      await leaveRoom();
    }

    localStorage.removeItem("qr_p2p_session_id");
    const newId = generateUUID();
    const newSession = {
      id: newId,
      avatarSeed: Math.random().toString(36).substring(7),
      name: generateRandomName(),
      connectedRoomId: null,
      lastActive: Date.now()
    };

    try {
      await set(ref(db, `sessions/${newId}`), newSession);
      setSession(newSession);
      localStorage.setItem("qr_p2p_session_id", newId);
      addToast("Secure session refreshed successfully!", "success");
    } catch (e) {
      console.error("Failed to refresh session:", e);
    }
  };

  // --- Toggle Light/Dark Mode ---
  const handleToggleTheme = () => {
    const nextVal = !isDarkMode;
    setIsDarkMode(nextVal);
    localStorage.setItem("qr_p2p_dark_theme", String(nextVal));
  };

  return (
    <div
      id="app-theme-root"
      className={`min-h-screen font-sans transition-colors duration-300 ${isDarkMode ? "bg-sleek-body text-slate-100" : "bg-slate-50 text-slate-800"
        }`}
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

      {/* Main Container Wrapper */}
      <div id="main-content-scroller" className="relative z-10 flex flex-col min-h-screen justify-between max-w-7xl mx-auto px-4 md:px-8">
        {/* Navigation / Control Header */}
        <header
          id="global-nav-bar"
          className={`flex items-center justify-between py-4 px-6 my-4 rounded-2xl border select-none transition-colors duration-300 ${isDarkMode
              ? "bg-sleek-card border-white/5 shadow-lg shadow-black/35"
              : "bg-white border-slate-200/80 shadow-md"
            }`}
        >
          <div id="brand-logo" className="flex items-center gap-3">
            <div
              id="brand-badge"
              className="w-10 h-10 bg-gradient-to-tr from-cyan-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white"
            >
              <Zap className="w-5 h-5" />
            </div>
            <div className="text-left">
              <h1 className="text-xl font-bold tracking-tight leading-tight">
                <span className={isDarkMode ? "bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400" : "text-slate-900"}>
                  InstantP2P
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
        <main id="view-renderer-canvas" className="flex-1 flex flex-col justify-center py-8">
          {view === "home" && (
            <div id="hero-view" className="text-center max-w-xl mx-auto space-y-10 animate-slide-up">
              <div id="hero-badge" className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                <span>Zero registration • ephemeral secure pairing</span>
              </div>

              <div id="hero-heading" className="space-y-4">
                <h2 className="text-3xl md:text-5xl font-black tracking-tight leading-tight">
                  Connect Instantly with <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-500">Secure QR Codes</span>
                </h2>
                <p className="text-sm md:text-base text-slate-400 leading-relaxed max-w-lg mx-auto">
                  A modern, secure P2P platform for sharing messages and files instantly. Zero logging, zero sign-ups, and absolute privacy.
                </p>
              </div>

              {/* Centered Large Action Buttons */}
              <div id="action-buttons-grid" className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-md mx-auto select-none">
                <button
                  id="btn-generate-flow"
                  onClick={handleCreateRoom}
                  className="flex flex-col items-center gap-4 p-6 rounded-3xl border transition-all duration-300 cursor-pointer bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-xl shadow-cyan-500/10 border-white/5 hover:scale-[1.02] group"
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
                  className={`flex flex-col items-center gap-4 p-6 rounded-3xl border transition-all duration-300 cursor-pointer hover:scale-[1.02] group ${isDarkMode
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

          {view === "chat" && session && (
            <div id="chat-view" className="animate-scale-up w-full h-full max-w-5xl mx-auto">
              <ChatRoom
                roomId={session.connectedRoomId || ""}
                sessionId={session.id}
                sessionName={session.name}
                avatarSeed={session.avatarSeed}
                peer={peer}
                peers={peers}
                messages={messages}
                peerOnline={peerOnline}
                peerTyping={peerTyping}
                typingNames={typingNames}
                joinRequests={joinRequests}
                onSendMessage={sendMessage}
                onDeleteMessage={deleteMessage}
                onSetTyping={handleSetTyping}
                onLeaveRoom={leaveRoom}
                onScanSuccess={requestConnection}
                onRespondJoinRequest={respondGroupConnection}
                isDarkMode={isDarkMode}
                autoShowInvite={autoShowInvite}
              />
            </div>
          )}
        </main>

        {/* Global Footer (Status Micro-Rail inspired by Sleek Theme) */}
        <footer
          id="global-footer"
          className={`py-3 px-6 mt-auto rounded-xl border select-none transition-colors duration-300 flex flex-col sm:flex-row items-center justify-between gap-3 text-[10px] font-mono tracking-wider ${isDarkMode
              ? "bg-[#0E0E12] border-white/5 text-slate-500"
              : "bg-white border-slate-200/80 text-slate-600 shadow-sm"
            }`}
        >
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse"></div>
              <span className="uppercase font-bold">WebSocket: Secured</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
              <span className="uppercase font-bold">Encryption: AES-256</span>
            </div>
          </div>
          <p className="uppercase opacity-80 font-bold text-cyan-400">Developed by Satyajit Pratihar</p>
        </footer>
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
      <div id="toast-banners-holder" className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none select-none">
        {toasts.map((toast) => (
          <div
            id={`toast-${toast.id}`}
            key={toast.id}
            className={`p-3.5 rounded-2xl shadow-xl flex items-center gap-3 border pointer-events-auto animate-slide-up text-xs font-semibold ${toast.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : toast.type === "error"
                  ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  : isDarkMode
                    ? "bg-slate-900 border-slate-800 text-slate-100"
                    : "bg-white border-slate-200 text-slate-700"
              }`}
          >
            {toast.type === "success" ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : toast.type === "error" ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <Bell className="w-4 h-4 shrink-0" />
            )}
            <span className="text-left flex-1">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

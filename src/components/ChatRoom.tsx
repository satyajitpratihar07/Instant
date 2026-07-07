import React, { useEffect, useRef, useState } from "react";
import {
  Send,
  Paperclip,
  Smile,
  Image,
  FileText,
  Volume2,
  Video,
  Trash2,
  Copy,
  Check,
  CheckCheck,
  LogOut,
  Wifi,
  Download,
  Info,
  X,
  File,
  Sparkles,
  ChevronRight,
  Menu,
  Plus,
  UserPlus,
  ScanLine,
  Loader2
} from "lucide-react";
import { Message, Peer, PendingFile, JoinRequest } from "../types";
import { formatBytes, getAvatarGradient, getInitials, MAX_FILE_SIZE_BYTES, playNotificationSound } from "../utils";
import Lightbox from "./Lightbox";
import QrGenerator from "./QrGenerator";
import QrScanner from "./QrScanner";
import { db } from "../firebase";
import { ref as dbRef, set, get, remove, onDisconnect } from "firebase/database";
import { AlertCircle } from "lucide-react";

// Determine appropriate icon for attachments
const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith("image/")) return <Image className="w-5 h-5 text-indigo-400" />;
  if (mimeType.startsWith("audio/")) return <Volume2 className="w-5 h-5 text-cyan-400" />;
  if (mimeType.startsWith("video/")) return <Video className="w-5 h-5 text-amber-400" />;
  if (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("document")) {
    return <FileText className="w-5 h-5 text-emerald-400" />;
  }
  return <File className="w-5 h-5 text-slate-400" />;
};

interface FileAttachmentViewProps {
  file: {
    id: string;
    name: string;
    type: string;
    size: number;
  };
  isMe: boolean;
  onSetLightbox: (url: string, name: string) => void;
}

function FileAttachmentView({ file, isMe, onSetLightbox }: FileAttachmentViewProps) {
  const [fileData, setFileData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchFile = async () => {
      try {
        const snap = await get(dbRef(db, `files/${file.id}`));
        if (snap.exists() && active) {
          const val = snap.val();
          setFileData(val.data);
        } else if (active) {
          setError("File not found");
        }
      } catch (e) {
        console.error("Error reading file:", e);
        if (active) setError("Load error");
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchFile();
    return () => { active = false; };
  }, [file.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 border border-white/5 bg-[#0E0E12]/20 rounded-xl max-w-xs text-xs text-slate-400 font-mono animate-pulse">
        <div className="w-3.5 h-3.5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mr-2"></div>
        Decrypting attachment...
      </div>
    );
  }

  if (error || !fileData) {
    return (
      <div className="flex items-center p-3 border border-red-500/20 bg-red-500/5 text-red-400 rounded-xl max-w-xs text-xs font-semibold">
        <AlertCircle className="w-4 h-4 mr-2" />
        Failed to decrypt file
      </div>
    );
  }

  const dataUrl = `data:${file.type};base64,${fileData}`;

  if (file.type.startsWith("image/")) {
    return (
      <div id="image-thumbnail-wrapper" className="relative group/img rounded-xl overflow-hidden border border-white/10 aspect-video max-w-xs bg-slate-950 flex items-center justify-center">
        <img
          id="thumbnail-img"
          src={dataUrl}
          alt={file.name}
          className="max-w-full max-h-[160px] object-cover cursor-zoom-in group-hover/img:scale-105 transition duration-300"
          onClick={() => onSetLightbox(dataUrl, file.name)}
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <span className="bg-[#0E0E12]/90 border border-white/5 text-white px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
            View Frame
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      id="document-preview-card"
      className={`flex items-center gap-3 p-3 rounded-xl border ${isMe
          ? "bg-[#0E0E12]/40 border-white/5"
          : "bg-[#0E0E12]/20 border-white/5"
        }`}
    >
      <div className="p-2.5 rounded-lg bg-white/5">
        {getFileIcon(file.type)}
      </div>
      <div className="text-left flex-1 min-w-0">
        <h5 className="font-bold text-xs truncate max-w-[150px] text-white">
          {file.name}
        </h5>
        <p className="text-[10px] opacity-75 text-slate-400 font-semibold font-mono">
          {formatBytes(file.size)}
        </p>
      </div>
      <a
        id={`download-${file.id}`}
        href={dataUrl}
        download={file.name}
        className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all shadow-sm flex items-center justify-center cursor-pointer"
        title="Download attachment"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

interface ChatRoomProps {
  roomId: string;
  sessionId: string;
  sessionName: string;
  avatarSeed: string;
  peer?: Peer | null;
  peers: Peer[];
  messages: Message[];
  peerOnline: boolean;
  peerTyping: boolean;
  typingNames?: string[];
  joinRequests?: JoinRequest[];
  onSendMessage: (text: string, fileId?: string, fileMeta?: any) => void;
  onDeleteMessage: (messageId: string) => void;
  onSetTyping?: (isTyping: boolean) => void;
  onLeaveRoom: () => void;
  onScanSuccess?: (targetId: string) => void;
  onRespondJoinRequest?: (req: JoinRequest, accept: boolean) => void;
  isDarkMode: boolean;
  autoShowInvite?: boolean;
}

export default function ChatRoom({
  roomId,
  sessionId,
  sessionName,
  avatarSeed,
  peer,
  peers,
  messages,
  peerOnline,
  peerTyping,
  typingNames = [],
  joinRequests = [],
  onSendMessage,
  onDeleteMessage,
  onSetTyping,
  onLeaveRoom,
  onScanSuccess,
  onRespondJoinRequest,
  isDarkMode,
  autoShowInvite,
}: ChatRoomProps) {
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showAddMember, setShowAddMember] = useState(autoShowInvite || false);
  const [showJoinChat, setShowJoinChat] = useState(false);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const activePeer = peers[0] || peer || { id: "awaiting", name: "Awaiting...", avatarSeed: "default", online: false };

  // Manage invite code lifecycle inside the ChatRoom component
  useEffect(() => {
    if (!showAddMember || !sessionId) {
      setInviteCode(null);
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setInviteCode(code);

    const registerCode = async () => {
      try {
        await set(dbRef(db, `codes/${code}`), {
          sessionId,
          roomId,
          createdAt: Date.now(),
        });
        // Register onDisconnect to remove code
        onDisconnect(dbRef(db, `codes/${code}`)).remove();
      } catch (err) {
        console.error("Error registering code:", err);
      }
    };
    registerCode();

    return () => {
      onDisconnect(dbRef(db, `codes/${code}`)).cancel();
      remove(dbRef(db, `codes/${code}`)).catch((err) => {
        console.error("Error removing code registration:", err);
      });
    };
  }, [showAddMember, sessionId]);

  // Automatically close the Add Member modal when a peer joins the chat room
  useEffect(() => {
    if (peers.length > 0) {
      setShowAddMember(false);
    }
  }, [peers.length]);

  const handleCopyCode = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleJoinWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = joinCodeInput.replace(/[-\s]/g, "");
    if (!/^\d{6}$/.test(sanitized)) {
      setJoinError("Please enter a valid 6-digit number.");
      return;
    }

    setJoinError(null);
    setJoining(true);

    try {
      const snap = await get(dbRef(db, `codes/${sanitized}`));
      if (snap.exists()) {
        const val = snap.val();
        setShowJoinChat(false);
        setJoinCodeInput("");
        onScanSuccess?.(val.sessionId);
      } else {
        setJoinError("Invalid or expired invite code.");
      }
    } catch (err) {
      console.error("Error joining with code:", err);
      setJoinError("Failed to verify code. Check connection.");
    } finally {
      setJoining(false);
    }
  };
  // Default sidebar closed on mobile (less than 768px wide)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isSelfTyping, setIsSelfTyping] = useState(false);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, peerTyping]);

  // Adjust sidebar state for mobile by default
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Handle local user typing state updates
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    // Send typing notification if not already typing
    if (!isSelfTyping) {
      setIsSelfTyping(true);
      onSetTyping?.(true);
    }

    // Reset typing timer
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsSelfTyping(false);
      onSetTyping?.(false);
    }, 2000);
  };

  // Keyboard layout triggers typing exit on submit
  const cleanupSelfTyping = () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setIsSelfTyping(false);
    onSetTyping?.(false);
  };

  // Handle Drag & Drop triggers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFiles(e.dataTransfer.files);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFiles(e.target.files);
    }
  };

  // Process the file inputs client-side, read into base64
  const processSelectedFiles = (fileList: FileList) => {
    setUploadError(null);
    const newAttachments: PendingFile[] = [];

    Array.from(fileList).forEach((file) => {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setUploadError(`File "${file.name}" exceeds the 15MB size limit.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64Data = (reader.result as string).split(",")[1];
        const isImage = file.type.startsWith("image/");
        const previewUrl = isImage ? (reader.result as string) : "";

        setAttachments((prev) => [
          ...prev,
          {
            file,
            previewUrl,
            base64Data,
            isImage,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Perform secure REST uploads and dispatch chat message socket
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && attachments.length === 0) return;

    cleanupSelfTyping();
    setIsUploading(true);
    setUploadError(null);

    try {
      if (attachments.length > 0) {
        // Upload each attachment directly to Firebase and dispatch messaging event
        for (const attachment of attachments) {
          const fileId = Math.random().toString(36).substring(2, 15);
          await set(dbRef(db, `files/${fileId}`), {
            id: fileId,
            name: attachment.file.name,
            type: attachment.file.type,
            size: attachment.file.size,
            data: attachment.base64Data,
          });

          // Send message with file metadata attached
          onSendMessage("", fileId, {
            name: attachment.file.name,
            type: attachment.file.type,
            size: attachment.file.size,
          });
        }
        setAttachments([]);
      }

      if (inputText.trim()) {
        onSendMessage(inputText.trim());
        setInputText("");
      }

      setShowEmojiPicker(false);
    } catch (err: any) {
      console.error("Error sending message:", err);
      setUploadError(err.message || "Failed to send file attachment. Try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyText = (text: string, msgId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(msgId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  // Pre-configured elegant emojis
  const defaultEmojis = ["👍", "❤️", "😂", "🔥", "👏", "🎉", "🙌", "😮", "🚀", "💬", "🤖", "✨", "💯", "📌", "💡", "👀"];

  const handleAddEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
  };

  // getFileIcon moved to file scope

  return (
    <div
      id="chat-layout-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex h-[85vh] md:h-[82vh] relative w-full overflow-hidden rounded-none md:rounded-3xl border-0 md:border transition-all duration-300 shadow-2xl backdrop-blur-md ${isDarkMode
          ? "bg-[#0E0E12]/80 border-white/5 shadow-cyan-500/5"
          : "bg-white/80 border-slate-200/80 shadow-slate-200/40"
        }`}
    >
      {/* Drag & Drop File Sharing Overlay */}
      {isDragging && (
        <div id="drag-overlay" className="absolute inset-0 bg-cyan-500/10 border-4 border-dashed border-cyan-400 z-40 flex flex-col items-center justify-center pointer-events-none animate-pulse">
          <Paperclip className="w-16 h-16 text-cyan-400 mb-3" />
          <h3 className="text-xl font-black text-white">Drop Files Here</h3>
          <p className="text-sm text-cyan-200 mt-1">Share images, PDFs, ZIPs, or other files up to 15MB instantly</p>
        </div>
      )}

      {/* Centered Group Join Requests Dialog Modal */}
      {joinRequests.length > 0 && (
        <div id="floating-group-join-requests" className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className={`p-6 rounded-3xl border shadow-2xl flex flex-col gap-4 animate-scale-up backdrop-blur-md w-full max-w-sm ${isDarkMode ? "bg-slate-900/95 border-cyan-500/35 text-white" : "bg-white/95 border-slate-200 text-slate-800"}`}>
            <h3 className="text-xs font-black tracking-wider uppercase text-cyan-400 text-center border-b border-white/5 pb-2">
              Incoming Connection Requests
            </h3>
            {joinRequests.map((req) => (
              <div key={req.id} className="flex items-center justify-between gap-3 py-1 border-b last:border-b-0 border-white/5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-bold bg-gradient-to-br shadow-sm ${getAvatarGradient(req.avatarSeed)} text-xs`}>
                    {getInitials(req.name)}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-xs font-bold truncate">{req.name}</p>
                    <p className={`text-[9px] font-bold ${isDarkMode ? "text-cyan-400" : "text-indigo-600"} uppercase tracking-wider`}>Join Request</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onRespondJoinRequest && onRespondJoinRequest(req, true)}
                    className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all cursor-pointer"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onRespondJoinRequest && onRespondJoinRequest(req, false)}
                    className={`px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all cursor-pointer ${
                      isDarkMode ? "bg-white/5 border border-white/10 hover:bg-white/10 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                    }`}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Messaging Interface Area */}
      <div id="chat-messages-area" className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Chat Header */}
        <header
          id="chat-header"
          className={`flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b ${isDarkMode ? "border-white/5 bg-[#0E0E12]/90" : "border-slate-200/60 bg-white/60"
            }`}
        >
          <div id="header-left" className="flex items-center gap-3 text-left">
            <div id="peer-avatar-wrapper" className="relative">
              <div
                id="peer-avatar"
                className={`w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center text-white font-bold bg-gradient-to-br shadow-md ${getAvatarGradient(
                  activePeer.avatarSeed
                )}`}
              >
                {peers.length > 1 ? `${peers.length + 1}` : getInitials(activePeer.name)}
              </div>
              <span
                id="peer-online-indicator"
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 md:w-3.5 md:h-3.5 rounded-full border-2 transition-colors ${isDarkMode ? "border-[#0E0E12]" : "border-white"
                  } ${(peers.length > 1 ? peers.some(p => p.online) : peerOnline) ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-slate-500"
                  }`}
              />
            </div>
            <div id="peer-status-info" className="text-left">
              <h4 className={`text-xs md:text-sm font-black tracking-tight ${isDarkMode ? "text-white" : "text-slate-800"}`}>
                {peers.length > 1 ? "Group Chat Room" : activePeer.name}
              </h4>
              <p className={`text-[9px] md:text-[10px] font-bold uppercase tracking-wider ${(peers.length > 1 ? peers.some(p => p.online) : peerOnline) ? "text-cyan-400" : "text-slate-400"
                }`}>
                {peers.length > 1
                  ? `${peers.filter(p => p.online).length + 1} of ${peers.length + 1} Active`
                  : peerOnline ? "Direct Active" : "Offline"
                }
              </p>
            </div>
          </div>

          <div id="header-right" className="flex items-center gap-1.5 md:gap-2">
            <button
              id="btn-add-member-inline"
              onClick={() => setShowAddMember(true)}
              className="flex items-center gap-1 py-1.5 px-2.5 md:px-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 border border-cyan-500/20 font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer"
              title="Add member"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Member</span>
            </button>

            <button
              id="btn-join-chat-inline"
              onClick={() => setShowJoinChat(true)}
              className="flex items-center gap-1 py-1.5 px-2.5 md:px-3 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border border-indigo-500/20 font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer"
              title="Join chat"
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Join Chat</span>
            </button>

            <button
              id="btn-toggle-sidebar"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className={`p-2 rounded-xl transition-all hover:bg-white/5 cursor-pointer ${isDarkMode ? "text-slate-300" : "text-slate-600 hover:bg-slate-100"
                }`}
              title="Show info panel"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              id="btn-leave-room"
              onClick={onLeaveRoom}
              className="flex items-center gap-1 py-1.5 px-2.5 md:px-3.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20 font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Disconnect</span>
            </button>
          </div>
        </header>

        {/* Message Feed Canvas */}
        <div id="chat-history-scroll" className="flex-1 overflow-y-auto p-3.5 md:p-6 space-y-3.5 md:space-y-4">
          {messages.length === 0 ? (
            <div id="empty-state" className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto opacity-80">
              <div id="empty-decor-badge" className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 border border-cyan-500/20 mb-4 animate-pulse">
                <Sparkles className="w-6 h-6" />
              </div>
              <h5 className={`font-black text-sm tracking-tight ${isDarkMode ? "text-white" : "text-slate-700"}`}>Private Pairing Active</h5>
              <p className={`text-xs mt-1 leading-relaxed ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                Your 1-to-1 secure chat room is active. All messages and files are transmitted directly in real-time and vanish when the session is closed.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderId === sessionId;
              return (
                <div
                  id={`msg-row-${msg.id}`}
                  key={msg.id}
                  className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${isMe ? "ml-auto items-end" : "mr-auto items-start"} group/msg relative`}
                >
                  {/* Sender Name label */}
                  {!isMe && (
                    <span id="sender-label" className="text-[10px] text-slate-400 font-bold mb-1 ml-2 uppercase tracking-wider">
                      {msg.senderName}
                    </span>
                  )}

                  {/* Message Bubble container */}
                  <div id="msg-bubble-wrapper" className="flex items-end gap-2 relative">
                    {/* Hover tools (left side for mine, right side for peer) */}
                    {isMe && (
                      <div id="msg-hover-actions" className="flex items-center gap-1 opacity-0 group-hover\/msg:opacity-100 transition-opacity absolute -left-16 top-1/2 -translate-y-1/2 select-none z-10">
                        <button
                          id={`btn-copy-${msg.id}`}
                          onClick={() => handleCopyText(msg.text || msg.file?.name || "", msg.id)}
                          className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-cyan-500 hover:text-black hover:border-cyan-400 text-slate-300 cursor-pointer transition-all duration-150"
                          title="Copy message"
                        >
                          {copiedMessageId === msg.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          id={`btn-delete-${msg.id}`}
                          onClick={() => onDeleteMessage(msg.id)}
                          className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500 hover:text-white hover:border-rose-400 text-rose-400 cursor-pointer transition-all duration-150"
                          title="Delete message"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Standard Text or File Bubble */}
                    <div
                      id="bubble"
                      className={`rounded-2xl p-3.5 text-sm shadow-sm transition-all duration-150 text-left ${isMe
                          ? isDarkMode
                            ? "bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white rounded-br-none shadow-cyan-500/5"
                            : "bg-indigo-600 text-white rounded-br-none shadow-indigo-200"
                          : isDarkMode
                            ? "bg-white/5 text-slate-100 rounded-bl-none border border-white/5"
                            : "bg-slate-100 text-slate-800 rounded-bl-none border border-slate-200/50"
                        }`}
                    >
                      {/* File Rendering */}
                      {msg.file && (
                        <FileAttachmentView
                          file={msg.file}
                          isMe={isMe}
                          onSetLightbox={(url, name) => setLightboxImage({ url, name })}
                        />
                      )}

                      {/* Text content rendering */}
                      {msg.text && (
                        <p id="message-text" className="whitespace-pre-wrap break-words leading-relaxed select-text font-medium text-slate-100">
                          {msg.text}
                        </p>
                      )}

                      {/* Bubble Timestamp and receipts indicators */}
                      <div id="bubble-meta" className="flex items-center justify-end gap-1.5 mt-1.5 opacity-70 select-none">
                        <span className="text-[9px] font-bold font-mono">
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {isMe && (
                          <div id="receipt-ticks">
                            {peerOnline ? (
                              <CheckCheck className="w-3 h-3 text-cyan-200" title="Delivered to peer" />
                            ) : (
                              <Check className="w-3 h-3 text-cyan-300" title="Sent successfully" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Peer message tools */}
                    {!isMe && (
                      <div id="peer-msg-hover-actions" className="flex items-center gap-1 opacity-0 group-hover\/msg:opacity-100 transition-opacity absolute -right-16 top-1/2 -translate-y-1/2 select-none z-10">
                        <button
                          id={`btn-copy-${msg.id}`}
                          onClick={() => handleCopyText(msg.text || msg.file?.name || "", msg.id)}
                          className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-cyan-500 hover:text-black hover:border-cyan-400 text-slate-300 cursor-pointer transition-all duration-150"
                          title="Copy message"
                        >
                          {copiedMessageId === msg.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          id={`btn-delete-${msg.id}`}
                          onClick={() => onDeleteMessage(msg.id)}
                          className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500 hover:text-white hover:border-rose-400 text-rose-400 cursor-pointer transition-all duration-150"
                          title="Delete locally"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Typing indicator bubble */}
          {peerTyping && (
            <div id="peer-typing-indicator" className="flex flex-col items-start max-w-[80%] mr-auto">
              <span id="typing-label" className="text-[10px] text-slate-400 font-bold mb-1 ml-2 uppercase tracking-wider">
                {typingNames.length > 1
                  ? `${typingNames.join(", ")} are typing`
                  : `${typingNames[0] || activePeer.name} is typing`
                }
              </span>
              <div
                id="typing-bubble"
                className={`rounded-2xl px-4 py-3 border rounded-bl-none flex items-center gap-1.5 ${isDarkMode
                    ? "bg-white/5 border-white/5 text-slate-100"
                    : "bg-slate-100 border-slate-200/50 text-slate-800"
                  }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce"></span>
              </div>
            </div>
          )}

          <div id="anchor-ref" ref={messagesEndRef} />
        </div>

        {/* Upload error strip */}
        {uploadError && (
          <div id="upload-error-strip" className="mx-4 md:mx-6 p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs flex items-center justify-between">
            <span>{uploadError}</span>
            <button id="btn-close-error" onClick={() => setUploadError(null)} className="p-1 hover:text-white cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Attachment Queue Previews (before sending) */}
        {attachments.length > 0 && (
          <div id="attachment-previews-container" className={`mx-4 md:mx-6 p-3 rounded-2xl border flex flex-wrap gap-2.5 items-center justify-start ${isDarkMode ? "bg-[#0E0E12] border-white/5" : "bg-slate-50 border-slate-200"
            }`}>
            {attachments.map((att, idx) => (
              <div id={`att-preview-${idx}`} key={idx} className="relative group/att w-16 h-16 rounded-xl border border-white/10 bg-slate-950 flex items-center justify-center p-1 overflow-hidden">
                {att.isImage ? (
                  <img id={`att-preview-img-${idx}`} src={att.previewUrl} alt={att.file.name} className="w-full h-full object-cover rounded-lg" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-center">
                    {getFileIcon(att.file.type)}
                    <span className="text-[8px] truncate max-w-[50px] mt-1 text-slate-400 font-semibold">{att.file.name}</span>
                  </div>
                )}
                <button
                  id={`btn-remove-att-${idx}`}
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-rose-500 text-white shadow hover:scale-105 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              id="btn-add-more-att"
              type="button"
              onClick={triggerFileSelect}
              className={`w-16 h-16 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-all ${isDarkMode
                  ? "border-white/10 hover:border-cyan-500 text-slate-400 hover:text-cyan-400 bg-white/5"
                  : "border-slate-300 hover:border-indigo-600 text-slate-50 hover:text-indigo-600"
                }`}
            >
              <Paperclip className="w-4 h-4" />
              <span className="text-[8px] font-bold uppercase tracking-wider">Add</span>
            </button>
          </div>
        )}

        {/* Chat Input Footer */}
        <footer
          id="chat-footer"
          className={`px-3 md:px-6 py-3.5 md:py-4 border-t relative ${isDarkMode ? "border-white/5 bg-[#0E0E12]/80" : "border-slate-200/60 bg-white/40"
            }`}
        >
          {/* Emoji custom board overlay with backdrop click-outside */}
          {showEmojiPicker && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowEmojiPicker(false)} />
              <div
                id="emoji-picker-popup"
                className={`absolute bottom-full left-3 mb-3 p-3.5 rounded-2xl shadow-xl border grid grid-cols-8 gap-2 z-30 transition-all ${isDarkMode ? "bg-[#16161A] border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]" : "bg-white border-slate-200 shadow-slate-200/50"
                  }`}
              >
                {defaultEmojis.map((emoji) => (
                  <button
                    id={`btn-emoji-${emoji}`}
                    key={emoji}
                    type="button"
                    onClick={() => {
                      handleAddEmoji(emoji);
                      // Don't auto-close so they can type multiple emojis
                    }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-lg hover:bg-cyan-500/10 cursor-pointer hover:scale-110 active:scale-95 transition-all"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}

          <form id="chat-input-form" onSubmit={handleSendMessage} className="flex items-center gap-2 md:gap-3">
            {/* Attachment Actions */}
            <input
              id="hidden-file-input"
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
            />

            {/* Plus Menu Toggle Button */}
            <div className="relative">
              <button
                id="btn-plus-menu"
                type="button"
                onClick={() => setShowPlusMenu((prev) => !prev)}
                className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center justify-center ${showPlusMenu
                    ? "border-cyan-500 text-cyan-400 bg-cyan-500/10"
                    : isDarkMode
                      ? "border-white/10 hover:border-cyan-500/30 hover:text-cyan-400 bg-white/5 text-slate-300"
                      : "border-slate-200 hover:border-indigo-600 hover:text-indigo-600 bg-slate-50 text-slate-600"
                  }`}
                title="More options"
              >
                <Plus className={`w-4 h-4 md:w-5 md:h-5 transition-transform duration-200 ${showPlusMenu ? "rotate-45" : ""}`} />
              </button>

              {/* Plus options dropdown menu */}
              {showPlusMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowPlusMenu(false)} />
                  <div
                    id="plus-menu-dropdown"
                    className={`absolute bottom-full left-0 mb-3 p-1.5 rounded-2xl shadow-xl border w-40 z-30 transition-all ${isDarkMode
                        ? "bg-[#16161A] border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
                        : "bg-white border-slate-200 shadow-slate-200/50"
                      }`}
                  >
                    <button
                      id="btn-attach"
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        triggerFileSelect();
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all text-left ${isDarkMode
                          ? "hover:bg-white/5 text-slate-200 hover:text-cyan-400"
                          : "hover:bg-slate-100 text-slate-700 hover:text-indigo-600"
                        }`}
                    >
                      <Paperclip className="w-4 h-4 text-cyan-400" />
                      <span>Attach File</span>
                    </button>

                    <button
                      id="btn-emoji-toggle"
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        setShowEmojiPicker(true);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all text-left ${isDarkMode
                          ? "hover:bg-white/5 text-slate-200 hover:text-cyan-400"
                          : "hover:bg-slate-100 text-slate-700 hover:text-indigo-600"
                        }`}
                    >
                      <Smile className="w-4 h-4 text-amber-400" />
                      <span>Insert Emoji</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Main input textbox */}
            <input
              id="chat-message-textbox"
              type="text"
              placeholder={isUploading ? "Uploading shared files..." : "Type a message..."}
              value={inputText}
              onChange={handleInputChange}
              disabled={isUploading}
              className={`flex-1 min-w-0 py-2.5 md:py-3 px-3 md:px-4 rounded-xl outline-none border transition-all text-xs md:text-sm ${isDarkMode
                  ? "bg-slate-950/80 border-white/5 text-slate-100 placeholder-slate-600 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                  : "bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                }`}
            />

            {/* Submit Button */}
            <button
              id="btn-submit-message"
              type="submit"
              disabled={isUploading || (!inputText.trim() && attachments.length === 0)}
              className="p-2.5 md:p-3 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 text-white transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/15"
            >
              <Send className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          </form>
        </footer>
      </div>

      {/* Side collapsible info panel */}
      {sidebarOpen && (
        <aside
          id="chat-sidebar"
          className={`w-72 border-l p-5 flex flex-col justify-between transition-all duration-300 h-full overflow-y-auto absolute right-0 top-0 bottom-0 z-30 md:relative shadow-2xl md:shadow-none ${isDarkMode ? "border-white/5 bg-[#0E0E12]/95 backdrop-blur-md" : "border-slate-200 bg-white/95 backdrop-blur-md"
            }`}
        >
          <div id="sidebar-top" className="space-y-6">
            {/* Header / Dismiss */}
            <div id="sidebar-header" className="flex items-center justify-between pb-3 border-b border-white/5">
              <h4 className={`font-black text-xs uppercase tracking-widest ${isDarkMode ? "text-white" : "text-slate-800"}`}>
                Session Details
              </h4>
              <button
                id="btn-dismiss-sidebar"
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded-lg hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Connection Status bar */}
            <div id="conn-health-box" className={`p-4 rounded-2xl border flex flex-col text-left ${isDarkMode ? "bg-white/5 border-white/5" : "bg-slate-50 border-slate-200"
              }`}>
              <div id="conn-state" className="flex items-center gap-2 mb-2">
                <Wifi className="w-4 h-4 text-cyan-400" />
                <span className={`text-xs font-black uppercase tracking-wider ${isDarkMode ? "text-white" : "text-slate-700"}`}>
                  P2P Secure Link
                </span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed font-mono font-bold">
                ROOM_ID: {roomId.replace("room-", "").substring(0, 15)}
              </p>
            </div>

            {/* Participant Profiles list */}
            <div id="participants-panel" className="space-y-3">
              <h5 className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                Members ({peers.length + 1})
              </h5>

              {/* My row */}
              <div id="profile-row-me" className="flex items-center gap-3">
                <div
                  id="my-mini-avatar"
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs text-white font-bold bg-gradient-to-br shadow-sm ${getAvatarGradient(
                    avatarSeed
                  )}`}
                >
                  {getInitials(sessionName)}
                </div>
                <div id="my-profile-labels" className="text-left min-w-0 flex-1">
                  <h6 className={`text-xs font-bold truncate ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                    {sessionName} (You)
                  </h6>
                  <p className="text-[9px] font-semibold text-cyan-400 uppercase tracking-wider">Active</p>
                </div>
              </div>

              {/* Peers rows */}
              {peers.map((p) => (
                <div id={`profile-row-${p.id}`} key={p.id} className="flex items-center gap-3 animate-fade-in">
                  <div
                    id={`avatar-${p.id}`}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs text-white font-bold bg-gradient-to-br shadow-sm ${getAvatarGradient(
                      p.avatarSeed
                    )}`}
                  >
                    {getInitials(p.name)}
                  </div>
                  <div id={`labels-${p.id}`} className="text-left min-w-0 flex-1">
                    <h6 className={`text-xs font-bold truncate ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                      {p.name}
                    </h6>
                    <p className={`text-[9px] font-bold uppercase tracking-wider ${p.online ? "text-emerald-400" : "text-rose-400"}`}>
                      {p.online ? "Online" : "Offline"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Secure Ephemeral Warning details */}
          <div id="sidebar-bottom" className="space-y-4 pt-4 border-t border-white/5 text-left">
            <div id="info-tip-box" className="flex gap-2 text-[11px] text-slate-400 leading-relaxed">
              <Info className="w-4 h-4 text-cyan-400 shrink-0" />
              <p>
                This conversation is fully ephemeral. Once either party disconnects, all messages and media files are cleared permanently from memory.
              </p>
            </div>
            <p className="text-[9px] text-slate-500 text-center font-mono select-none font-bold">
              MAX SIZE: 15MB
            </p>
          </div>
        </aside>
      )}

      {/* Fullscreen Lightbox Preview Overlay */}
      {lightboxImage && (
        <Lightbox
          imageUrl={lightboxImage.url}
          imageName={lightboxImage.name}
          onClose={() => setLightboxImage(null)}
        />
      )}

      {/* Add Member Modal (Simple 6-Digit Code) */}
      {showAddMember && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-[380px] animate-scale-up">
            <button
              onClick={() => {
                if (peers.length === 0) {
                  onLeaveRoom();
                } else {
                  setShowAddMember(false);
                }
              }}
              className="absolute top-6 right-6 p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer z-50"
            >
              <X className="w-5 h-5" />
            </button>
            {inviteCode ? (
              <QrGenerator
                sessionId={inviteCode}
                sessionName={sessionName}
                avatarSeed={avatarSeed}
                isDarkMode={isDarkMode}
                simple={false}
              />
            ) : (
              <div className={`flex items-center justify-center p-8 rounded-3xl min-h-[300px] border ${
                isDarkMode ? "bg-[#16161A] border-white/5" : "bg-white border-slate-200"
              }`}>
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Join Chat Modal (Simple Code Entry) */}
      {showJoinChat && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-sm animate-scale-up">
            <div
              className={`relative w-full rounded-3xl p-6 transition-all duration-300 shadow-2xl border ${isDarkMode
                  ? "bg-sleek-card border-white/5 shadow-cyan-500/5 text-white"
                  : "bg-white border-slate-200 shadow-slate-200/50 text-slate-800"
                }`}
            >
              <button
                onClick={() => setShowJoinChat(false)}
                className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center mb-6">
                <h3 className="text-lg font-black tracking-tight">Join Chat</h3>
                <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"} mt-1`}>
                  Enter the 6-digit invite code to connect instantly.
                </p>
              </div>

              {joinError && (
                <div className="mb-4 p-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs flex items-center gap-1.5 justify-center">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{joinError}</span>
                </div>
              )}

              <form onSubmit={handleJoinWithCode} className="space-y-4">
                <input
                  type="text"
                  maxLength={7}
                  placeholder="000 000"
                  value={joinCodeInput}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9\s-]/g, "");
                    setJoinCodeInput(val);
                  }}
                  disabled={joining}
                  className={`w-full py-3 px-4 rounded-xl text-center text-xl font-bold font-mono tracking-widest outline-none border transition-all ${isDarkMode
                      ? "bg-slate-950/80 border-white/10 text-slate-100 placeholder-slate-800 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                      : "bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    }`}
                />

                <button
                  type="submit"
                  disabled={joining || !joinCodeInput.trim()}
                  className={`w-full py-3 px-4 rounded-xl font-bold transition-all duration-200 cursor-pointer text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${isDarkMode
                      ? "bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-lg shadow-cyan-500/15"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/15"
                    }`}
                >
                  {joining ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    "Join Chat"
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

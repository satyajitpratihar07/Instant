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
  Loader2,
  WifiOff,
  Link,
  Bot,
  Settings,
  Reply,
  Bell,
  Keyboard
} from "lucide-react";
import { Message, Peer, PendingFile, JoinRequest } from "../types";
import { formatBytes, getAvatarGradient, getInitials, MAX_FILE_SIZE_BYTES, playNotificationSound } from "../utils";
import Lightbox from "./Lightbox";
import QrGenerator from "./QrGenerator";
import QrScanner from "./QrScanner";
import { db } from "../firebase";
import { ref as dbRef, set, get, remove, onDisconnect } from "firebase/database";
import { AlertCircle, Clock } from "lucide-react";
import { createPortal } from "react-dom";

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

const getReplyAttachmentLabel = (fileType?: string, fileName?: string) => {
  if (!fileType) return null;
  if (fileType.startsWith("image/")) {
    return { icon: <Image className="w-3.5 h-3.5 text-cyan-400 shrink-0 inline-block mr-1" />, label: "Photo" };
  }
  if (fileType.startsWith("video/")) {
    return { icon: <Video className="w-3.5 h-3.5 text-amber-400 shrink-0 inline-block mr-1" />, label: "Video" };
  }
  if (fileType.startsWith("audio/")) {
    return { icon: <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 inline-block mr-1" />, label: "Audio" };
  }
  return { icon: <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0 inline-block mr-1" />, label: fileName || "Document" };
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
  roomId: string;
  msgTimestamp: number;
}

interface FileDeleteTimerProps {
  msgTimestamp: number;
  fileId: string;
  roomId: string;
  isMe: boolean;
  msgId: string;
}

function FileDeleteTimer({ msgTimestamp, fileId, roomId, isMe, msgId }: FileDeleteTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    const expiresAt = msgTimestamp + 5 * 60 * 1000;
    return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  });

  useEffect(() => {
    if (timeLeft <= 0) {
      remove(dbRef(db, `files/${roomId}/${fileId}`)).catch((err) => {
        console.error("Auto delete file failed:", err);
      });
      remove(dbRef(db, `rooms/${roomId}/messages/${msgId}`)).catch((err) => {
        console.error("Auto delete message failed:", err);
      });
      return;
    }

    const timer = setInterval(() => {
      const expiresAt = msgTimestamp + 5 * 60 * 1000;
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      
      if (remaining <= 0) {
        clearInterval(timer);
        remove(dbRef(db, `files/${roomId}/${fileId}`)).catch((err) => {
          console.error("Auto delete file failed:", err);
        });
        remove(dbRef(db, `rooms/${roomId}/messages/${msgId}`)).catch((err) => {
          console.error("Auto delete message failed:", err);
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [msgTimestamp, fileId, roomId, msgId, timeLeft]);

  if (timeLeft <= 0) {
    return null;
  }

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <span
      className="text-[10px] text-cyan-400 font-bold ml-1.5 font-mono flex items-center gap-1 bg-cyan-500/10 px-1.5 py-0.5 rounded-md border border-cyan-500/20 shadow-sm shrink-0 select-none"
      title="Time remaining before file is auto-deleted from database"
    >
      <Clock className="w-3 h-3 text-cyan-400 animate-pulse" />
      {timeString}
    </span>
  );
}

// Helper to convert Blob to Base64 using FileReader (async)
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string || "";
      const base64 = result.includes(",") ? result.split(",")[1] : "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Helper to convert Base64 back to Blob
const base64ToBlob = async (base64: string, mimeType: string): Promise<Blob> => {
  const res = await fetch(`data:${mimeType};base64,${base64}`);
  return res.blob();
};

// Helper to compress Blob using native GZIP stream
const compressBlob = async (blob: Blob): Promise<Blob> => {
  if (typeof CompressionStream === "undefined") return blob;
  try {
    const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).blob();
  } catch (e) {
    console.warn("Gzip compression failed, falling back to uncompressed blob:", e);
    return blob;
  }
};

// Helper to decompress Blob using native GZIP stream
const decompressBlob = async (blob: Blob): Promise<Blob> => {
  if (typeof DecompressionStream === "undefined") return blob;
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).blob();
  } catch (e) {
    console.warn("Gzip decompression failed, falling back to uncompressed blob:", e);
    return blob;
  }
};

function FileAttachmentView({ file, isMe, onSetLightbox, roomId, msgTimestamp }: FileAttachmentViewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [fileSizeString, setFileSizeString] = useState<string>(formatBytes(file.size));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number } | null>(null);
  const [isExpired, setIsExpired] = useState(() => {
    const expiresAt = msgTimestamp + 5 * 60 * 1000;
    return Date.now() > expiresAt;
  });

  useEffect(() => {
    if (isExpired) {
      setLoading(false);
      return;
    }

    const checkTimer = setInterval(() => {
      const expiresAt = msgTimestamp + 5 * 60 * 1000;
      if (Date.now() > expiresAt) {
        setIsExpired(true);
        setLoading(false);
        clearInterval(checkTimer);
      }
    }, 1000);

    return () => clearInterval(checkTimer);
  }, [msgTimestamp, isExpired]);

  useEffect(() => {
    if (isExpired) return;
    let active = true;
    const fetchFile = async () => {
      try {
        // 1. Try chunked format first
        const metaSnap = await get(dbRef(db, `files/${roomId}/${file.id}/meta`));
        if (metaSnap.exists()) {
          const meta = metaSnap.val();
          const totalChunks = meta.totalChunks || 1;
          const chunks: string[] = [];

          if (active && meta.compressedSize) {
            const savings = Math.round((1 - (meta.compressedSize / file.size)) * 100);
            setFileSizeString(`${formatBytes(file.size)} (Compressed: ${formatBytes(meta.compressedSize)} - Saved ${savings > 0 ? savings : 0}%)`);
          }

          for (let i = 0; i < totalChunks; i++) {
            if (!active) return;
            setDownloadProgress({ current: i + 1, total: totalChunks });
            const chunkSnap = await get(dbRef(db, `files/${roomId}/${file.id}/chunks/${i}`));
            if (chunkSnap.exists()) {
              chunks.push(chunkSnap.val().data || "");
            } else {
              if (meta.status === "uploading") {
                // Wait and retry once
                await new Promise((resolve) => setTimeout(resolve, 1200));
                const retrySnap = await get(dbRef(db, `files/${roomId}/${file.id}/chunks/${i}`));
                if (retrySnap.exists()) {
                  chunks.push(retrySnap.val().data || "");
                  continue;
                }
              }
              throw new Error(`Missing chunk ${i}`);
            }
          }
          if (active) {
            const base64Data = chunks.join("");
            let fileBlob: Blob;
            if (meta.isCompressed) {
              const compressedBlob = await base64ToBlob(base64Data, "application/gzip");
              fileBlob = await decompressBlob(compressedBlob);
            } else {
              fileBlob = await base64ToBlob(base64Data, file.type);
            }
            const objUrl = URL.createObjectURL(fileBlob);
            setDataUrl(objUrl);
          }
        } else {
          // 2. Fallback to old single-blob format for compatibility
          const oldSnap = await get(dbRef(db, `files/${roomId}/${file.id}`));
          if (oldSnap.exists() && active) {
            const val = oldSnap.val();
            if (val.data !== undefined) {
              const fileBlob = await base64ToBlob(val.data, file.type);
              const objUrl = URL.createObjectURL(fileBlob);
              setDataUrl(objUrl);
            } else {
              setError("Invalid file structure");
            }
          } else if (active) {
            setError("File not found");
          }
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
  }, [file.id, roomId, file.size, file.type, isExpired]);

  useEffect(() => {
    return () => {
      if (dataUrl && dataUrl.startsWith("blob:")) {
        URL.revokeObjectURL(dataUrl);
      }
    };
  }, [dataUrl]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 border border-white/5 bg-[#0E0E12]/20 rounded-xl max-w-xs text-xs text-slate-400 font-mono animate-pulse">
        <div className="w-3.5 h-3.5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mr-2"></div>
        {downloadProgress
          ? `Downloading (${Math.round((downloadProgress.current / downloadProgress.total) * 100)}%)...`
          : "Decrypting attachment..."
        }
      </div>
    );
  }

  if (isExpired) {
    return null;
  }

  if (error || dataUrl === null) {
    return (
      <div className="flex items-center p-3 border border-red-500/20 bg-red-500/5 text-red-400 rounded-xl max-w-xs text-xs font-semibold">
        <AlertCircle className="w-4 h-4 mr-2" />
        Failed to decrypt file
      </div>
    );
  }
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
          {fileSizeString}
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

function renderBotMessage(text: string) {
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    // Parse links: [Title](URL)
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }
      parts.push(
        <a
          key={match.index}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300 hover:underline font-bold break-all"
        >
          {match[1]}
        </a>
      );
      lastIndex = linkRegex.lastIndex;
    }
    if (lastIndex < line.length) {
      parts.push(line.substring(lastIndex));
    }

    // Parse bold: **text**
    const parsedLine = parts.map((part) => {
      if (typeof part !== 'string') return part;
      const boldRegex = /\*\*([^*]+)\*\*/g;
      const subParts = [];
      let subLastIndex = 0;
      let subMatch;
      while ((subMatch = boldRegex.exec(part)) !== null) {
        if (subMatch.index > subLastIndex) {
          subParts.push(part.substring(subLastIndex, subMatch.index));
        }
        subParts.push(<strong key={subMatch.index} className="font-extrabold text-white">{subMatch[1]}</strong>);
        subLastIndex = boldRegex.lastIndex;
      }
      if (subLastIndex < part.length) {
        subParts.push(part.substring(subLastIndex));
      }
      return subParts;
    });

    return (
      <p key={idx} className="mb-2 leading-relaxed text-xs">
        {parsedLine}
      </p>
    );
  });
}
interface UploadingMessage {
  id: string;
  senderId: string;
  senderName: string;
  timestamp: number;
  fileName: string;
  fileSize: number;
  fileType: string;
  progress: number;
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
  onSendMessage: (text: string, fileId?: string, fileMeta?: any, replyTo?: Message["replyTo"]) => void;
  onSendKnock?: () => void;
  onDeleteMessage: (messageId: string) => void;
  onSetTyping?: (isTyping: boolean) => void;
  onLeaveRoom: () => void;
  onScanSuccess?: (targetId: string) => void;
  onRespondJoinRequest?: (req: JoinRequest, accept: boolean) => void;
  isDarkMode: boolean;
  autoShowInvite?: boolean;
  keepAlive3h?: boolean;
  onToggleKeepAlive?: () => void;
  knockVolume: number;
  onChangeKnockVolume: (volume: number) => void;
  isHost?: boolean;
  roomExpiresAt: number;
  isKeyboardLocked?: boolean;
  onKeyboardLockChange?: (locked: boolean) => void;
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
  onSendKnock,
  onDeleteMessage,
  onSetTyping,
  onLeaveRoom,
  onScanSuccess,
  onRespondJoinRequest,
  isDarkMode,
  autoShowInvite,
  keepAlive3h = false,
  onToggleKeepAlive,
  knockVolume,
  onChangeKnockVolume,
  isHost = false,
  roomExpiresAt,
  isKeyboardLocked: isKeyboardLockedProp = false,
  onKeyboardLockChange,
}: ChatRoomProps) {
  const activePeer = peers[0] || peer || { id: "awaiting", name: "Awaiting...", avatarSeed: "default", online: false };
  const [inputText, setInputText] = useState("");
  const [lastPeerOnlineTime, setLastPeerOnlineTime] = useState<number>(() => peerOnline ? Date.now() : 0);

  useEffect(() => {
    if (peerOnline) {
      setLastPeerOnlineTime(Date.now());
    }
  }, [peerOnline, messages]);
  
  // 3-hour room expiration countdown
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    return Math.max(0, Math.floor((roomExpiresAt - Date.now()) / 1000));
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.floor((roomExpiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        // Expiry cleanup: Delete room and files
        remove(dbRef(db, `rooms/${roomId}`)).catch(err => console.error("Expiry cleanup room failed:", err));
        remove(dbRef(db, `files/${roomId}`)).catch(err => console.error("Expiry cleanup files failed:", err));
        onLeaveRoom();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [roomExpiresAt, roomId, onLeaveRoom]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const isTimeLow = timeLeft < 15 * 60; // < 15 minutes remaining
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  // isKeyboardLocked is controlled from App.tsx so it can freeze viewport height
  const isKeyboardLocked = isKeyboardLockedProp;
  const setIsKeyboardLocked = (val: boolean) => onKeyboardLockChange?.(val);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showAddMember, setShowAddMember] = useState(autoShowInvite || false);
  const [showJoinChat, setShowJoinChat] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const threeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const exportToPdf = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to export the chat.");
      return;
    }

    const messagesHtml = messages.map((msg) => {
      const isMe = msg.senderId === sessionId;
      const bubbleClass = isMe
        ? "bg-amber-100 border border-amber-200 text-slate-900"
        : "bg-emerald-100 border border-emerald-200 text-slate-900";
      const senderName = isMe ? `${msg.senderName} (You)` : msg.senderName;

      const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      return `
        <div class="message-row" style="display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 6px;">
          <div class="sender-name" style="font-size: 9px; color: #64748b; font-weight: bold; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${senderName}
          </div>
          <div class="message-bubble ${bubbleClass}" style="padding: 6px 10px; border-radius: 8px; font-size: 11px; max-width: 70%; min-width: 80px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 3px;">
            <div class="message-text" style="word-break: break-word; white-space: pre-wrap;">${msg.text || ""}</div>
            ${msg.file ? `<div style="font-size: 9px; color: #0284c7; font-weight: bold; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 2px; margin-top: 2px;">📁 ${msg.file.name}</div>` : ""}
            <div class="message-time" style="font-size: 8px; color: #94a3b8; align-self: flex-end; font-family: monospace;">${timeStr}</div>
          </div>
        </div>
      `;
    }).join("");

    const pageHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Instant Chat Transcript</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f8fafc;
            color: #334155;
          }
          .header {
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 8px;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .title-area h1 {
            font-size: 18px;
            font-weight: 900;
            margin: 0;
            color: #0f172a;
            letter-spacing: -0.5px;
          }
          .title-area p {
            font-size: 10px;
            color: #64748b;
            margin: 1px 0 0 0;
            font-weight: 500;
          }
          .meta-area {
            font-size: 9px;
            color: #94a3b8;
            text-align: right;
            font-family: monospace;
            line-height: 1.3;
          }
          .chat-feed {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .bg-amber-100 { background-color: #fef3c7; }
          .border-amber-200 { border-color: #fde68a; }
          .bg-emerald-100 { background-color: #d1fae5; }
          .border-emerald-200 { border-color: #a7f3d0; }
          
          /* Copy button header section */
          .toolbar {
            margin-bottom: 12px;
            text-align: left;
            display: flex;
            gap: 10px;
          }
          .btn-copy {
            background-color: #0ea5e9;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            font-size: 11px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            transition: all 0.2s;
          }
          .btn-copy:hover {
            background-color: #0284c7;
          }

          @media print {
            body { padding: 10px; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="toolbar no-print">
          <button class="btn-copy" onclick="copyChatToClipboard()">
            📋 Copy Entire Chat Text
          </button>
        </div>

        <div class="header">
          <div class="title-area">
            <h1>InstantE2E Secure Transcript</h1>
            <p>End-to-End Encrypted Temporary Session</p>
          </div>
          <div class="meta-area">
            Exported: ${new Date().toLocaleString()}<br>
            Room ID: ${roomId}
          </div>
        </div>
        <div class="chat-feed">
          ${messagesHtml || '<div style="text-align: center; color: #64748b; font-size: 13px; margin-top: 30px; font-weight: 500;">No messages in this chat.</div>'}
        </div>

        <script>
          function copyChatToClipboard() {
            const rows = Array.from(document.querySelectorAll('.message-row'));
            if (rows.length === 0) {
              alert('No messages to copy.');
              return;
            }
            const chatText = rows.map(row => {
              const sender = row.querySelector('.sender-name').innerText.trim();
              const textElement = row.querySelector('.message-text');
              const text = textElement ? textElement.innerText.trim() : '';
              const time = row.querySelector('.message-time').innerText.trim();
              return '[' + time + '] ' + sender + ': ' + text;
            }).join('\\n');
            
            navigator.clipboard.writeText(chatText).then(() => {
              alert('Chat transcript copied to clipboard!');
            }).catch(err => {
              console.error('Failed to copy: ', err);
            });
          }
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(pageHtml);
    printWindow.document.close();
  };

  // --- 3D Background Galaxy Animation Hook ---
  useEffect(() => {
    const canvas = threeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    const dpr = window.devicePixelRatio || 1;
    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    // Create 3D Spiral Galaxy particles
    const particleCount = 300;
    const particles: Array<{ x: number; y: number; z: number; color: string; size: number }> = [];
    const arms = 3;
    const galaxyRadius = 380;

    for (let i = 0; i < particleCount; i++) {
      // Density bias towards the center (nucleus)
      const r = Math.pow(Math.random(), 2.8) * galaxyRadius;

      // Distribute stars along the spiral arms
      const armIndex = i % arms;
      const armAngle = (armIndex * 2 * Math.PI) / arms;

      // Twist factor to bend arms into spirals
      const spiralFactor = 2.0;
      const theta = (r / galaxyRadius) * spiralFactor * Math.PI + armAngle;

      // Random dispersion around the arms
      const dispersion = (Math.random() - 0.5) * (45 - (r / galaxyRadius) * 20);
      const x = Math.cos(theta) * r + (Math.random() - 0.5) * dispersion;
      const z = Math.sin(theta) * r + (Math.random() - 0.5) * dispersion;

      // Height thickness (bulges in center, flattens out)
      const y = (Math.random() - 0.5) * (35 * Math.exp(-r / 70));

      // Color scheme: bright gold/white core, cyan and purple arms
      let color = "rgba(6, 182, 212,"; // Cyan
      if (r < 120) {
        color = "rgba(253, 224, 71,"; // Gold nucleus
      } else if (i % 2 === 0) {
        color = "rgba(168, 85, 247,"; // Purple arm star
      }

      particles.push({
        x,
        y,
        z,
        color,
        size: Math.random() * 1.5 + 0.8
      });
    }
    const fov = 350;
    let rotationAngle = 0;
    const tiltX = 60 * Math.PI / 180; // 60 degrees tilt
    const cosX = Math.cos(tiltX);
    const sinX = Math.sin(tiltX);

    const handleResize = () => {
      if (!canvas) return;
      const currentDpr = window.devicePixelRatio || 1;
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width * currentDpr;
      canvas.height = height * currentDpr;
    };
    window.addEventListener("resize", handleResize);

    const render = () => {
      const currentDpr = window.devicePixelRatio || 1;
      ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const halfWidth = width / 2;
      const halfHeight = height / 2;

      // Slowly increment galaxy orbital rotation
      rotationAngle += 0.0015;
      const cosY = Math.cos(rotationAngle);
      const sinY = Math.sin(rotationAngle);

      // Render glowing core nucleus
      const coreScale = fov / (fov + 300);
      const coreRadius = 220 * coreScale;
      const coreGrad = ctx.createRadialGradient(halfWidth, halfHeight, 0, halfWidth, halfHeight, coreRadius);
      coreGrad.addColorStop(0, isDarkMode ? "rgba(253, 224, 71, 0.35)" : "rgba(245, 158, 11, 0.2)");
      coreGrad.addColorStop(0.5, isDarkMode ? "rgba(6, 182, 212, 0.15)" : "rgba(99, 102, 241, 0.08)");
      coreGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(halfWidth, halfHeight, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      // Project and draw stars
      particles.forEach((p) => {
        // 1. Rotate around Y-axis (galaxy rotation)
        const rx = p.x * cosY - p.z * sinY;
        const rz = p.z * cosY + p.x * sinY;
        const ry = p.y;

        // 2. Rotate around X-axis (tilted galaxy plane perspective)
        const xProjected = rx;
        const yProjected = ry * cosX - rz * sinX;
        const zProjected = rz * cosX + ry * sinX;

        // 3. Perspective Projection
        const scale = fov / (fov + zProjected + 300); // 300 is camera view distance
        const sx = xProjected * scale + halfWidth;
        const sy = yProjected * scale + halfHeight;

        if (sx >= 0 && sx <= width && sy >= 0 && sy <= height) {
          const alpha = (1 - zProjected / 600) * (isDarkMode ? 0.35 : 0.18);
          ctx.beginPath();
          ctx.arc(sx, sy, p.size * scale, 0, Math.PI * 2);
          ctx.fillStyle = `${p.color} ${alpha})`;
          ctx.fill();
        }
      });

      // Draw faint connections inside arms for beautiful constellation look
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particleCount; i += 2) {
        for (let j = i + 2; j < Math.min(i + 15, particleCount); j += 2) {
          const p1 = particles[i];
          const p2 = particles[j];
          
          // Only connect if they belong to the same color/arm and are close
          if (p1.color === p2.color) {
            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dz = p1.z - p2.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < 70) {
              // Get current rotated coordinates for projection
              const rx1 = p1.x * cosY - p1.z * sinY;
              const rz1 = p1.z * cosY + p1.x * sinY;
              const yProj1 = p1.y * cosX - rz1 * sinX;
              const zProj1 = rz1 * cosX + p1.y * sinX;

              const rx2 = p2.x * cosY - p2.z * sinY;
              const rz2 = p2.z * cosY + p2.x * sinY;
              const yProj2 = p2.y * cosX - rz2 * sinX;
              const zProj2 = rz2 * cosX + p2.y * sinX;

              const scale1 = fov / (fov + zProj1 + 300);
              const sx1 = rx1 * scale1 + halfWidth;
              const sy1 = yProj1 * scale1 + halfHeight;

              const scale2 = fov / (fov + zProj2 + 300);
              const sx2 = rx2 * scale2 + halfWidth;
              const sy2 = yProj2 * scale2 + halfHeight;

              if (sx1 >= 0 && sx1 <= width && sy1 >= 0 && sy1 <= height &&
                  sx2 >= 0 && sx2 <= width && sy2 >= 0 && sy2 <= height) {
                const alpha = (1 - dist / 70) * (isDarkMode ? 0.08 : 0.04);
                ctx.beginPath();
                ctx.moveTo(sx1, sy1);
                ctx.lineTo(sx2, sy2);
                ctx.strokeStyle = isDarkMode ? `rgba(6, 182, 212, ${alpha})` : `rgba(79, 70, 229, ${alpha})`;
                ctx.stroke();
              }
            }
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [isDarkMode]);

  const handleKickPeer = async (peerId: string, peerName: string) => {
    if (!window.confirm(`Are you sure you want to kick ${peerName} from this chat room?`)) return;
    try {
      await remove(dbRef(db, `rooms/${roomId}/members/${peerId}`));
      await remove(dbRef(db, `rooms/${roomId}/typing/${peerId}`));
    } catch (err) {
      console.error("Failed to kick peer:", err);
    }
  };

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

  // Automatically close invite modal once a new member joins or when a join request is received
  const prevPeersLength = useRef(peers.length);
  useEffect(() => {
    if (peers.length > prevPeersLength.current && peers.length > 0) {
      setShowAddMember(false);
    }
    prevPeersLength.current = peers.length;
  }, [peers]);

  useEffect(() => {
    if (joinRequests && joinRequests.length > 0) {
      setShowAddMember(false);
    }
  }, [joinRequests]);

  const handleCopyCode = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };


  // Default sidebar closed on mobile (less than 768px wide)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingMessage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
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

  useEffect(() => {
    const textarea = chatInputRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [inputText]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
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

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      processSelectedFiles(e.clipboardData.files);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const form = document.getElementById("chat-input-form") as HTMLFormElement;
      if (form) {
        form.requestSubmit();
      }
    }
  };


  // Process the file inputs client-side, read into base64
  const processSelectedFiles = (fileList: FileList) => {
    setUploadError(null);
    const newAttachments: PendingFile[] = [];

    Array.from(fileList).forEach((file) => {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setUploadError(`File "${file.name}" exceeds the ${formatBytes(MAX_FILE_SIZE_BYTES)} size limit.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const resultStr = reader.result as string || "";
        const base64Data = resultStr.includes(",") ? resultStr.split(",")[1] : "";
        const isImage = file.type.startsWith("image/");
        const previewUrl = isImage ? resultStr : "";

        setAttachments((prev) => [
          ...prev,
          {
            file,
            previewUrl,
            base64Data: base64Data || "",
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
      const replyPayload = replyingTo ? {
        id: replyingTo.id,
        senderName: replyingTo.senderName,
        text: replyingTo.text || "",
        ...(replyingTo.file ? {
          fileType: replyingTo.file.type || "",
          fileName: replyingTo.file.name || ""
        } : {})
      } : undefined;

      if (attachments.length > 0) {
        // Upload each attachment in chunks to avoid size limitations in Firebase Realtime Database
        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          const fileId = Math.random().toString(36).substring(2, 15);

          // Add to uploadingFiles list
          const uploadingMsg: UploadingMessage = {
            id: fileId,
            senderId: sessionId,
            senderName: sessionName,
            timestamp: Date.now(),
            fileName: attachment.file.name,
            fileSize: attachment.file.size,
            fileType: attachment.file.type,
            progress: 0,
          };
          setUploadingFiles((prev) => [...prev, uploadingMsg]);

          // Compress raw file to gzip blob
          const compressedBlob = await compressBlob(attachment.file);
          const isCompressed = typeof CompressionStream !== "undefined" && compressedBlob.size < attachment.file.size;
          const finalBlob = isCompressed ? compressedBlob : attachment.file;

          // Convert final compressed blob to base64
          const base64Data = await blobToBase64(finalBlob);
          const CHUNK_SIZE = 1000000; // 1 million chars (~1MB)
          const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE) || 1;

          setUploadProgress({ current: 0, total: totalChunks });

          // 1. Create file meta node
          await set(dbRef(db, `files/${roomId}/${fileId}/meta`), {
            id: fileId,
            name: attachment.file.name,
            type: attachment.file.type,
            size: attachment.file.size,
            compressedSize: finalBlob.size,
            isCompressed,
            totalChunks,
            status: "uploading",
          });

          // 2. Upload chunks sequentially
          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, base64Data.length);
            const chunkData = base64Data.substring(start, end);

            await set(dbRef(db, `files/${roomId}/${fileId}/chunks/${chunkIndex}`), {
              data: chunkData
            });
            const pct = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            setUploadProgress({ current: chunkIndex + 1, total: totalChunks });
            setUploadingFiles((prev) =>
              prev.map((up) => (up.id === fileId ? { ...up, progress: pct } : up))
            );
          }

          // 3. Mark upload as complete
          await set(dbRef(db, `files/${roomId}/${fileId}/meta/status`), "complete");

          // Send message with file metadata attached
          const isLastAndNoText = i === attachments.length - 1 && !inputText.trim();
          onSendMessage("", fileId, {
            name: attachment.file.name,
            type: attachment.file.type,
            size: attachment.file.size,
          }, isLastAndNoText ? replyPayload : undefined);

          // Remove from uploadingFiles list
          setUploadingFiles((prev) => prev.filter((up) => up.id !== fileId));
        }
        setAttachments([]);
        setUploadProgress(null);
      }

      if (inputText.trim()) {
        onSendMessage(inputText.trim(), undefined, undefined, replyPayload);
        setInputText("");
      }

      setReplyingTo(null);
      setShowEmojiPicker(false);
    } catch (err: any) {
      console.error("Error sending message:", err);
      setUploadingFiles([]); // Clear progress icons on failure
      setUploadError(err.message || "Failed to send file attachment. Try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const getMessageLink = (msg: Message): string | null => {
    if (msg.file?.url) {
      return msg.file.url;
    }
    if (msg.text) {
      const match = msg.text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
      if (match) {
        const url = match[0];
        return url.toLowerCase().startsWith("http") ? url : `https://${url}`;
      }
    }
    return null;
  };

  const renderMessageText = (text: string, isMe: boolean) => {
    const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/g);
    return parts.map((part, index) => {
      if (/^(https?:\/\/|www\.)/i.test(part)) {
        const href = part.toLowerCase().startsWith("http") ? part : `https://${part}`;
        return (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline hover:opacity-85 break-all ${isMe
              ? isDarkMode ? "text-amber-200 font-semibold" : "text-indigo-800 font-bold hover:text-indigo-900"
              : isDarkMode ? "text-cyan-400 font-semibold hover:text-cyan-300" : "text-emerald-800 font-semibold hover:text-emerald-950"
              }`}
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const handleCopyLink = (url: string, msgId: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLinkId(msgId);
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const toggleMessageExpansion = (msgId: string) => {
    setExpandedMessages((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
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
      className={`flex h-full flex-1 min-h-0 relative w-full overflow-hidden rounded-t-none rounded-b-3xl md:rounded-[2.5rem] transition-all duration-300 shadow-2xl backdrop-blur-md ${isDarkMode
        ? "bg-[#0E0E12]/80"
        : "bg-white/80"
        }`}
    >
      {isDragging && (
        <div id="drag-overlay" className="absolute inset-0 bg-cyan-500/10 border-4 border-dashed border-cyan-400 z-40 flex flex-col items-center justify-center pointer-events-none animate-pulse">
          <Paperclip className="w-16 h-16 text-cyan-400 mb-3" />
          <h3 className="text-xl font-black text-white">Drop Files Here</h3>
          <p className="text-sm text-cyan-200 mt-1">Share images, PDFs, ZIPs, or other files up to 250MB instantly</p>
        </div>
      )}


      {/* Centered Group Join Requests Dialog Modal */}
      {joinRequests.length > 0 && createPortal(
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
                    className={`px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all cursor-pointer ${isDarkMode ? "bg-white/5 border border-white/10 hover:bg-white/10 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                      }`}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* Main Messaging Interface Area */}
      <div id="chat-messages-area" className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Chat Header */}
        <header
          id="chat-header"
          style={{ paddingTop: typeof window !== 'undefined' && window.innerWidth < 640 ? 'calc(10px + env(safe-area-inset-top))' : undefined }}
          className={`sticky top-0 z-30 flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-4 md:px-6 pb-2.5 sm:py-3 md:py-4 border-b gap-2.5 sm:gap-0 ${isDarkMode ? "border-white/5 bg-[#0E0E12]/90" : "border-slate-200/60 bg-white/60"
            }`}
        >
          <div id="header-left" className="flex items-center gap-3 text-left w-full sm:w-auto min-w-0">
            <div id="peer-avatar-wrapper" className="relative shrink-0">
              <div
                id="peer-avatar"
                className={`w-9 h-9 md:w-10 md:h-10 rounded-2xl flex items-center justify-center text-white font-bold bg-gradient-to-br shadow-md ${getAvatarGradient(
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
            <div id="peer-status-info" className="text-left min-w-0 flex-grow flex items-center justify-between sm:justify-start gap-3">
              <div className="min-w-0">
                <h4 className={`text-xs md:text-sm font-black tracking-tight truncate max-w-[120px] xs:max-w-[180px] sm:max-w-none ${isDarkMode ? "text-white" : "text-slate-800"}`}>
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

              {/* Mobile Room Expiry Timer */}
              <div
                id="room-expiry-timer-mobile"
                className={`flex sm:hidden items-center gap-1 py-1 px-2.5 rounded-2xl border font-bold font-mono text-[9px] select-none transition-all duration-300 shadow-sm shrink-0 ${isTimeLow
                  ? "bg-rose-500/20 border-rose-500/45 text-rose-400 animate-pulse"
                  : isDarkMode
                    ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
                    : "bg-cyan-50 border-cyan-200 text-cyan-700"
                  }`}
                title="Time remaining"
              >
                <Clock className={`w-3.5 h-3.5 ${isTimeLow ? "animate-pulse" : ""}`} />
                <span>{formatTime(timeLeft)}</span>
              </div>
            </div>
          </div>

          <div
            id="header-right"
            className="flex items-center justify-between sm:justify-end gap-1.5 sm:gap-2 w-full sm:w-auto border-t border-white/5 sm:border-t-0 pt-2 sm:pt-0"
          >
            <button
              id="btn-add-member-inline"
              onClick={() => setShowAddMember(true)}
              className={`flex items-center gap-1 py-1.5 px-2 md:px-3 rounded-xl border font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer ${isDarkMode
                ? "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 border-cyan-500/20"
                : "bg-cyan-50 hover:bg-cyan-100 text-cyan-600 border-cyan-200"
                }`}
              title="Add member"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Add Member</span>
            </button>

            <button
              id="btn-join-chat-inline"
              onClick={() => setShowJoinChat(true)}
              className={`flex items-center gap-1 py-1.5 px-2 md:px-3 rounded-xl border font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer ${isDarkMode
                ? "bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border-indigo-500/20"
                : "bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border-indigo-200"
                }`}
              title="Join chat"
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Join Chat</span>
            </button>

            <button
              id="btn-export-pdf"
              onClick={exportToPdf}
              className={`flex items-center gap-1 py-1.5 px-2 md:px-3 rounded-xl border font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer ${isDarkMode
                ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border-amber-500/20"
                : "bg-amber-50 hover:bg-amber-100 text-amber-600 border-amber-200"
                }`}
              title="Export chat as PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">PDF</span>
            </button>

            <button
              id="btn-leave-room"
              onClick={onLeaveRoom}
              className={`flex items-center gap-1 md:gap-1.5 py-1.5 px-2 md:px-3 rounded-xl border font-bold uppercase tracking-wider text-[10px] transition-all cursor-pointer ${isDarkMode
                ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border-rose-500/30"
                : "bg-rose-100 hover:bg-rose-200 text-rose-700 border-rose-300"
                }`}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Disconnect</span>
            </button>

            {/* 3-Hour Room Expiry Reverse Countdown Timer (desktop only) */}
            <div
              id="room-expiry-timer"
              className={`hidden sm:flex items-center gap-1 py-1.5 px-1.5 md:px-2.5 rounded-xl border font-bold font-mono text-[9px] md:text-[10px] select-none transition-all duration-300 shadow-sm shrink-0 ${isTimeLow
                ? "bg-rose-500/20 border-rose-500/45 text-rose-400 animate-pulse"
                : isDarkMode
                  ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
                  : "bg-cyan-50 border-cyan-200 text-cyan-700"
                }`}
              title="Time remaining before this chat room is automatically deleted"
            >
              <Clock className={`w-3.5 h-3.5 ${isTimeLow ? "animate-pulse" : ""}`} />
              <span>{formatTime(timeLeft)}</span>
            </div>

            <button
              id="btn-toggle-sidebar"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className={`p-2 rounded-xl transition-all hover:bg-white/5 cursor-pointer ${isDarkMode ? "text-slate-300" : "text-slate-600 hover:bg-slate-100"
                }`}
              title="Show info panel"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Message Feed Container Wrapper */}
        <div className="flex-1 relative min-h-0">
          {/* Ambient 3D Glow Background Canvas */}
          <canvas
            ref={threeCanvasRef}
            className="absolute inset-0 w-full h-full -z-10 pointer-events-none opacity-85"
          />

          <div id="chat-history-scroll" className="absolute inset-0 overflow-y-auto p-3.5 md:p-6 space-y-3.5 md:space-y-4 bg-transparent">




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
                const isHostMsg = msg.senderName === "Host";
                const bubbleBgClass = isHostMsg
                  ? isDarkMode
                    ? "bg-gradient-to-tr from-slate-900 via-amber-950/40 to-amber-500/10 text-slate-100 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.12)]"
                    : "bg-gradient-to-tr from-amber-50 to-orange-100/50 text-slate-900 border border-amber-400/70 shadow-[0_2px_8px_rgba(245,158,11,0.1)]"
                  : isMe
                    ? isDarkMode
                      ? "bg-gradient-to-tr from-slate-900 to-emerald-950/50 text-slate-100 border border-emerald-500/30"
                      : "bg-gradient-to-tr from-emerald-50 to-teal-100/40 text-slate-800 border border-emerald-200/60"
                    : isDarkMode
                      ? "bg-gradient-to-tr from-slate-900 to-slate-800/80 text-slate-100 border border-white/5"
                      : "bg-gradient-to-tr from-slate-100 to-slate-50 text-slate-850 border border-slate-200";

                return (
                  <div
                    id={`msg-row-${msg.id}`}
                    key={msg.id}
                    className={`flex flex-col max-w-[90%] sm:max-w-[80%] ${isMe ? "ml-auto items-end" : "mr-auto items-start"} group/msg relative`}
                  >
                    {/* Sender Name label */}
                    {!isMe && (
                      <span id="sender-label" className="text-[10px] text-slate-400 font-bold mb-1 ml-2 uppercase tracking-wider flex items-center gap-1.5">
                        {msg.senderName}
                        {isHostMsg && (
                          <span className="px-1.5 py-0.5 text-[8px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-md font-black uppercase tracking-widest">
                            Host
                          </span>
                        )}
                      </span>
                    )}

                    {/* Message Bubble container */}
                    <div id="msg-bubble-wrapper" className={`flex items-center gap-2 relative max-w-full ${isMe ? "flex-row-reverse" : "flex-row"} group/wrapper`}>
                      {/* Standard Text or File Bubble */}
                      <div
                        id="bubble"
                        className={`rounded-2xl p-3.5 text-sm shadow-sm transition-all duration-150 text-left min-w-[160px] max-w-full ${isMe ? "rounded-br-none" : "rounded-bl-none"
                          } ${bubbleBgClass}`}
                      >
                        {/* File Rendering */}
                        {msg.replyTo && (() => {
                          const attachInfo = getReplyAttachmentLabel(msg.replyTo.fileType, msg.replyTo.fileName);
                          return (
                            <div
                              onClick={() => {
                                const el = document.getElementById(`msg-row-${msg.replyTo!.id}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  const bubble = el.querySelector('#bubble') as HTMLElement;
                                  if (bubble) {
                                    bubble.style.transition = 'all 0.3s ease';
                                    bubble.style.transform = 'scale(1.03)';
                                    const origShadow = bubble.style.boxShadow;
                                    bubble.style.boxShadow = isDarkMode
                                      ? '0 0 20px rgba(56, 189, 248, 0.6)'
                                      : '0 0 15px rgba(79, 70, 229, 0.5)';
                                    setTimeout(() => {
                                      bubble.style.transform = 'scale(1)';
                                      bubble.style.boxShadow = origShadow;
                                    }, 1000);
                                  }
                                }
                              }}
                              className={`flex gap-2 mb-2 p-2 rounded-r-lg border-l-4 cursor-pointer hover:opacity-90 transition-all select-none ${isDarkMode
                                ? "border-[#38bdf8] bg-black/25 text-slate-350"
                                : "border-indigo-500 bg-black/5 text-slate-700"
                                }`}
                            >
                              <div className="flex flex-col flex-1 min-w-0 pl-1">
                                <span className={`font-semibold text-xs leading-tight ${isDarkMode ? "text-[#38bdf8]" : "text-indigo-600"}`}>
                                  {msg.replyTo.senderName === sessionName ? "You" : msg.replyTo.senderName}
                                </span>
                                <p className={`text-xs truncate mt-0.5 max-w-[220px] leading-tight flex items-center gap-1 ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>
                                  {attachInfo ? (
                                    <>
                                      {attachInfo.icon}
                                      <span className="font-semibold">{attachInfo.label}</span>
                                    </>
                                  ) : (
                                    msg.replyTo.text
                                  )}
                                </p>
                              </div>
                            </div>
                          );
                        })()}
                        {msg.file && (
                          <FileAttachmentView
                            file={msg.file}
                            isMe={isMe}
                            onSetLightbox={(url, name) => setLightboxImage({ url, name })}
                            roomId={roomId}
                            msgTimestamp={msg.timestamp}
                          />
                        )}

                        {/* Text content rendering */}
                        {msg.text && (
                          <div id="message-text-wrapper">
                            <p id="message-text" className={`whitespace-pre-wrap break-words leading-relaxed select-text font-medium ${isMe
                              ? isDarkMode ? "text-slate-100" : "text-slate-900"
                              : isDarkMode ? "text-slate-100" : "text-slate-900"
                              }`}>
                              {renderMessageText(
                                msg.text.length > 180 && !expandedMessages[msg.id]
                                  ? `${msg.text.slice(0, 180)}...`
                                  : msg.text,
                                isMe
                              )}
                            </p>
                            {msg.text.length > 180 && (
                              <button
                                type="button"
                                onClick={() => toggleMessageExpansion(msg.id)}
                                className={`mt-1.5 text-xs font-bold transition-colors hover:underline cursor-pointer flex items-center gap-0.5 ${isMe
                                  ? isDarkMode ? "text-amber-200 hover:text-white" : "text-orange-850 hover:text-orange-950"
                                  : isDarkMode ? "text-cyan-400 hover:text-cyan-300" : "text-emerald-700 hover:text-emerald-900"
                                  }`}
                              >
                                {expandedMessages[msg.id] ? "Read Less" : "Read More"}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Bubble Actions & Timestamp Meta row */}
                        <div id="bubble-meta" className={`flex items-center justify-between gap-4 mt-2.5 select-none pt-1.5 border-t ${isDarkMode ? "border-white/5" : "border-slate-200/80"
                          }`}>
                          {/* Actions (Copy Text, Copy Link, Delete) */}
                          <div id="bubble-actions" className="flex items-center gap-2 opacity-80">
                            {/* Copy Text */}
                            <button
                              id={`btn-copy-${msg.id}`}
                              onClick={() => handleCopyText(msg.text || msg.file?.name || "", msg.id)}
                              className={`p-1 rounded-md transition-all duration-150 cursor-pointer ${isMe
                                ? isDarkMode
                                  ? "hover:bg-white/10 text-amber-100 hover:text-white"
                                  : "hover:bg-black/5 text-slate-800 hover:text-black"
                                : isDarkMode
                                  ? "hover:bg-white/5 text-emerald-300 hover:text-emerald-100"
                                  : "hover:bg-black/5 text-emerald-800 hover:text-emerald-955"
                                }`}
                              title="Copy text"
                            >
                              {copiedMessageId === msg.id ? (
                                <Check className={`w-4 h-4 ${isDarkMode ? "text-emerald-400" : "text-emerald-700"}`} />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>

                            {/* Copy Link (only if link/file exists) */}
                            {getMessageLink(msg) && (
                              <button
                                id={`btn-copy-link-${msg.id}`}
                                onClick={() => handleCopyLink(getMessageLink(msg)!, msg.id)}
                                className={`p-1 rounded-md transition-all duration-150 cursor-pointer ${isMe
                                  ? isDarkMode
                                    ? "hover:bg-white/10 text-amber-100 hover:text-white"
                                    : "hover:bg-black/5 text-slate-800 hover:text-black"
                                  : isDarkMode
                                    ? "hover:bg-white/5 text-emerald-300 hover:text-emerald-100"
                                    : "hover:bg-black/5 text-emerald-800 hover:text-emerald-955"
                                  }`}
                                title="Copy link"
                              >
                                {copiedLinkId === msg.id ? (
                                  <Check className={`w-4 h-4 ${isDarkMode ? "text-emerald-400" : "text-emerald-700"}`} />
                                ) : (
                                  <Link className="w-4 h-4" />
                                )}
                              </button>
                            )}

                            {/* Delete Button */}
                            <button
                              id={`btn-delete-${msg.id}`}
                              onClick={() => onDeleteMessage(msg.id)}
                              className={`p-1 rounded-md transition-all duration-150 cursor-pointer ${isMe
                                ? isDarkMode
                                  ? "hover:bg-rose-500/20 text-rose-300 hover:text-rose-100"
                                  : "hover:bg-black/5 text-rose-700 hover:text-rose-900"
                                : isDarkMode
                                  ? "hover:bg-rose-500/10 text-rose-400 hover:text-rose-300"
                                  : "hover:bg-rose-50 text-rose-700 hover:text-rose-900"
                                }`}
                              title={isMe ? "Delete message" : "Delete locally"}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>

                            {/* File Auto-Delete Timer */}
                            {msg.file && (
                              <FileDeleteTimer
                                msgTimestamp={msg.timestamp}
                                fileId={msg.file.id}
                                roomId={roomId}
                                isMe={isMe}
                                msgId={msg.id}
                              />
                            )}
                          </div>

                           {/* Timestamp & receipts */}
                          <div id="bubble-status" className="flex items-center gap-1.5">
                            {isMe && (() => {
                              const isViewed = peerOnline || (msg.timestamp && msg.timestamp <= lastPeerOnlineTime);
                              return (
                                <div id="receipt-ticks" className="flex items-center opacity-100">
                                  {isViewed ? (
                                    <svg
                                      viewBox="0 0 496 512"
                                      className="w-4 h-4 flex-shrink-0"
                                      style={{ color: "rgb(255, 212, 59)" }}
                                      fill="currentColor"
                                      title="Delivered to peer"
                                    >
                                      <path d="M323 262.1l-.1-13s21.7-19.8 21.1-21.2l-9.5-20c-.6-1.4-29.5-.5-29.5-.5l-9.4-9.3s.2-28.5-1.2-29.1l-20.1-9.2c-1.4-.6-20.7 21-20.7 21l-13.1-.2s-20.5-21.4-21.9-20.8l-20 8.3c-1.4.5.2 28.9.2 28.9l-9.1 9.1s-29.2-.9-29.7.4l-8.1 19.8c-.6 1.4 21 21 21 21l.1 12.9s-21.7 19.8-21.1 21.2l9.5 20c.6 1.4 29.5.5 29.5.5l9.4 9.3s-.2 31.8 1.2 32.3l20.1 8.3c1.4.6 20.7-23.5 20.7-23.5l13.1.2s20.5 23.8 21.8 23.3l20-7.5c1.4-.6-.2-32.1-.2-32.1l9.1-9.1s29.2.9 29.7-.5l8.1-19.8c.7-1.1-20.9-20.7-20.9-20.7zm-44.9-8.7c.7 17.1-12.8 31.6-30.1 32.4-17.3.8-32.1-12.5-32.8-29.6-.7-17.1 12.8-31.6 30.1-32.3 17.3-.8 32.1 12.5 32.8 29.5zm201.2-37.9l-97-97-.1.1c-75.1-73.3-195.4-72.8-269.8 1.6-50.9 51-27.8 27.9-95.7 95.3-22.3 22.3-22.3 58.7 0 81 69.9 69.4 46.4 46 97.4 97l.1-.1c75.1 73.3 195.4 72.9 269.8-1.6 51-50.9 27.9-27.9 95.3-95.3 22.3-22.3 22.3-58.7 0-81zM140.4 363.8c-59.6-59.5-59.6-156 0-215.5 59.5-59.6 156-59.5 215.6 0 59.5 59.5 59.6 156 0 215.6-59.6 59.5-156 59.4-215.6-.1z" />
                                    </svg>
                                  ) : (
                                    <Check className={`w-4 h-4 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`} title="Sent successfully" />
                                  )}
                                </div>
                              );
                            })()}
                            <span className={`text-[9px] font-bold font-mono opacity-80 ${isDarkMode ? "text-white" : "text-black"
                              }`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Floating Reply Button */}
                      <button
                        id={`btn-reply-floating-${msg.id}`}
                        onClick={() => {
                          setReplyingTo(msg);
                          chatInputRef.current?.focus();
                        }}
                        className={`p-2 rounded-full transition-all duration-200 shadow-md flex-shrink-0 hover:scale-105 active:scale-95 cursor-pointer ${isDarkMode
                          ? "bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-400 border border-white/10"
                          : "bg-white hover:bg-slate-50 text-slate-500 hover:text-indigo-600 border border-slate-200"
                          }`}
                        title="Reply"
                      >
                        <Reply className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}

            {/* Uploading Progress Bubbles */}
            {uploadingFiles.map((up) => {
              const bubbleBgClass = isDarkMode
                ? "bg-gradient-to-tr from-slate-900 to-emerald-950/30 text-slate-100 border border-emerald-500/20 shadow-md"
                : "bg-gradient-to-tr from-emerald-50 to-teal-100/30 text-slate-800 border border-emerald-200/40 shadow-sm";
              return (
                <div
                  key={up.id}
                  className="flex flex-col max-w-[90%] sm:max-w-[80%] ml-auto items-end group/msg relative animate-pulse"
                >
                  <span id="sender-label" className="text-[10px] text-slate-400 font-bold mb-1 ml-2 uppercase tracking-wider flex items-center gap-1.5">
                    {up.senderName} (You)
                  </span>
                  <div id="msg-bubble-wrapper" className="flex items-center gap-2 relative max-w-full flex-row-reverse group/wrapper">
                    <div
                      id="bubble"
                      className={`rounded-2xl p-3.5 text-sm shadow-sm transition-all duration-150 text-left min-w-[180px] max-w-full rounded-br-none ${bubbleBgClass}`}
                    >
                      <div className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-[#0E0E12]/20">
                        <div className="p-2.5 rounded-lg bg-white/5 animate-spin shrink-0">
                          <Loader2 className="w-4 h-4 text-cyan-400" />
                        </div>
                        <div className="text-left flex-1 min-w-0">
                          <h5 className="font-bold text-xs truncate max-w-[150px] text-white">
                            {up.fileName}
                          </h5>
                          <p className="text-[10px] opacity-75 text-slate-400 font-semibold font-mono mt-0.5">
                            {formatBytes(up.fileSize)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-4 mt-2.5 opacity-80 select-none pt-1.5 border-t border-white/5">
                        <span className="text-[9px] font-bold font-mono text-cyan-400">
                          Uploading ({up.progress}%)
                        </span>
                        <span className="text-[9px] font-bold font-mono text-slate-400">
                          {new Date(up.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

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



        {/* Chat Input Footer - always visible, never hidden */}
        <footer
          id="chat-footer"
          style={{ paddingBottom: typeof window !== 'undefined' && window.innerWidth < 640 ? 'calc(12px + env(safe-area-inset-bottom))' : undefined }}
          className={`px-3 md:px-6 pt-3 pb-3 md:py-4 border-t relative shrink-0 ${isDarkMode ? "border-white/5 bg-[#0E0E12]/80" : "border-slate-200/60 bg-white/40"
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

          {replyingTo && (() => {
            const attachInfo = replyingTo.file ? getReplyAttachmentLabel(replyingTo.file.type, replyingTo.file.name) : null;
            return (
              <div className={`px-4 py-2.5 mb-3 rounded-xl border flex items-center justify-between text-sm ${isDarkMode
                ? "bg-[#16161a]/90 border-white/10 text-white"
                : "bg-slate-50 border-slate-200 text-slate-800"
                }`}>
                <div className="flex gap-2.5 items-stretch flex-1 min-w-0">
                  <div className={`w-1 rounded-full shrink-0 ${isDarkMode ? "bg-[#38bdf8]" : "bg-indigo-500"}`} />
                  <div className="flex flex-col flex-1 min-w-0 pl-1">
                    <span className={`font-bold text-xs ${isDarkMode ? "text-[#38bdf8]" : "text-indigo-600"}`}>
                      Replying to {replyingTo.senderName === sessionName ? "You" : replyingTo.senderName}
                    </span>
                    <p className={`truncate text-xs mt-0.5 flex items-center gap-1 ${isDarkMode ? "text-slate-350" : "text-slate-600"}`}>
                      {attachInfo ? (
                        <>
                          {attachInfo.icon}
                          <span className="font-semibold">{attachInfo.label}</span>
                        </>
                      ) : (
                        replyingTo.text
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className={`p-1.5 rounded-full transition-colors cursor-pointer ${isDarkMode ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-slate-200 text-slate-500 hover:text-slate-800"
                    }`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })()}

          <form id="chat-input-form" onSubmit={(e) => {
            handleSendMessage(e);
            // After sending, immediately refocus so keyboard stays when locked
            if (isKeyboardLocked) {
              requestAnimationFrame(() => chatInputRef.current?.focus());
            }
          }} className="flex items-center gap-2 md:gap-3">
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
                onPointerDown={(e) => { if (isKeyboardLocked) e.preventDefault(); }}
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

                    <button
                      id="btn-knock-nudge"
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        onSendKnock?.();
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all text-left ${isDarkMode
                        ? "hover:bg-white/5 text-slate-200 hover:text-cyan-400"
                        : "hover:bg-slate-100 text-slate-700 hover:text-indigo-600"
                        }`}
                    >
                      <Bell className="w-4 h-4 text-rose-500" />
                      <span>Knock </span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Keyboard Lock Button */}
            <button
              id="btn-keyboard-lock"
              type="button"
              onPointerDown={(e) => { if (isKeyboardLocked) e.preventDefault(); }}
              onClick={() => {
                const next = !isKeyboardLocked;
                setIsKeyboardLocked(next);
                if (next) {
                  setTimeout(() => chatInputRef.current?.focus(), 50);
                }
              }}
              title={isKeyboardLocked ? "Keyboard locked — tap to unlock" : "Tap to lock keyboard open"}
              className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center justify-center shrink-0 ${
                isKeyboardLocked
                  ? "border-cyan-500 text-cyan-400 bg-cyan-500/15 shadow-[0_0_8px_rgba(6,182,212,0.4)]"
                  : isDarkMode
                    ? "border-white/10 hover:border-cyan-500/30 hover:text-cyan-400 bg-white/5 text-slate-400"
                    : "border-slate-200 hover:border-indigo-500 hover:text-indigo-500 bg-slate-50 text-slate-400"
              }`}
            >
              <Keyboard className="w-4 h-4 md:w-5 md:h-5" />
            </button>

            {/* Attachment indicator pill */}
            {attachments.length > 0 && !isUploading && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/20 text-cyan-400 rounded-lg text-xs font-bold shrink-0">
                <Paperclip className="w-3.5 h-3.5" />
                <span>{attachments.length} File{attachments.length > 1 ? 's' : ''}</span>
                <button
                  type="button"
                  onPointerDown={(e) => { if (isKeyboardLocked) e.preventDefault(); }}
                  onClick={() => setAttachments([])}
                  className="ml-1 p-0.5 hover:bg-cyan-500/20 rounded-full cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <textarea
              id="chat-message-textbox"
              ref={chatInputRef}
              rows={1}
              placeholder={
                isUploading
                  ? `Uploading (${uploadProgress ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0}%)...`
                  : "Type a message..."
              }
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={isUploading}
              onFocus={() => {
                setTimeout(() => {
                  window.scrollTo(0, 0);
                  document.body.scrollTop = 0;
                }, 50);
              }}
              onBlur={(e) => {
                // When keyboard is locked, prevent blur from closing keyboard
                if (isKeyboardLocked) {
                  e.preventDefault();
                  // Use requestAnimationFrame for most reliable same-frame refocus
                  requestAnimationFrame(() => chatInputRef.current?.focus());
                  return;
                }
                setTimeout(() => {
                  window.scrollTo(0, 0);
                  document.body.scrollTop = 0;
                }, 50);
              }}
              className={`flex-1 min-w-0 py-3 md:py-3.5 px-4 md:px-5 rounded-xl outline-none border transition-all text-base md:text-lg resize-none max-h-40 overflow-y-auto ${isDarkMode
                ? "bg-slate-950/80 border-white/5 text-slate-100 placeholder-slate-600 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                : "bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                } ${isKeyboardLocked ? 'ring-2 ring-cyan-500/50 border-cyan-500/50' : ''}`}
            />

            {/* Submit Button */}
            <button
              id="btn-submit-message"
              type="submit"
              onPointerDown={(e) => { if (isKeyboardLocked) e.preventDefault(); }}
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
          className={`w-72 p-5 flex flex-col transition-all duration-300 h-full overflow-hidden absolute right-0 top-0 bottom-0 z-30 md:relative shadow-2xl md:shadow-none ${isDarkMode ? "bg-[#0E0E12]/95 backdrop-blur-md" : "bg-white/95 backdrop-blur-md"
            }`}
        >
          {/* Header / Dismiss */}
          <div id="sidebar-header" className="flex items-center justify-between pb-3 border-b border-white/5 mb-3">
            <h4 className={`font-black text-xs uppercase tracking-widest flex items-center gap-1.5 ${isDarkMode ? "text-white" : "text-slate-800"}`}>
              <Info className="w-4 h-4 text-cyan-400" />
              <span>Panel Details</span>
            </h4>
            <button
              id="btn-dismiss-sidebar"
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded-lg hover:bg-white/5 cursor-pointer"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {/* Session Info Details */}
          <div className="space-y-5 overflow-y-auto flex-1 pr-0.5 animate-fade-in">
            {/* Connection Status bar */}
            <div id="conn-health-box" className={`p-4 rounded-2xl border flex flex-col text-left ${isDarkMode ? "bg-white/5 border-white/5" : "bg-slate-50 border-slate-200"
              }`}>
              <div id="conn-state" className="flex items-center gap-2 mb-2">
                <Wifi className="w-4 h-4 text-cyan-400" />
                <span className={`text-xs font-black uppercase tracking-wider ${isDarkMode ? "text-white" : "text-slate-700"}`}>
                  E2E Secure Link
                </span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed font-mono font-bold">
                ROOM_ID: {roomId.replace("room-", "").substring(0, 15)}
              </p>
            </div>

            {/* Participant Profiles list card */}
            <div id="participants-panel" className={`p-4 rounded-2xl border text-left flex flex-col gap-3.5 ${isDarkMode ? "bg-white/5 border-white/5" : "bg-slate-50 border-slate-200"
              }`}>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/10 dark:border-white/5">
                <h5 className={`text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ${isDarkMode ? "text-white" : "text-slate-700"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                  <span>Members ({peers.length + 1})</span>
                </h5>
              </div>

              <div className="space-y-3">
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
                  <div id={`profile-row-${p.id}`} key={p.id} className="flex items-center justify-between gap-3 animate-fade-in">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        id={`avatar-${p.id}`}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs text-white font-bold bg-gradient-to-br shadow-sm shrink-0 ${getAvatarGradient(
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
                    {isHost && (
                      <button
                        onClick={() => handleKickPeer(p.id, p.name)}
                        className={`p-1.5 rounded-lg border transition-all cursor-pointer shrink-0 ${isDarkMode
                          ? "bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20 text-rose-400"
                          : "bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-600"
                          }`}
                        title={`Kick ${p.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Secure Ephemeral Warning details + Keep-Alive Toggle */}
            <div id="sidebar-bottom" className="space-y-4 pt-4 border-t border-white/5 text-left">
              {/* 3-Hour Keep-Alive Toggle inside chat sidebar — always shown */}
              <div
                id="sidebar-keep-alive-toggle"
                onClick={onToggleKeepAlive}
                className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer select-none transition-all duration-300 ${keepAlive3h
                  ? "bg-cyan-500/10 border-cyan-500/30 shadow-[0_0_14px_rgba(6,182,212,0.08)]"
                  : isDarkMode ? "bg-white/5 border-white/5 hover:border-white/10" : "bg-slate-50 border-slate-200 hover:border-slate-300"
                  }`}
              >
                <div className="text-left pr-3">
                  <p className={`text-[11px] font-black tracking-tight ${keepAlive3h ? "text-cyan-400" : isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                    Data stored in 3hr
                  </p>
                  <p className={`text-[9px] font-semibold mt-0.5 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                    No cleanup on refresh
                  </p>
                </div>
                <div
                  className={`w-9 h-5 rounded-full p-0.5 transition-all duration-300 flex items-center shrink-0 ${keepAlive3h ? "bg-cyan-500" : "bg-slate-700"
                    }`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${keepAlive3h ? "transform translate-x-4" : ""
                    }`} />
                </div>
              </div>

              {/* Knock Volume Control inside sidebar */}
              <div
                id="sidebar-knock-volume"
                className={`p-3.5 rounded-2xl border flex flex-col gap-2 select-none transition-all duration-300 ${isDarkMode ? "bg-white/5 border-white/5" : "bg-slate-50 border-slate-200"
                  }`}
              >
                <div className="flex items-center justify-between pr-1">
                  <p className={`text-[11px] font-black tracking-tight ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                    Knock Volume
                  </p>
                  <span className={`text-[9px] font-mono font-bold ${isDarkMode ? "text-cyan-400" : "text-indigo-600"}`}>
                    {Math.round(knockVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={knockVolume}
                  onChange={(e) => {
                    const vol = parseFloat(e.target.value);
                    onChangeKnockVolume(vol);
                    localStorage.setItem("knock_volume", vol.toString());
                  }}
                  onMouseUp={() => playNotificationSound("knock", knockVolume)}
                  onTouchEnd={() => playNotificationSound("knock", knockVolume)}
                  className="w-full accent-cyan-500 cursor-pointer h-1 bg-slate-700 rounded-lg appearance-none"
                />
              </div>

              <div id="info-tip-box" className={`p-2.5 rounded-xl border text-[10px] flex gap-2 items-start select-none ${isDarkMode
                ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.06)]"
                : "bg-cyan-50/50 border-cyan-200/60 text-cyan-800"
                }`}>
                <Info className="w-3.5 h-3.5 shrink-0 text-cyan-400 mt-0.5" />
                <div className="text-left leading-snug">
                  <p className="font-black uppercase tracking-wider text-[8px] text-cyan-400 mb-0.5">System Security Notice</p>
                  <p className="text-slate-400 dark:text-cyan-300/90 font-medium">
                    This conversation is fully End To End Encrypted. When Host disconnects, all members & messages and media files are cleared permanently from Database. This Is Temporary Storage, Please Save Your Data Seperate & Secure.
                  </p>
                </div>
              </div>
              <p className="text-[9px] text-slate-500 text-center font-mono select-none font-bold">
                MAX SIZE: 250MB
              </p>
            </div>
          </div>

          {/* Developer/App Credits Highlight */}
          <div id="developer-credits-card" className={`p-3 rounded-2xl border text-center transition-all duration-300 mt-4 shrink-0 ${isDarkMode
            ? "bg-gradient-to-br from-indigo-500/10 via-cyan-500/5 to-purple-500/10 border-cyan-500/25 shadow-md shadow-cyan-500/5"
            : "bg-slate-50 border-slate-200"
            }`}>
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">
              Developed By
            </p>
            <h4 className="text-sm font-black mt-1 bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent uppercase tracking-wider">
              Satyajit Pratihar
            </h4>
            <p className="text-[10px] font-black uppercase tracking-wider mt-0.5 bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(6,182,212,0.3)]">
              GNIT - IT Student
            </p>
            <div className="mt-2 space-y-1 text-left text-[9px] text-slate-400/90 font-medium">
              <p className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-cyan-400"></span>
                <span>End-to-End E2E Encryption</span>
              </p>
              <p className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-indigo-400"></span>
                <span>Instant QR-Code Pairing</span>
              </p>
              <p className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-purple-400"></span>
                <span>Fully Ephemeral Session Cleanup</span>
              </p>
            </div>
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
      {showAddMember && createPortal(
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 overflow-y-auto flex items-start justify-center p-4 md:items-center">
          <div className="relative w-full max-w-[380px] my-auto animate-scale-up py-6">
            <button
              onClick={() => {
                setShowAddMember(false);
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
              <div className={`flex items-center justify-center p-8 rounded-3xl min-h-[300px] border ${isDarkMode ? "bg-[#16161A] border-white/5" : "bg-white border-slate-200"
                }`}>
                <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Join Chat Modal (Camera QR Scanner & Code Entry) */}
      {showJoinChat && createPortal(
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 overflow-y-auto flex items-center justify-center p-4">
          <div className="w-full max-w-sm animate-scale-up">
            <QrScanner
              onScanSuccess={(targetId) => {
                setShowJoinChat(false);
                onScanSuccess?.(targetId);
              }}
              onCancel={() => setShowJoinChat(false)}
              isDarkMode={isDarkMode}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

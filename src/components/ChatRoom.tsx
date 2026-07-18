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
  Settings
} from "lucide-react";
import { Message, Peer, PendingFile, JoinRequest } from "../types";
import { formatBytes, getAvatarGradient, getInitials, MAX_FILE_SIZE_BYTES, playNotificationSound } from "../utils";
import Lightbox from "./Lightbox";
import QrGenerator from "./QrGenerator";
import QrScanner from "./QrScanner";
import { db } from "../firebase";
import { ref as dbRef, set, get, remove, onDisconnect } from "firebase/database";
import { AlertCircle } from "lucide-react";
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
}

function FileAttachmentView({ file, isMe, onSetLightbox, roomId }: FileAttachmentViewProps) {
  const [fileData, setFileData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchFile = async () => {
      try {
        const snap = await get(dbRef(db, `rooms/${roomId}/files/${file.id}`));
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
      \tring(subLastIndex, subMatch.index));
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
  keepAlive5h?: boolean;
  onToggleKeepAlive?: () => void;
  isHost?: boolean;
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
  keepAlive5h = false,
  onToggleKeepAlive,
  isHost = false,
}: ChatRoomProps) {
  const [inputText, setInputText] = useState("");
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showAddMember, setShowAddMember] = useState(autoShowInvite || false);
  const [showJoinChat, setShowJoinChat] = useState(false);

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
      canvas.height

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
         Name: string) => {
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

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
        for (const att
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
      className={`flex h-full flex-1 min-h-0 relative w-full overflow-hidden rounded-2xl md:rounded-3xl transition-all duration-300 shadow-2xl backdrop-blur-md neon-rgb-glow ${isDarkMode
        ? "bg-[#0E0E12]/80"
        : "bg-white/80"
        }`}
    >
      {isDragging && (
        <div id="drag-overlay" className="absolute inset-0 bg-cyan-500/10 border-4 border-dashed border-cyan-400 z-40 flex flex-col items-center justify-center pointer-events-none animate-pulse">
          <Paperclip className="w-16 h-16 text-cyan-400 mb-3" />
          <h3 className="text-xl font-black text-white">Drop Files Here</h3>
          <p className="text-sm text-cyan-200 mt-1">Share images, PDFs, ZIPs, or other files up to 15MB instantly</p>
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
          className={`sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b ${isDarkMode ? "border-white/5 bg-[#0E0E12]/90" : "border-slate-200/60 bg-white/60"
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
              className={`flex items-center gap-1 py-1.5 px-2.5 md:px-3 rounded-xl border font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer ${isDarkMode
                ? "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 border-cyan-500/20"
                : "bg-cyan-50 hover:bg-cyan-100 text-cyan-600 border-cyan-200"
                }`}
              title="Add member"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Member</span>
            </button>

            <button
              id="btn-join-chat-inline"
              onClick={() => setShowJoinChat(true)}
              className={`flex items-center gap-1 py-1.5 px-2.5 md:px-3 rounded-xl border font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer ${isDarkMode
                ? "bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border-indigo-500/20"
                : "bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border-indigo-200"
                }`}
              title="Join chat"
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Join Chat</span>
            </button>

            <button
              id="btn-export-pdf"
              onClick={exportToPdf}
              className={`flex items-center gap-1 py-1.5 px-2.5 md:px-3 rounded-xl border font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer ${isDarkMode
                ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border-amber-500/20"
                : "bg-amber-50 hover:bg-amber-100 text-amber-600 border-amber-200"
                }`}
              title="Export chat as PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">PDF</span>
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
              className={`flex items-center gap-1 py-1.5 px-2.5 md:px-3.5 rounded-xl border font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-all cursor-pointer ${isDarkMode
                ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border-rose-500/20"
                : "bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200"
                }`}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Disconnect</span>
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
                  <div id="msg-bubble-wrapper" className="flex items-end gap-2 relative max-w-full">
                    {/* Standard Text or File Bubble */}
                    <div
                      id="bubble"
                      className={`rounded-2xl p-3.5 text-sm shadow-sm transition-all duration-150 text-left min-w-[160px] max-w-full ${
                        isMe ? "rounded-br-none" : "rounded-bl-none"
                      } ${bubbleBgClass}`}
                    >
                      {/* File Rendering */}
                      {msg.file && (
                        <FileAttachmentView
                          file={msg.file}
                          isMe={isMe}
                          onSetLightbox={(url, name) => setLightboxImage({ url, name })}
                          roomId={roomId}
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
                      <div id="bubble-meta" className={`flex items-center justify-between gap-4 mt-2.5 opacity-80 select-none pt-1.5 border-t ${isDarkMode ? "border-white/5" : "border-slate-200/80"
                        }`}>
                        {/* Actions (Copy Text, Copy Link, Delete) */}
                        <div id="bubble-actions" className="flex items-center gap-2">
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
                        </div>

                        {/* Timestamp & receipts */}
                        <div id="bubble-status" className="flex items-center gap-1.5">
                          <span className={`text-[9px] font-bold font-mono ${isDarkMode ? "text-white" : "text-black"
                            }`}>
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {isMe && (
                            <div id="receipt-ticks">
                              {peerOnline ? (
                                <CheckCheck className={`w-3 h-3 ${isDarkMode ? "text-amber-400" : "text-orange-600"}`} title="Delivered to peer" />
                              ) : (
                                <Check className={`w-3 h-3 ${isDarkMode ? "text-amber-500" : "text-orange-500"}`} title="Sent successfully" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
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

        {/* Chat Input Footer - always visible, never hidden */}
        <footer
          id="chat-footer"
          className={`px-3 md:px-6 py-3 md:py-4 border-t relative shrink-0 ${isDarkMode ? "border-white/5 bg-[#0E0E12]/80" : "border-slate-200/60 bg-white/40"
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

            <input
              id="chat-message-textbox"
              type="text"
              placeholder={isUploading ? "Uploading shared files..." : "Type a message..."}
              value={inputText}
              onChange={handleInputChange}
              disabled={isUploading}
              onFocus={() => {
                setTimeout(() => {
                  window.scrollTo(0, 0);
                  document.body.scrollTop = 0;
                }, 50);
              }}
              onBlur={() => {
                setTimeout(() => {
                  window.scrollTo(0, 0);
                  document.body.scrollTop = 0;
                }, 50);
              }}
              className={`flex-1 min-w-0 py-3 md:py-3.5 px-4 md:px-5 rounded-xl outline-none border transition-all text-base md:text-lg ${isDarkMode
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
          className={`w-72 p-5 flex flex-col justify-between transition-all duration-300 h-full overflow-hidden absolute right-0 top-0 bottom-0 z-30 md:relative shadow-2xl md:shadow-none neon-sidebar-glow ${isDarkMode ? "bg-[#0E0E12]/95 backdrop-blur-md" : "bg-white/95 backdrop-blur-md"
            }`}
        >
          <div id="sidebar-top" className="flex flex-col flex-1 min-h-0">
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
              <div id="participants-panel" className={`p-4 rounded-2xl border text-left flex flex-col gap-3.5 ${
                isDarkMode ? "bg-white/5 border-white/5" : "bg-slate-50 border-slate-200"
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
            </div>
          </div>

          {/* Secure Ephemeral Warning details + Keep-Alive Toggle */}
          <div id="sidebar-bottom" className="space-y-4 pt-4 border-t border-white/5 text-left shrink-0">
            {/* 5-Hour Keep-Alive Toggle inside chat sidebar — always shown */}
            <div
              id="sidebar-keep-alive-toggle"
              onClick={onToggleKeepAlive}
              className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer select-none transition-all duration-300 ${keepAlive5h
                ? "bg-cyan-500/10 border-cyan-500/30 shadow-[0_0_14px_rgba(6,182,212,0.08)]"
                : isDarkMode ? "bg-white/5 border-white/5 hover:border-white/10" : "bg-slate-50 border-slate-200 hover:border-slate-300"
                }`}
            >
              <div className="text-left pr-3">
                <p className={`text-[11px] font-black tracking-tight ${keepAlive5h ? "text-cyan-400" : isDarkMode ? "text-slate-300" : "text-slate-700"}`}>
                  Data stored in 5hr
                </p>
                <p className={`text-[9px] font-semibold mt-0.5 ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                  No cleanup on refresh
                </p>
              </div>
              <div
                className={`w-9 h-5 rounded-full p-0.5 transition-all duration-300 flex items-center shrink-0 ${keepAlive5h ? "bg-cyan-500" : "bg-slate-700"
                  }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${keepAlive5h ? "transform translate-x-4" : ""
                  }`} />
              </div>
            </div>

            <div id="info-tip-box" className={`p-2.5 rounded-xl border text-[10px] flex gap-2 items-start select-none ${
              isDarkMode 
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
              MAX SIZE: 15MB
            </p>

            {/* Developer/App Credits Highlight */}
            <div id="developer-credits-card" className={`p-3 rounded-2xl border text-center transition-all duration-300 ${
              isDarkMode 
                ? "bg-gradient-to-br from-indigo-500/10 via-cyan-500/5 to-purple-500/10 border-cyan-500/25 shadow-md shadow-cyan-500/5" 
                : "bg-slate-50 border-slate-200"
            }`}>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">
                Developed By
              </p>
              <h4 className="text-xs font-black mt-1 bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent uppercase tracking-wider">
                Satyajit Pratihar
              </h4>
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

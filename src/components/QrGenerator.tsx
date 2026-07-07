import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Copy, Check, RefreshCw, Smartphone, QrCode } from "lucide-react";
import { getAvatarGradient, getInitials } from "../utils";

interface QrGeneratorProps {
  sessionId: string;
  sessionName?: string;
  avatarSeed?: string;
  onRefresh?: () => void;
  isDarkMode: boolean;
  simple?: boolean;
}

export default function QrGenerator({
  sessionId,
  sessionName = "",
  avatarSeed = "",
  onRefresh = () => {},
  isDarkMode,
  simple = false,
}: QrGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Generate invite link based on current origin
  const inviteLink = `${window.location.origin}?scan=${sessionId}`;

  useEffect(() => {
    if (canvasRef.current && sessionId) {
      // Configure colors according to mode
      const darkColor = isDarkMode ? "#1e1b4b" : "#312e81"; // deep indigo
      const lightColor = "#ffffff";

      QRCode.toCanvas(
        canvasRef.current,
        inviteLink,
        {
          width: 280,
          margin: 1.5,
          color: {
            dark: darkColor,
            light: lightColor,
          },
        },
        (err) => {
          if (err) console.error("Error generating QR code:", err);
        }
      );
    }
  }, [sessionId, inviteLink, isDarkMode]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    onRefresh();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const initials = getInitials(sessionName);
  const gradientClass = getAvatarGradient(avatarSeed);

  if (simple) {
    return (
      <div
        id="qr-canvas-wrapper"
        className={`flex flex-col items-center justify-center p-4 bg-white rounded-2xl border ${
          isDarkMode ? "border-cyan-500/35 shadow-[0_0_25px_rgba(6,182,212,0.2)]" : "border-slate-100 shadow-inner"
        }`}
      >
        <canvas id="qr-canvas-element" ref={canvasRef} className="w-full max-w-[240px] h-auto object-contain rounded-lg" />
      </div>
    );
  }

  return (
    <div id="qr-generator-container" className="flex flex-col items-center">
      {/* Premium Glassmorphism Card */}
      <div
        id="qr-card"
        className={`relative w-full max-w-[380px] rounded-3xl p-6 transition-all duration-300 shadow-2xl border ${isDarkMode
            ? "bg-sleek-card border-white/5 shadow-cyan-500/5"
            : "bg-white/90 border-slate-200/80 shadow-slate-200/50"
          }`}
      >
        {/* Glow behind card */}
        <div
          id="qr-card-glow"
          className={`absolute -inset-0.5 rounded-3xl blur opacity-25 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-pulse -z-10 bg-gradient-to-r ${isDarkMode ? "from-cyan-500 to-indigo-500" : "from-blue-400 to-indigo-400"
            }`}
        ></div>

        {/* User Info Header */}
        <div id="qr-user-header" className="flex items-center gap-4 mb-6">
          <div
            id="user-avatar"
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold bg-gradient-to-br shadow-md ${gradientClass}`}
          >
            {initials}
          </div>
          <div id="user-details" className="text-left flex-1">
            <p className={`text-[10px] ${isDarkMode ? "text-cyan-400" : "text-indigo-600"} font-bold uppercase tracking-widest`}>
              Session QR Profile
            </p>
            <h3 className={`text-base font-black truncate ${isDarkMode ? "text-white" : "text-slate-800"}`}>
              {sessionName}
            </h3>
          </div>
          <div id="connection-status" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Awaiting...</span>
          </div>
        </div>

        {/* QR Code Container */}
        <div id="qr-canvas-wrapper" className={`flex flex-col items-center justify-center p-6 bg-white rounded-3xl border ${isDarkMode ? "border-cyan-500/35 shadow-[0_0_30px_rgba(6,182,212,0.18)]" : "border-slate-100 shadow-inner"}`}>
          <canvas id="qr-canvas-element" ref={canvasRef} className="w-full max-w-[250px] h-auto object-contain rounded-lg" />
          <p className="text-[9px] text-slate-400 mt-4 font-mono break-all select-all font-bold uppercase tracking-wider text-center">
            {/^\d{6}$/.test(sessionId)
              ? `INVITE CODE: ${sessionId.substring(0, 3)} ${sessionId.substring(3, 6)}`
              : `SECURE ID: ${sessionId.substring(0, 18)}`
            }
          </p>
        </div>

        {/* Action Buttons */}
        <div id="qr-actions" className="flex flex-col gap-3 mt-6">
          <button
            id="btn-copy-link"
            onClick={handleCopyLink}
            className={`flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-bold transition-all duration-200 cursor-pointer text-xs uppercase tracking-wider hover:scale-[1.01] ${copied
                ? "bg-emerald-500 text-white"
                : isDarkMode
                  ? "bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-lg shadow-cyan-500/15"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/15"
              }`}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                Copied Link!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy Pairing Link
              </>
            )}
          </button>

          <div id="sub-actions-grid" className="grid grid-cols-2 gap-3">
            <button
              id="btn-refresh-qr"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all cursor-pointer disabled:opacity-50 ${isDarkMode
                  ? "border-white/10 text-slate-300 bg-white/5 hover:bg-white/10 hover:text-white"
                  : "border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100"
                }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>

            <button
              id="btn-share-info"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({
                    title: "P2P Instant Chat Pairing",
                    text: `Connect with me on QR Instant Chat: ${sessionName}`,
                    url: inviteLink,
                  }).catch(console.error);
                } else {
                  handleCopyLink();
                }
              }}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all cursor-pointer ${isDarkMode
                  ? "border-white/10 text-slate-300 bg-white/5 hover:bg-white/10 hover:text-white"
                  : "border-slate-200 text-slate-600 bg-slate-50 hover:bg-slate-100"
                }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Share
            </button>
          </div>
        </div>
      </div>

      <div id="pairing-instructions" className={`flex items-center gap-2.5 mt-5 max-w-sm text-center text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
        <QrCode className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <p>
          Ask another user to click <strong className="text-indigo-500 font-semibold">Scan QR</strong> on their device and point their camera here to link instantly.
        </p>
      </div>
    </div>
  );
}

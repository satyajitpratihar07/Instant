import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, AlertCircle, Sparkles, Check, Send, ArrowRight, Upload } from "lucide-react";

interface QrScannerProps {
  onScanSuccess: (targetId: string) => void;
  onCancel: () => void;
  isDarkMode: boolean;
}

export default function QrScanner({ onScanSuccess, onCancel, isDarkMode }: QrScannerProps) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!scannerActive) return;

    let active = true;

    const startScanner = async () => {
      try {
        // Instantiate the QR reader on the target div
        const html5Qrcode = new Html5Qrcode("qr-reader-target");
        scannerRef.current = html5Qrcode;

        // Query available cameras
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || cameras.length === 0) {
          throw new Error("No cameras found on this device.");
        }

        // Find back/environment camera if available
        const backCamera = cameras.find(c => 
          c.label.toLowerCase().includes("back") || 
          c.label.toLowerCase().includes("rear") || 
          c.label.toLowerCase().includes("environment")
        );
        const cameraId = backCamera ? backCamera.id : cameras[0].id;

        await html5Qrcode.start(
          cameraId,
          {
            fps: 20,
            qrbox: (width, height) => {
              const size = Math.min(width, height) * 0.85;
              return { width: size, height: size };
            },
          },
          (decodedText) => {
            if (!active) return;
            // Extract sessionId if it's a full URL, otherwise use it directly
            let targetId = decodedText;
            try {
              if (decodedText.startsWith("http")) {
                const url = new URL(decodedText);
                const scanParam = url.searchParams.get("scan");
                if (scanParam) {
                  targetId = scanParam;
                }
              }
            } catch (e) {
              console.warn("Could not parse decoded text as URL:", e);
            }

            // Stop scanning and trigger success
            stopScanner().then(() => {
              if (active) {
                onScanSuccess(targetId);
              }
            });
          },
          () => {
            // Verbose error logging ignored for optimal scanning experience
          }
        );

        if (active) {
          setHasPermission(true);
        }
      } catch (err: any) {
        if (!active) return;
        console.error("Camera access failed:", err);
        setHasPermission(false);
        setScanError(err.message || "Failed to start camera scanner.");
      }
    };

    // Tiny timeout to ensure the DOM element is fully rendered first
    const timer = setTimeout(() => {
      if (active) {
        startScanner();
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
      stopScanner();
    };
  }, [scannerActive]);

  const stopScanner = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch (e) {
        console.error("Failed to stop scanner on cleanup:", e);
      }
    }
  };

  const handleManualPair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;

    // Parse the manual input if they paste the full link
    let targetId = manualInput.trim();
    try {
      if (targetId.startsWith("http")) {
        const url = new URL(targetId);
        const scanParam = url.searchParams.get("scan");
        if (scanParam) {
          targetId = scanParam;
        }
      }
    } catch (e) {
      console.warn("Manual input URL parsing skipped:", e);
    }

    // Trigger success
    stopScanner().then(() => {
      onScanSuccess(targetId);
    });
  };

  const handleFileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    try {
      // Stop scanner if active
      await stopScanner();

      const html5Qrcode = new Html5Qrcode("qr-reader-target");
      const decodedText = await html5Qrcode.scanFile(file, false);

      let targetId = decodedText;
      try {
        if (decodedText.startsWith("http")) {
          const url = new URL(decodedText);
          const scanParam = url.searchParams.get("scan");
          if (scanParam) {
            targetId = scanParam;
          }
        }
      } catch (e) {
        console.warn("Could not parse decoded text as URL:", e);
      }

      onScanSuccess(targetId);
    } catch (err: any) {
      console.error("Failed to scan QR from file:", err);
      setFileError("No valid QR code found. Please verify the image contains a clear QR code.");
    }
  };

  return (
    <div id="qr-scanner-container" className="flex flex-col items-center w-full max-w-[360px] mx-auto animate-scale-up">
      {/* Glow card shell */}
      <div
        id="scanner-card"
        className={`relative w-full rounded-3xl p-6 transition-all duration-300 shadow-2xl border ${
          isDarkMode
            ? "bg-sleek-card border-white/5 shadow-cyan-500/5"
            : "bg-white/90 border-slate-200/80 shadow-slate-200/50"
        }`}
      >
        <div id="scanner-title" className="text-center mb-5">
          <h3 className={`text-lg font-black ${isDarkMode ? "text-white" : "text-slate-800"}`}>
            Scan Peer QR Code
          </h3>
          <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"} mt-1`}>
            Align the QR code within the frame to link instantly
          </p>
        </div>

        {/* Live Camera View Box */}
        <div id="scanner-viewport-wrapper" className="relative w-full aspect-square overflow-hidden rounded-3xl border border-dashed border-cyan-400/50 bg-slate-950 flex flex-col items-center justify-center p-0.5 shadow-[0_0_20px_rgba(34,211,238,0.05)]">
          {/* html5-qrcode target anchor - ALWAYS RENDERED with full size to avoid 0x0 size initialization bug */}
          <div
            id="qr-reader-target"
            className="w-full h-full overflow-hidden rounded-3xl [&_video]:object-cover [&_video]:w-full [&_video]:h-full"
          />

          {!scannerActive && (
            <div id="scanner-inactive" className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 text-center px-6 bg-slate-950 rounded-3xl z-10 animate-fade-in">
              <Camera className="w-10 h-10 text-cyan-400/80 animate-pulse" />
              <h4 className="font-bold text-white text-sm">Camera Scanner Inactive</h4>
              <p className="text-[11px] leading-relaxed max-w-[280px]">
                Click the button below to start the camera scanner and scan a QR code.
              </p>
              <button
                type="button"
                onClick={() => setScannerActive(true)}
                className="mt-3 py-2 px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-lg shadow-cyan-500/20 animate-pulse"
              >
                <Camera className="w-3.5 h-3.5" />
                Active Scanner
              </button>
            </div>
          )}

          {scannerActive && hasPermission === null && (
            <div id="scanner-loading" className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white bg-slate-950/90 rounded-3xl z-10">
              <Camera className="w-8 h-8 text-cyan-400 animate-pulse" />
              <span className="text-xs">Requesting camera access...</span>
            </div>
          )}

          {scannerActive && hasPermission === false && (
            <div id="scanner-denied" className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 text-center px-6 bg-slate-950 rounded-3xl z-10 animate-fade-in">
              <AlertCircle className="w-10 h-10 text-rose-500 animate-bounce" />
              <h4 className="font-bold text-white text-sm">Camera Access Blocked</h4>
              <p className="text-[11px] leading-relaxed max-w-[280px]">
                Camera access was blocked or is unavailable. You can upload a QR image/screenshot or paste the link.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 py-2 px-4 rounded-xl text-xs font-semibold bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-lg shadow-cyan-500/20"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload QR Screenshot
              </button>
            </div>
          )}

          {scannerActive && hasPermission && (
            <div id="scanning-laser-line" className="absolute left-0 right-0 h-0.5 bg-cyan-400 opacity-80 shadow-[0_0_12px_#22d3ee] top-1/2 -translate-y-1/2 animate-bounce pointer-events-none z-20" />
          )}
        </div>

        {/* Hidden input for file upload scanning */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileScan}
          className="hidden"
        />

        {/* Manual Pairing Form (Accessibility & Fallback) */}
        <div id="manual-form-wrapper" className="mt-6 pt-5 border-t border-white/5">
          {fileError && (
            <div className="mb-3 p-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs flex items-start gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{fileError}</span>
            </div>
          )}

          <div className="flex items-center justify-between mb-2">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
              Enter Invite Code
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 hover:text-cyan-300 transition-all cursor-pointer flex items-center gap-1"
            >
              <Upload className="w-3 h-3" />
              Upload Image
            </button>
          </div>

          <form id="manual-pairing-form" onSubmit={handleManualPair} className="flex flex-col gap-2">
            <div id="input-group" className="flex items-center gap-2">
              <input
                id="manual-input"
                type="text"
                placeholder="Enter 6-digit code or paste URL..."
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-mono outline-none border transition-all ${isDarkMode
                    ? "bg-slate-950/80 border-white/10 text-slate-100 placeholder-slate-600 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                    : "bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  }`}
              />
              <button
                id="btn-manual-submit"
                type="submit"
                disabled={!manualInput.trim()}
                className="p-3 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-40 text-white transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/15"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>

        {/* Back Button */}
        <button
          id="btn-cancel-scan"
          onClick={onCancel}
          className={`w-full mt-5 py-2.5 px-4 rounded-xl font-bold text-[10px] uppercase tracking-wider border transition-all cursor-pointer ${isDarkMode
              ? "border-white/10 hover:border-white/20 text-slate-300 hover:text-white bg-white/5 hover:bg-white/10"
              : "border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50 bg-white"
            }`}
        >
          Cancel and Back
        </button>
      </div>
    </div>
  );
}

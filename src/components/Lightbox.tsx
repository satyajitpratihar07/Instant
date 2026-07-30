import { X, Download } from "lucide-react";

interface LightboxProps {
  imageUrl: string;
  imageName: string;
  onClose: () => void;
}

export default function Lightbox({ imageUrl, imageName, onClose }: LightboxProps) {
  return (
    <div
      id="lightbox-backdrop"
      className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 transition-all duration-300 animate-fade-in"
      onClick={onClose}
    >
      {/* Controls */}
      <div id="lightbox-controls" className="absolute top-4 right-4 flex items-center gap-3 z-50">
        <a
          id="btn-lightbox-download"
          href={imageUrl}
          download={imageName}
          onClick={(e) => e.stopPropagation()}
          className="p-2.5 rounded-full bg-slate-800/80 border border-slate-700/60 hover:bg-slate-700 text-white transition-all shadow-md flex items-center justify-center"
          title="Download full image"
        >
          <Download className="w-5 h-5" />
        </a>
        <button
          id="btn-lightbox-close"
          onClick={onClose}
          className="p-2.5 rounded-full bg-slate-800/80 border border-slate-700/60 hover:bg-slate-700 text-white transition-all shadow-md flex items-center justify-center cursor-pointer"
          title="Close preview"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Image container */}
      <div
        id="lightbox-image-wrapper"
        className="relative max-w-full max-h-full flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          id="lightbox-preview-image"
          src={imageUrl}
          alt={imageName}
          className="max-w-[95vw] max-h-[85vh] object-contain rounded-lg shadow-2xl select-none"
        />
        <p id="lightbox-image-caption" className="text-sm text-slate-300 font-medium mt-4 text-center px-4 max-w-lg truncate">
          {imageName}
        </p>
      </div>
    </div>
  );
}

import { X, Download } from "lucide-react";

interface LightboxProps {
  imageUrl: string;
  imageName: string;
  onClose: () => void;
}

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
      </div>ntain rounded-lg shadow-2xl select-none"
        />
        <p id="lightbox-image-caption" className="text-sm text-slate-300 font-medium mt-4 text-center px-4 max-w-lg truncate">
          {imageName}
        </p>
      </div>
    </div>
  );
}

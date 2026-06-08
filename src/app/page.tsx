"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { svgToGcode } from "@/lib/gcodeGenerator";
import { processLineArt } from "@/lib/processors/lineArt";
import { processStippling } from "@/lib/processors/stippling";
import { processHatching } from "@/lib/processors/hatching";
import { processCrosshatch } from "@/lib/processors/crosshatch";
import { processSpiral } from "@/lib/processors/spiral";
import { processTypewriter, CHAR_SET_NAMES } from "@/lib/processors/typewriter";
import { processEngraving } from "@/lib/processors/engraving";
import { analyzeImageWithClaude, buildEnhancedSubjectMask } from "@/lib/claudeVision";

type StyleType =
  | "lineArt"
  | "stippling"
  | "hatching"
  | "crosshatch"
  | "spiral"
  | "typewriter"
  | "engraving";

interface StyleOptions {
  lineArt: { numStrokes: number; strokeLength: number; noiseInfluence: number };
  stippling: { numPoints: number; maxRadius: number };
  hatching: { lineSpacing: number; angle: number; threshold: number };
  crosshatch: { lineSpacing: number };
  spiral: { spacing: number; maxDisplacement: number };
  typewriter: { cols: number; contrast: number; brightness: number; charSet: number; invert: number; passes: number };
  engraving: { minSpacing: number; maxSpacing: number };
}

const PAPER_SIZES: Record<string, [number, number]> = {
  A6: [105, 148],
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  Letter: [216, 279],
  Legal: [216, 356],
  Custom: [200, 200],
};

const defaultOptions: StyleOptions = {
  lineArt: { numStrokes: 10000, strokeLength: 14, noiseInfluence: 0.35 },
  stippling: { numPoints: 15000, maxRadius: 3 },
  hatching: { lineSpacing: 8, angle: 45, threshold: 0.7 },
  crosshatch: { lineSpacing: 8 },
  spiral: { spacing: 7, maxDisplacement: 8 },
  typewriter: { cols: 100, contrast: 20, brightness: 0, charSet: 0, invert: 0, passes: 2 },
  engraving: { minSpacing: 2, maxSpacing: 18 },
};

interface StyleDef {
  id: StyleType;
  name: string;
  desc: string;
  icon: string;
}

const styles: StyleDef[] = [
  { id: "lineArt", name: "Line Art", desc: "Flow field density rendering", icon: "LA" },
  { id: "engraving", name: "Engraving", desc: "Outline + horizontal shading", icon: "EN" },
  { id: "stippling", name: "Stippling", desc: "Dot density from brightness", icon: "ST" },
  { id: "hatching", name: "Hatching", desc: "Diagonal line shading", icon: "HA" },
  { id: "crosshatch", name: "Crosshatch", desc: "Multi-angle line layers", icon: "CH" },
  { id: "spiral", name: "Spiral", desc: "Archimedean continuous path", icon: "SP" },
  { id: "typewriter", name: "Typewriter", desc: "Characters mapped by brightness", icon: "TW" },
];

async function processImageClientSide(
  file: File,
  style: string,
  options: Record<string, number>,
  subjectMask?: Uint8Array
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const MAX = 700;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  bitmap.close();

  switch (style) {
    case 'lineArt': return processLineArt(imageData, { ...options, subjectMask });
    case 'engraving': return processEngraving(imageData, options);
    case 'stippling': return processStippling(imageData, options);
    case 'hatching': return processHatching(imageData, options);
    case 'crosshatch': return processCrosshatch(imageData, options);
    case 'spiral': return processSpiral(imageData, options);
    case 'typewriter': return processTypewriter(imageData, options);
    default: throw new Error('Unknown style');
  }
}

async function getImageDataForAnalysis(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const MAX = 700;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return ctx.getImageData(0, 0, w, h);
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="text-xs text-zinc-300 font-mono">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

function StyleIcon({ id }: { id: StyleType }) {
  const size = 28;
  if (id === "lineArt") {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
        <path d="M4 22 C6 18 8 16 10 14 C12 12 13 10 14 8" opacity="0.5"/>
        <path d="M6 24 C8 20 10 17 12 15 C14 13 15 11 16 9" opacity="0.7"/>
        <path d="M8 24 C10 21 12 18 14 16 C16 14 17 12 18 10"/>
        <path d="M11 24 C13 21 15 19 17 17 C19 15 20 13 20 11" opacity="0.8"/>
        <path d="M14 24 C16 22 18 20 20 18 C22 16 22 14 22 12" opacity="0.6"/>
      </svg>
    );
  }
  if (id === "stippling") {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="currentColor">
        <circle cx="7" cy="7" r="1.5" /><circle cx="14" cy="5" r="1" /><circle cx="21" cy="8" r="2" />
        <circle cx="5" cy="14" r="1.2" /><circle cx="11" cy="12" r="2.2" /><circle cx="18" cy="13" r="1.8" /><circle cx="24" cy="11" r="1" />
        <circle cx="8" cy="20" r="2.5" /><circle cx="15" cy="19" r="1.5" /><circle cx="22" cy="21" r="1" />
        <circle cx="4" cy="24" r="1" /><circle cx="12" cy="25" r="1.8" /><circle cx="19" cy="23" r="2" /><circle cx="25" cy="25" r="1.2" />
      </svg>
    );
  }
  if (id === "hatching") {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.2">
        <line x1="4" y1="24" x2="24" y2="4" /><line x1="4" y1="18" x2="18" y2="4" />
        <line x1="4" y1="12" x2="12" y2="4" /><line x1="10" y1="24" x2="24" y2="10" />
        <line x1="16" y1="24" x2="24" y2="16" /><line x1="22" y1="24" x2="24" y2="22" />
      </svg>
    );
  }
  if (id === "crosshatch") {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1">
        <line x1="4" y1="24" x2="24" y2="4" /><line x1="10" y1="24" x2="24" y2="10" /><line x1="16" y1="24" x2="24" y2="16" />
        <line x1="4" y1="4" x2="24" y2="24" /><line x1="4" y1="10" x2="18" y2="24" /><line x1="4" y1="16" x2="12" y2="24" />
        <line x1="7" y1="4" x2="7" y2="24" /><line x1="14" y1="4" x2="14" y2="24" /><line x1="21" y1="4" x2="21" y2="24" />
      </svg>
    );
  }
  if (id === "spiral") {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M14 14 C14 12 16 11 17 12 C19 13 19 16 17 18 C15 20 11 20 9 18 C6 15 6 10 9 7 C12 4 18 4 21 7 C24 11 24 18 21 22" />
      </svg>
    );
  }
  if (id === "engraving") {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1">
        <ellipse cx="14" cy="14" rx="9" ry="11" strokeWidth="1.4"/>
        <line x1="5" y1="9" x2="23" y2="9" />
        <line x1="5" y1="12" x2="23" y2="12" />
        <line x1="5" y1="15" x2="23" y2="15" />
        <line x1="6" y1="18" x2="22" y2="18" />
        <line x1="8" y1="21" x2="20" y2="21" />
      </svg>
    );
  }
  if (id === "typewriter") {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" fill="currentColor">
        <text x="2" y="10" fontSize="7" fontFamily="monospace">MB</text>
        <text x="2" y="17" fontSize="7" fontFamily="monospace">FO</text>
        <text x="2" y="24" fontSize="7" fontFamily="monospace">A .</text>
      </svg>
    );
  }
  const fallback = id as string;
  return <span className="text-xs font-bold">{fallback.slice(0, 2).toUpperCase()}</span>;
}

export default function Home() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<StyleType>("lineArt");
  const [processedSvg, setProcessedSvg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"original" | "preview">("original");
  const [isDragging, setIsDragging] = useState(false);
  const [options, setOptions] = useState<StyleOptions>(defaultOptions);
  const [paperSize, setPaperSize] = useState("A4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [gcodeWidthMm, setGcodeWidthMm] = useState(210);
  const [gcodeHeightMm, setGcodeHeightMm] = useState(297);
  const [gcodeFeedRate, setGcodeFeedRate] = useState(3000);
  const [gcodePenUpCmd, setGcodePenUpCmd] = useState("M3 S0");
  const [gcodePenDownCmd, setGcodePenDownCmd] = useState("M3 S30");

  const [claudeApiKey, setClaudeApiKey] = useState("");
  const [useAiAnalysis, setUseAiAnalysis] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("claude_api_key");
    if (saved) { setClaudeApiKey(saved); setApiKeyInput(saved); }
  }, []);

  const saveApiKey = useCallback(() => {
    const trimmed = apiKeyInput.trim();
    setClaudeApiKey(trimmed);
    if (trimmed) localStorage.setItem("claude_api_key", trimmed);
    else localStorage.removeItem("claude_api_key");
    setShowSettings(false);
  }, [apiKeyInput]);

  const setOpt = useCallback(
    <K extends StyleType>(style: K, key: keyof StyleOptions[K], value: number) => {
      setOptions((prev) => ({
        ...prev,
        [style]: { ...prev[style], [key]: value },
      }));
    },
    []
  );

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file.");
      return;
    }
    setImageFile(file);
    setProcessedSvg(null);
    setError(null);
    setActiveTab("original");
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!imageFile) return;
    setIsProcessing(true);
    setError(null);
    setProcessingStatus("");

    let subjectMask: Uint8Array | undefined;

    try {
      if (useAiAnalysis && claudeApiKey && selectedStyle === "lineArt") {
        setProcessingStatus("Analyzing image with Claude...");
        const imageData = await getImageDataForAnalysis(imageFile);
        const analysis = await analyzeImageWithClaude(imageData, claudeApiKey);
        if (analysis) {
          subjectMask = buildEnhancedSubjectMask(analysis, imageData.width, imageData.height);
        }
      }

      setProcessingStatus("Generating art...");
      const svgText = await processImageClientSide(
        imageFile,
        selectedStyle,
        options[selectedStyle] as Record<string, number>,
        subjectMask
      );
      setProcessedSvg(svgText);
      setActiveTab("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  }, [imageFile, selectedStyle, options, useAiAnalysis, claudeApiKey]);

  const handleDownloadSvg = useCallback(() => {
    if (!processedSvg) return;
    const blob = new Blob([processedSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plotter-${selectedStyle}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [processedSvg, selectedStyle]);

  const handleDownloadGcode = useCallback(() => {
    if (!processedSvg) return;
    const gcode = svgToGcode(processedSvg, {
      widthMm: gcodeWidthMm,
      heightMm: gcodeHeightMm,
      feedRate: gcodeFeedRate,
      penUpCmd: gcodePenUpCmd,
      penDownCmd: gcodePenDownCmd,
    });
    const blob = new Blob([gcode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plotter-${selectedStyle}.gcode`;
    a.click();
    URL.revokeObjectURL(url);
  }, [processedSvg, selectedStyle, gcodeWidthMm, gcodeHeightMm, gcodeFeedRate, gcodePenUpCmd, gcodePenDownCmd]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (paperSize === "Custom") return;
    const [w, h] = PAPER_SIZES[paperSize];
    if (orientation === "portrait") {
      setGcodeWidthMm(w);
      setGcodeHeightMm(h);
    } else {
      setGcodeWidthMm(h);
      setGcodeHeightMm(w);
    }
  }, [paperSize, orientation]);

  const renderOptions = () => {
    switch (selectedStyle) {
      case "lineArt":
        return (
          <div className="flex flex-col gap-3">
            <SliderRow label="Stroke Count" value={options.lineArt.numStrokes} min={2000} max={25000} step={500} onChange={(v) => setOpt("lineArt", "numStrokes", v)} />
            <SliderRow label="Stroke Length" value={options.lineArt.strokeLength} min={6} max={28} step={1} onChange={(v) => setOpt("lineArt", "strokeLength", v)} />
            <SliderRow label="Flow Noise" value={options.lineArt.noiseInfluence} min={0} max={1} step={0.05} onChange={(v) => setOpt("lineArt", "noiseInfluence", v)} />
          </div>
        );
      case "stippling":
        return (
          <div className="flex flex-col gap-3">
            <SliderRow label="Dot Count" value={options.stippling.numPoints} min={3000} max={40000} step={500} onChange={(v) => setOpt("stippling", "numPoints", v)} />
            <SliderRow label="Max Dot Radius" value={options.stippling.maxRadius} min={1} max={5} step={0.1} onChange={(v) => setOpt("stippling", "maxRadius", v)} />
          </div>
        );
      case "hatching":
        return (
          <div className="flex flex-col gap-3">
            <SliderRow label="Line Spacing" value={options.hatching.lineSpacing} min={4} max={16} step={1} onChange={(v) => setOpt("hatching", "lineSpacing", v)} />
            <SliderRow label="Angle (deg)" value={options.hatching.angle} min={0} max={180} step={1} onChange={(v) => setOpt("hatching", "angle", v)} />
            <SliderRow label="Threshold" value={options.hatching.threshold} min={0.3} max={0.9} step={0.01} onChange={(v) => setOpt("hatching", "threshold", v)} />
          </div>
        );
      case "crosshatch":
        return (
          <div className="flex flex-col gap-3">
            <SliderRow label="Line Spacing" value={options.crosshatch.lineSpacing} min={4} max={16} step={1} onChange={(v) => setOpt("crosshatch", "lineSpacing", v)} />
          </div>
        );
      case "spiral":
        return (
          <div className="flex flex-col gap-3">
            <SliderRow label="Spiral Spacing" value={options.spiral.spacing} min={4} max={14} step={0.5} onChange={(v) => setOpt("spiral", "spacing", v)} />
            <SliderRow label="Max Displacement" value={options.spiral.maxDisplacement} min={3} max={14} step={0.5} onChange={(v) => setOpt("spiral", "maxDisplacement", v)} />
          </div>
        );
      case "typewriter":
        return (
          <div className="flex flex-col gap-3">
            <SliderRow label="Columns" value={options.typewriter.cols} min={40} max={180} step={4} onChange={(v) => setOpt("typewriter", "cols", v)} />
            <SliderRow label="Contrast" value={options.typewriter.contrast} min={-80} max={120} step={2} onChange={(v) => setOpt("typewriter", "contrast", v)} />
            <SliderRow label="Brightness" value={options.typewriter.brightness} min={-60} max={60} step={2} onChange={(v) => setOpt("typewriter", "brightness", v)} />
            <SliderRow label="Opt. Passes" value={options.typewriter.passes} min={1} max={5} step={1} onChange={(v) => setOpt("typewriter", "passes", v)} />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Character Set</span>
              <div className="flex flex-wrap gap-1">
                {CHAR_SET_NAMES.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => setOpt("typewriter", "charSet", i)}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${
                      options.typewriter.charSet === i
                        ? "bg-white text-zinc-950 border-white"
                        : "bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              {(["Normal", "Inverted"] as const).map((label, i) => (
                <button
                  key={i}
                  onClick={() => setOpt("typewriter", "invert", i)}
                  className={`flex-1 py-1.5 rounded text-xs font-medium border transition-colors ${
                    options.typewriter.invert === i
                      ? "bg-white text-zinc-950 border-white"
                      : "bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  {i === 0 ? "☀ Normal" : "☾ Inverted"}
                </button>
              ))}
            </div>
          </div>
        );
      case "engraving":
        return (
          <div className="flex flex-col gap-3">
            <SliderRow label="Min Spacing (dark)" value={options.engraving.minSpacing} min={1} max={6} step={1} onChange={(v) => setOpt("engraving", "minSpacing", v)} />
            <SliderRow label="Max Spacing (light)" value={options.engraving.maxSpacing} min={8} max={40} step={1} onChange={(v) => setOpt("engraving", "maxSpacing", v)} />
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Navbar */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <div>
          <h1 className="text-lg font-bold tracking-widest text-white">LINE ART</h1>
          <p className="text-xs text-zinc-500 tracking-wide">Photo to pen plotter converter</p>
        </div>
        <div className="flex-1" />
        {processedSvg && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-zinc-400">Art ready</span>
          </div>
        )}
        {claudeApiKey && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-violet-950 border border-violet-700">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            <span className="text-xs text-violet-300">Claude AI</span>
          </div>
        )}
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="p-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-colors"
          title="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </header>

      {/* Settings panel */}
      {showSettings && (
        <div className="border-b border-zinc-800 bg-zinc-900 px-6 py-5">
          <div className="max-w-lg flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">Claude API Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">Close</button>
            </div>
            <p className="text-xs text-zinc-500">
              Enter your Claude API key to enable AI-enhanced subject detection for Line Art.
              The key is stored only in your browser&apos;s local storage and sent directly to Anthropic.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
              />
              <button
                onClick={saveApiKey}
                className="px-4 py-2 rounded bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors"
              >
                Save
              </button>
              {claudeApiKey && (
                <button
                  onClick={() => { setApiKeyInput(""); setClaudeApiKey(""); localStorage.removeItem("claude_api_key"); setShowSettings(false); }}
                  className="px-4 py-2 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column - controls */}
        <aside className="w-80 flex-shrink-0 border-r border-zinc-800 flex flex-col overflow-y-auto">
          <div className="p-4 flex flex-col gap-5">
            {/* Upload zone */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Image
              </label>
              <div
                className={`relative border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-white bg-zinc-800"
                    : "border-zinc-700 hover:border-zinc-500"
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                {imagePreviewUrl ? (
                  <div className="flex flex-col items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreviewUrl}
                      alt="Uploaded preview"
                      className="max-h-32 max-w-full object-contain rounded"
                    />
                    <span className="text-xs text-zinc-500 truncate max-w-full">
                      {imageFile?.name}
                    </span>
                    <span className="text-xs text-zinc-600">Click to change</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-4">
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 32 32"
                      fill="none"
                      className="text-zinc-600"
                    >
                      <rect
                        x="4"
                        y="4"
                        width="24"
                        height="24"
                        rx="3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M16 10 L16 22 M10 16 L22 16"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="text-sm text-zinc-500">
                      Drop image here
                    </span>
                    <span className="text-xs text-zinc-600">
                      or click to browse
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Style grid */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Style
              </label>
              <div className="grid grid-cols-2 gap-2">
                {styles.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStyle(s.id)}
                    className={`flex flex-col items-start gap-1 p-3 rounded-lg border transition-colors text-left ${
                      selectedStyle === s.id
                        ? "bg-white text-zinc-950 border-white"
                        : "bg-zinc-900 text-zinc-100 border-zinc-800 hover:border-zinc-600"
                    }`}
                  >
                    <div
                      className={`${
                        selectedStyle === s.id ? "text-zinc-950" : "text-zinc-400"
                      }`}
                    >
                      <StyleIcon id={s.id} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold leading-tight">
                        {s.name}
                      </div>
                      <div
                        className={`text-xs leading-tight mt-0.5 ${
                          selectedStyle === s.id
                            ? "text-zinc-500"
                            : "text-zinc-500"
                        }`}
                      >
                        {s.desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Options panel */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Parameters
              </label>
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                {renderOptions()}
              </div>
            </div>

            {/* AI Enhancement toggle — only shown when API key is set and lineArt is selected */}
            {claudeApiKey && selectedStyle === "lineArt" && (
              <button
                onClick={() => setUseAiAnalysis((v) => !v)}
                className={`w-full py-2.5 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-2 ${
                  useAiAnalysis
                    ? "bg-violet-950 border-violet-600 text-violet-200"
                    : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a7 7 0 0 1 7 7 7 7 0 0 1-7 7 7 7 0 0 1-7-7 7 7 0 0 1 7-7z"/>
                  <path d="M12 9v6M9 12h6"/>
                </svg>
                {useAiAnalysis ? "AI Enhanced: ON" : "AI Enhanced: OFF"}
              </button>
            )}

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={!imageFile || isProcessing}
              className={`w-full py-3 rounded-lg font-semibold text-sm tracking-wider transition-colors ${
                !imageFile || isProcessing
                  ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                  : "bg-white text-zinc-950 hover:bg-zinc-200 cursor-pointer"
              }`}
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeOpacity="0.2"
                    />
                    <path
                      d="M12 2 A10 10 0 0 1 22 12"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  {processingStatus || "PROCESSING..."}
                </span>
              ) : (
                "GENERATE"
              )}
            </button>

            {error && (
              <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-xs text-red-300">
                {error}
              </div>
            )}
          </div>
        </aside>

        {/* Main content - preview */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="border-b border-zinc-800 px-4 pt-4 flex items-end gap-1">
            <button
              onClick={() => setActiveTab("original")}
              className={`px-4 py-2 text-sm rounded-t-md transition-colors ${
                activeTab === "original"
                  ? "bg-zinc-900 text-zinc-100 border-t border-l border-r border-zinc-800"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Original
            </button>
            <button
              onClick={() => setActiveTab("preview")}
              disabled={!processedSvg}
              className={`px-4 py-2 text-sm rounded-t-md transition-colors ${
                activeTab === "preview"
                  ? "bg-zinc-900 text-zinc-100 border-t border-l border-r border-zinc-800"
                  : !processedSvg
                  ? "text-zinc-700 cursor-not-allowed"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Art Preview
            </button>
            <div className="flex-1" />
            {processedSvg && activeTab === "preview" && (
              <div className="flex items-center gap-2 pb-2">
                <button
                  onClick={handleDownloadSvg}
                  className="px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 text-zinc-300 rounded hover:bg-zinc-800 transition-colors"
                >
                  Download SVG
                </button>
              </div>
            )}
          </div>

          {/* Preview area */}
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
              {activeTab === "original" ? (
                imagePreviewUrl ? (
                  <div className="max-w-full max-h-full flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreviewUrl}
                      alt="Original"
                      className="max-w-full max-h-[calc(100vh-180px)] object-contain rounded-lg shadow-2xl"
                    />
                  </div>
                ) : (
                  <div className="text-center text-zinc-600">
                    <svg
                      width="64"
                      height="64"
                      viewBox="0 0 64 64"
                      fill="none"
                      className="mx-auto mb-4 opacity-40"
                    >
                      <rect
                        x="8"
                        y="8"
                        width="48"
                        height="48"
                        rx="6"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <circle cx="22" cy="22" r="5" stroke="currentColor" strokeWidth="2" />
                      <path
                        d="M8 42 L20 30 L30 40 L42 26 L56 42"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <p className="text-sm">Upload an image to get started</p>
                  </div>
                )
              ) : processedSvg ? (
                <div className="max-w-full max-h-full flex items-center justify-center p-2">
                  <div
                    className="svg-preview rounded-lg shadow-2xl overflow-hidden"
                    style={{ maxWidth: "100%", maxHeight: "calc(100vh - 200px)" }}
                    dangerouslySetInnerHTML={{ __html: processedSvg }}
                  />
                </div>
              ) : null}
            </div>

            {/* Export panel - right sidebar when art is ready */}
            {processedSvg && (
              <div className="w-64 flex-shrink-0 border-l border-zinc-800 overflow-y-auto">
                <div className="p-4 flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                      Export
                    </label>
                    <button
                      onClick={handleDownloadSvg}
                      className="w-full py-2.5 rounded-lg text-sm font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-colors"
                    >
                      Download SVG
                    </button>
                  </div>

                  <div className="border-t border-zinc-800 pt-4">
                    <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                      G-code Settings
                    </label>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-zinc-500">Paper Size</span>
                        <select
                          value={paperSize}
                          onChange={(e) => setPaperSize(e.target.value)}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                        >
                          {Object.keys(PAPER_SIZES).map((s) => (
                            <option key={s} value={s}>{s === "Custom" ? "Custom" : `${s} (${PAPER_SIZES[s][0]}×${PAPER_SIZES[s][1]}mm)`}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        {(["portrait", "landscape"] as const).map((o) => (
                          <button
                            key={o}
                            onClick={() => setOrientation(o)}
                            className={`flex-1 py-1.5 rounded text-xs font-medium border transition-colors ${orientation === o ? "bg-white text-zinc-950 border-white" : "bg-transparent text-zinc-400 border-zinc-700 hover:border-zinc-500"}`}
                          >
                            {o === "portrait" ? "↕ Portrait" : "↔ Landscape"}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-zinc-500">Width (mm)</span>
                          <input
                            type="number"
                            value={gcodeWidthMm}
                            min={50}
                            max={1000}
                            onChange={(e) => { setPaperSize("Custom"); setGcodeWidthMm(Number(e.target.value)); }}
                            className="w-full"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-zinc-500">Height (mm)</span>
                          <input
                            type="number"
                            value={gcodeHeightMm}
                            min={50}
                            max={1000}
                            onChange={(e) => { setPaperSize("Custom"); setGcodeHeightMm(Number(e.target.value)); }}
                            className="w-full"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-zinc-500">Feed Rate (mm/min)</span>
                        <input
                          type="number"
                          value={gcodeFeedRate}
                          min={100}
                          max={20000}
                          step={100}
                          onChange={(e) => setGcodeFeedRate(Number(e.target.value))}
                          className="w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-zinc-500">Pen Up Command</span>
                        <input
                          type="text"
                          value={gcodePenUpCmd}
                          onChange={(e) => setGcodePenUpCmd(e.target.value)}
                          className="w-full"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-zinc-500">Pen Down Command</span>
                        <input
                          type="text"
                          value={gcodePenDownCmd}
                          onChange={(e) => setGcodePenDownCmd(e.target.value)}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleDownloadGcode}
                    className="w-full py-2.5 rounded-lg text-sm font-semibold bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700 transition-colors"
                  >
                    Download G-code
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

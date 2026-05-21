import { Sliders, HelpCircle, Sparkles, BookOpen } from "lucide-react";
import { ChunkingConfig } from "../types";

interface ChunkingOptionsPanelProps {
  config: ChunkingConfig;
  onChange: (newConfig: ChunkingConfig) => void;
}

export default function ChunkingOptionsPanel({ config, onChange }: ChunkingOptionsPanelProps) {
  const updateField = <K extends keyof ChunkingConfig>(key: K, value: ChunkingConfig[K]) => {
    const updated = { ...config, [key]: value };

    // Enforce safety constraint: overlap must be smaller than size
    if (key === 'size' && typeof value === 'number') {
      if (config.overlap >= value) {
        updated.overlap = Math.max(0, Math.floor(value * 0.2)); // safe default: 20%
      }
    } else if (key === 'overlap' && typeof value === 'number') {
      if (value >= config.size) {
        updated.overlap = Math.max(0, config.size - 1);
      }
    }

    onChange(updated);
  };

  return (
    <div id="chunking-options-container" className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded bg-emerald-50 text-emerald-600">
            <Sliders className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">Paramètres d'Indexation (Chunkeur)</h3>
            <p className="text-gray-400 text-[10px] font-mono">Options de découpage pour le RAG</p>
          </div>
        </div>
        
        {/* Toggle entire chunking config */}
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => updateField('enabled', e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-350 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
          <span className="ml-2 text-xs font-semibold text-gray-700">Activé</span>
        </label>
      </div>

      {!config.enabled ? (
        <div className="flex flex-col items-center justify-center py-6 text-center text-gray-400">
          <BookOpen className="h-8 w-8 stroke-1 mb-2 text-gray-300" />
          <p className="text-xs">Le découpage vectoriel est désactivé.</p>
          <p className="text-[10px] max-w-xs mt-1 leading-normal">
            Le fichier sera exporté d'un seul bloc sans chevauchement. Recommandé pour les petits documents.
          </p>
        </div>
      ) : (
        <div className="space-y-4 animate-fade-in text-gray-700">
          {/* Strategy Selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-650 mb-1.5 flex items-center justify-between">
              <span>Technique de Découpage</span>
              <span className="text-[9px] text-gray-400 font-mono">Strategy</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => updateField('strategy', 'char')}
                className={`py-1.5 px-2 text-xs rounded-lg border font-medium transition ${
                  config.strategy === 'char'
                    ? "border-emerald-500 bg-emerald-50/40 text-emerald-700"
                    : "border-gray-100 hover:bg-gray-55/60 text-gray-600"
                }`}
              >
                Caractères
              </button>
              <button
                type="button"
                onClick={() => updateField('strategy', 'word')}
                className={`py-1.5 px-2 text-xs rounded-lg border font-medium transition ${
                  config.strategy === 'word'
                    ? "border-emerald-500 bg-emerald-50/40 text-emerald-700"
                    : "border-gray-100 hover:bg-gray-55/60 text-gray-600"
                }`}
              >
                Mots
              </button>
              <button
                type="button"
                onClick={() => updateField('strategy', 'paragraph')}
                className={`py-1.5 px-2 text-xs rounded-lg border font-medium transition ${
                  config.strategy === 'paragraph'
                    ? "border-emerald-500 bg-emerald-50/40 text-emerald-700"
                    : "border-gray-100 hover:bg-gray-55/60 text-gray-600"
                }`}
              >
                Paragraphes
              </button>
            </div>
          </div>

          {/* Size & Overlap metrics */}
          <div className="grid grid-cols-2 gap-4">
            {/* Chunk Size */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-650">Taille du segment</span>
                <span className="text-xs font-mono font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">
                  {config.strategy === 'paragraph' ? `${config.size / 100} paragr.` : config.size}
                </span>
              </div>
              <input
                type="range"
                min={config.strategy === 'paragraph' ? 100 : 50}
                max={config.strategy === 'paragraph' ? 500 : 3000}
                step={50}
                value={config.size}
                onChange={(e) => updateField('size', parseInt(e.target.value))}
                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-[9px] text-gray-400 font-mono block mt-1">
                {config.strategy === 'char' ? "Max caractères par bloc" : "Max mots par bloc"}
              </span>
            </div>

            {/* Overlap Size */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-650 flex items-center gap-1">
                  Chevauchement
                  <div className="group relative">
                    <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-48 bg-gray-900 text-white text-[9px] p-2 rounded shadow-lg z-20 font-sans leading-normal">
                      Maintient la continuité sémantique entre les blocs adjacents (évite de couper des phrases à moitié).
                    </div>
                  </div>
                </span>
                <span className="text-xs font-mono font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">
                  {config.strategy === 'paragraph' ? "N/A" : config.overlap}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.floor(config.size * 0.4)}
                step={10}
                disabled={config.strategy === 'paragraph'}
                value={config.overlap}
                onChange={(e) => updateField('overlap', parseInt(e.target.value))}
                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-50"
              />
              <span className="text-[9px] text-gray-400 font-mono block mt-1">
                Friction de continuité
              </span>
            </div>
          </div>

          {/* Metadata Injection */}
          <div className="pt-2 border-t border-gray-50 flex flex-col gap-2.5">
            {/* Inject tags/summary in each chunk metadata */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.addMetadata}
                onChange={(e) => updateField('addMetadata', e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5"
              />
              <div>
                <span className="text-xs font-medium text-gray-700 block leading-none mb-1">
                  Injecter les Métadonnées dans chaque bloc
                </span>
                <span className="text-[10px] text-gray-400 block leading-normal">
                  Insère automatiquement le résumé du fichier et les mots-clés dans l'objet de métadonnées JSON de chaque segment.
                </span>
              </div>
            </label>

            {/* AI keywords/enrichment toggle */}
            <div className="flex items-center gap-1.5 px-3 py-2 rounded bg-amber-50/50 border border-amber-100/55">
              <Sparkles className="h-3.5 w-3.5 text-amber-500 animate-pulse-glow" />
              <div className="text-[10px] text-amber-800 leading-normal">
                <strong>Ingestion propre :</strong> Le découpage sémantique facilite le RAG car le modèle local extrait d'abord un <strong>contexte global</strong> et des <strong>mots-clés</strong> qui enrichiront l'index vectoriel.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

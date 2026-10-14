import React, { useState } from 'react';
import { X, Check } from 'lucide-react';

interface ItemNoteModalProps {
  isOpen: boolean;
  productName: string;
  initialNote: string;
  onClose: () => void;
  onSave: (note: string) => void;
}

export const ItemNoteModal: React.FC<ItemNoteModalProps> = ({
  isOpen,
  productName,
  initialNote,
  onClose,
  onSave,
}) => {
  const [note, setNote] = useState(initialNote);

  if (!isOpen) return null;

  const quickNotes = [
    'Do konvičky',
    'Do misky',
    'Chladnější voda (70°C)',
    'Extra nálev',
    'Bez cukru',
    'S sebou kelímek',
  ];

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-parchment-100 rounded-2xl shadow-2xl border border-parchment-300 w-full max-w-md overflow-hidden flex flex-col">
        <div className="bg-tea-800 text-parchment-50 px-5 py-3.5 flex items-center justify-between">
          <h3 className="font-semibold text-base">Poznámka k přípravě: {productName}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-tea-200 hover:text-white p-1 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="např. do konvičky, ovesné mléko..."
            rows={3}
            className="w-full p-3 rounded-xl border border-parchment-300 focus:border-tea-600 focus:outline-none bg-white text-ink-800 text-sm"
          />

          <div>
            <span className="text-xs font-semibold text-ink-500 block mb-2">Rychlé volby:</span>
            <div className="flex flex-wrap gap-1.5">
              {quickNotes.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setNote((prev) => (prev ? `${prev}, ${preset}` : preset))}
                  className="text-xs bg-white border border-parchment-300 text-ink-700 px-2.5 py-1.5 rounded-lg hover:bg-parchment-200 transition-colors"
                >
                  +{preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-parchment-200/60 px-5 py-3.5 flex justify-end space-x-2 border-t border-parchment-300">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-ink-600 hover:bg-parchment-300/60"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(note);
              onClose();
            }}
            className="flex items-center space-x-1.5 px-4 py-2 text-sm rounded-lg bg-tea-600 text-white font-medium hover:bg-tea-700 shadow-sm"
          >
            <Check className="w-4 h-4" />
            <span>Uložit</span>
          </button>
        </div>
      </div>
    </div>
  );
};

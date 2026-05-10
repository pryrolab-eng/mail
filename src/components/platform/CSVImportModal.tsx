"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload, X, CheckCircle, AlertCircle, Loader2,
  FileText, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface CSVImportModalProps {
  userId: string;
  onClose: () => void;
  onImported: (count: number) => void;
}

interface ColumnMapping {
  [field: string]: number;
}

interface PreviewRow {
  [key: string]: string;
}

const FIELD_OPTIONS = [
  { value: 'company_name', label: 'Company Name *' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'website', label: 'Website' },
  { value: 'niche', label: 'Niche / Industry' },
  { value: 'location', label: 'Location / City' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'notes', label: 'Notes' },
  { value: 'status', label: 'Status' },
  { value: 'ignore', label: '— Ignore this column —' },
];

export default function CSVImportModal({ userId, onClose, onImported }: CSVImportModalProps) {
  const [step, setStep] = useState<'upload' | 'map' | 'importing' | 'done'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    duplicates: number;
    failed: number;
    errors: Array<{ row: number; error: string }>;
  } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseCSVPreview = (content: string) => {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    const parseRow = (line: string): string[] => {
      const row: string[] = [];
      let inQuotes = false;
      let current = '';
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          row.push(current.trim()); current = '';
        } else {
          current += char;
        }
      }
      row.push(current.trim());
      return row;
    };

    const headerRow = parseRow(lines[0]);
    const dataRows = lines.slice(1, 6).map(parseRow); // preview first 5 rows

    const rows: PreviewRow[] = dataRows.map(row => {
      const obj: PreviewRow = {};
      headerRow.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });

    return { headers: headerRow, rows };
  };

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.endsWith('.csv') && !f.name.endsWith('.txt')) {
      toast.error('Please upload a CSV file');
      return;
    }

    setFile(f);
    const content = await f.text();
    const { headers: h, rows } = parseCSVPreview(content);

    if (h.length === 0) {
      toast.error('CSV file appears to be empty');
      return;
    }

    setHeaders(h);
    setPreviewRows(rows);

    // Auto-detect columns
    try {
      const res = await fetch('/api/csv-import', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: h }),
      });
      const data = await res.json();
      if (data.mapping) {
        // Convert index mapping to field mapping
        const fieldMapping: ColumnMapping = {};
        for (const [field, idx] of Object.entries(data.mapping)) {
          fieldMapping[field] = idx as number;
        }
        setMapping(fieldMapping);
      }
    } catch {
      // Auto-detect failed, user will map manually
    }

    setStep('map');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setStep('importing');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mapping', JSON.stringify(mapping));

      const res = await fetch('/api/csv-import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setResult({
        imported: data.imported,
        duplicates: data.duplicates,
        failed: data.failed,
        errors: data.errors || [],
      });
      setStep('done');
      onImported(data.imported);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
      setStep('map');
    } finally {
      setImporting(false);
    }
  };

  const getMappedField = (colIndex: number): string => {
    for (const [field, idx] of Object.entries(mapping)) {
      if (idx === colIndex) return field;
    }
    return 'ignore';
  };

  const setColumnField = (colIndex: number, field: string) => {
    setMapping(prev => {
      const next = { ...prev };
      // Remove this column from any existing mapping
      for (const [f, idx] of Object.entries(next)) {
        if (idx === colIndex) delete next[f];
      }
      // Remove the field from any other column
      if (field !== 'ignore') {
        for (const [f, idx] of Object.entries(next)) {
          if (f === field) delete next[f];
        }
        next[field] = colIndex;
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <Upload size={15} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Import Leads from CSV</h2>
              <p className="text-xs text-gray-500">Apollo, Hunter, LinkedIn, Instantly — any format</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-0 px-6 py-3 bg-gray-50 border-b border-gray-200">
          {[
            { key: 'upload', label: '1. Upload' },
            { key: 'map', label: '2. Map Columns' },
            { key: 'importing', label: '3. Import' },
            { key: 'done', label: '4. Done' },
          ].map(({ key, label }, i) => {
            const steps = ['upload', 'map', 'importing', 'done'];
            const currentIdx = steps.indexOf(step);
            const thisIdx = steps.indexOf(key);
            const isActive = step === key;
            const isDone = thisIdx < currentIdx;
            return (
              <div key={key} className="flex items-center">
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                    style={{
                      background: isActive ? '#2563EB' : isDone ? '#10B981' : '#E5E7EB',
                      color: isActive || isDone ? '#fff' : '#9CA3AF',
                    }}
                  >
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span
                    className="text-[11px] font-medium"
                    style={{ color: isActive ? '#2563EB' : isDone ? '#10B981' : '#9CA3AF' }}
                  >
                    {label}
                  </span>
                </div>
                {i < 3 && <div className="w-8 h-px bg-gray-300 mx-2" />}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div
              className="border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer"
              style={{
                borderColor: dragOver ? '#2563EB' : '#D1D5DB',
                background: dragOver ? '#EFF6FF' : '#F9FAFB',
              }}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
                <FileText size={28} className="text-blue-600" />
              </div>
              <p className="text-base font-semibold text-gray-900 mb-1">
                Drop your CSV file here
              </p>
              <p className="text-sm text-gray-500 mb-4">
                or click to browse — supports Apollo, Hunter, LinkedIn, Instantly exports
              </p>
              <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
                <span>✓ Auto-detects columns</span>
                <span>✓ Deduplicates emails</span>
                <span>✓ Validates emails</span>
              </div>
            </div>
          )}

          {/* Step 2: Map Columns */}
          {step === 'map' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Map CSV Columns</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Columns auto-detected from "{file?.name}". Adjust if needed.
                  </p>
                </div>
                <button
                  onClick={() => { setFile(null); setStep('upload'); }}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  <RefreshCw size={11} />
                  Change file
                </button>
              </div>

              {/* Column mapping table */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        CSV Column
                      </th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Maps To
                      </th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Preview
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {headers.map((header, idx) => {
                      const mappedField = getMappedField(idx);
                      const preview = previewRows[0]?.[header] || '';
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-medium text-gray-700">{header}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <select
                              value={mappedField}
                              onChange={e => setColumnField(idx, e.target.value)}
                              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full max-w-[200px]"
                            >
                              {FIELD_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs text-gray-500 truncate max-w-[120px] block">
                              {preview || '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Preview rows */}
              {previewRows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Data Preview (first 5 rows)</p>
                  <div className="rounded-xl border border-gray-200 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          {headers.map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {previewRows.map((row, i) => (
                          <tr key={i}>
                            {headers.map(h => (
                              <td key={h} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[150px] truncate">
                                {row[h] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
                <Loader2 size={28} className="text-blue-600 animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-gray-900">Importing leads...</p>
                <p className="text-sm text-gray-500 mt-1">
                  Validating emails, checking duplicates, saving to CRM
                </p>
              </div>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && result && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center py-6 gap-3">
                <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center">
                  <CheckCircle size={28} className="text-green-600" />
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold text-gray-900">Import Complete!</p>
                  <p className="text-sm text-gray-500 mt-1">Your leads are now in the CRM</p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Imported', value: result.imported, color: '#10B981', bg: '#D1FAE5' },
                  { label: 'Duplicates', value: result.duplicates, color: '#F59E0B', bg: '#FEF3C7' },
                  { label: 'Failed', value: result.failed, color: '#EF4444', bg: '#FEE2E2' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className="rounded-xl p-4 text-center border border-gray-200" style={{ background: bg }}>
                    <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Errors */}
              {result.errors.length > 0 && (
                <div className="rounded-xl border border-red-200 overflow-hidden">
                  <button
                    onClick={() => setShowErrors(!showErrors)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-red-50 text-sm font-medium text-red-700"
                  >
                    <div className="flex items-center gap-2">
                      <AlertCircle size={14} />
                      {result.errors.length} Import Errors
                    </div>
                    {showErrors ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showErrors && (
                    <div className="max-h-48 overflow-y-auto">
                      {result.errors.map((err, i) => (
                        <div key={i} className="px-4 py-2 border-t border-red-100 text-xs">
                          <span className="font-medium text-red-600">Row {err.row}:</span>
                          <span className="text-gray-600 ml-1">{err.error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>

          {step === 'map' && (
            <button
              onClick={handleImport}
              disabled={!mapping.company_name && !mapping.email}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Upload size={14} />
              Import Leads
            </button>
          )}

          {step === 'done' && (
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
            >
              <CheckCircle size={14} />
              View in CRM
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

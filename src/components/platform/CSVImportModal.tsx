"use client";

import { useState, useRef, useCallback } from "react";
import {
  X,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  Download,
} from "lucide-react";
import { createClient } from "../../../supabase/client";
import { toast } from "sonner";

interface CSVImportModalProps {
  userId: string;
  onClose: () => void;
  onImported: (count: number) => void;
}

// The fields we can map CSV columns to
const LEAD_FIELDS = [
  { key: "company_name", label: "Company Name", required: true },
  { key: "email", label: "Email", required: false },
  { key: "niche", label: "Niche / Industry", required: false },
  { key: "location", label: "Location", required: false },
  { key: "company_context", label: "Company Context / Description", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "source", label: "Source", required: false },
  { key: "__skip__", label: "— Skip this column —", required: false },
] as const;

type LeadFieldKey = (typeof LEAD_FIELDS)[number]["key"];

interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

function parseCSV(text: string): ParsedCSV {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows };
}

/** Try to auto-detect which CSV column maps to which lead field */
function autoDetectMapping(headers: string[]): Record<number, LeadFieldKey> {
  const mapping: Record<number, LeadFieldKey> = {};
  const patterns: { field: LeadFieldKey; patterns: RegExp[] }[] = [
    { field: "company_name", patterns: [/company/i, /business/i, /name/i, /org/i] },
    { field: "email", patterns: [/email/i, /e-mail/i, /mail/i] },
    { field: "niche", patterns: [/niche/i, /industry/i, /category/i, /sector/i, /type/i] },
    { field: "location", patterns: [/location/i, /city/i, /address/i, /region/i, /country/i, /state/i] },
    { field: "company_context", patterns: [/context/i, /description/i, /about/i, /bio/i, /summary/i, /detail/i] },
    { field: "notes", patterns: [/note/i, /comment/i, /remark/i] },
    { field: "source", patterns: [/source/i, /origin/i, /channel/i] },
  ];

  const usedFields = new Set<LeadFieldKey>();

  headers.forEach((header, idx) => {
    for (const { field, patterns: pats } of patterns) {
      if (!usedFields.has(field) && pats.some((p) => p.test(header))) {
        mapping[idx] = field;
        usedFields.add(field);
        break;
      }
    }
    if (mapping[idx] === undefined) {
      mapping[idx] = "__skip__";
    }
  });

  return mapping;
}

export default function CSVImportModal({ userId, onClose, onImported }: CSVImportModalProps) {
  const [step, setStep] = useState<"upload" | "map" | "preview" | "importing" | "done">("upload");
  const [parsed, setParsed] = useState<ParsedCSV | null>(null);
  const [mapping, setMapping] = useState<Record<number, LeadFieldKey>>({});
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [importedCount, setImportedCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Please upload a .csv file");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = parseCSV(text);
      if (result.headers.length === 0) {
        toast.error("CSV file appears to be empty");
        return;
      }
      setParsed(result);
      setMapping(autoDetectMapping(result.headers));
      setStep("map");
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!parsed) return;
    setStep("importing");
    setErrors([]);

    const companyNameIdx = Object.entries(mapping).find(([, v]) => v === "company_name")?.[0];
    if (companyNameIdx === undefined) {
      toast.error("You must map a column to Company Name");
      setStep("map");
      return;
    }

    const leadsToInsert: Record<string, string | null>[] = [];
    const rowErrors: string[] = [];

    parsed.rows.forEach((row, rowIdx) => {
      const lead: Record<string, string | null> = {
        user_id: userId,
        status: "New",
      };

      let hasCompanyName = false;

      Object.entries(mapping).forEach(([colIdxStr, field]) => {
        if (field === "__skip__") return;
        const colIdx = parseInt(colIdxStr);
        const value = row[colIdx]?.trim() || null;
        if (field === "company_name" && value) hasCompanyName = true;
        lead[field] = value;
      });

      if (!hasCompanyName) {
        rowErrors.push(`Row ${rowIdx + 2}: Missing company name — skipped`);
        return;
      }

      leadsToInsert.push(lead);
    });

    if (leadsToInsert.length === 0) {
      setErrors(["No valid rows found. Make sure Company Name column is mapped and not empty."]);
      setStep("map");
      return;
    }

    // Insert in batches of 100
    const BATCH = 100;
    let totalInserted = 0;

    for (let i = 0; i < leadsToInsert.length; i += BATCH) {
      const batch = leadsToInsert.slice(i, i + BATCH);
      const { error } = await supabase.from("leads").insert(batch);
      if (error) {
        rowErrors.push(`Batch ${Math.floor(i / BATCH) + 1} failed: ${error.message}`);
      } else {
        totalInserted += batch.length;
      }
    }

    setImportedCount(totalInserted);
    setErrors(rowErrors);
    setStep("done");
    onImported(totalInserted);
    if (totalInserted > 0) {
      toast.success(`Imported ${totalInserted} lead${totalInserted !== 1 ? "s" : ""} successfully`);
    }
  };

  const previewRows = parsed?.rows.slice(0, 5) ?? [];

  const downloadTemplate = () => {
    const headers = "company_name,email,niche,location,company_context,notes";
    const example = "Acme Corp,contact@acme.com,SaaS,New York,B2B software company,Met at conference";
    const blob = new Blob([headers + "\n" + example], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-bold text-gray-900">Import Leads from CSV</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {step === "upload" && "Upload a CSV file to import leads into your CRM"}
              {step === "map" && `Map CSV columns to lead fields — ${parsed?.rows.length ?? 0} rows detected`}
              {step === "preview" && "Preview the first 5 rows before importing"}
              {step === "importing" && "Importing leads..."}
              {step === "done" && `Import complete — ${importedCount} leads added`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP: Upload */}
          {step === "upload" && (
            <div className="flex flex-col gap-4">
              <div
                className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                  dragActive
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                  <Upload size={22} className="text-blue-600" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-700">
                    Drop your CSV file here
                  </p>
                  <p className="text-xs text-gray-500 mt-1">or click to browse</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <AlertCircle size={15} className="text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700">
                  Your CSV must have a header row. The <strong>company_name</strong> column is required.
                  Other columns (email, niche, location, etc.) are optional.
                </p>
              </div>

              <button
                onClick={downloadTemplate}
                className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 font-medium self-start"
              >
                <Download size={13} />
                Download CSV template
              </button>
            </div>
          )}

          {/* STEP: Map columns */}
          {step === "map" && parsed && (
            <div className="flex flex-col gap-4">
              {errors.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                  {errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">{e}</p>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-500">
                We detected <strong>{parsed.headers.length}</strong> columns. Map each one to a lead field, or skip it.
              </p>

              <div className="flex flex-col gap-2">
                {parsed.headers.map((header, idx) => {
                  const sampleValues = parsed.rows
                    .slice(0, 3)
                    .map((r) => r[idx])
                    .filter(Boolean)
                    .join(", ");

                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">
                          <FileText size={11} className="inline mr-1 text-gray-400" />
                          {header}
                        </p>
                        {sampleValues && (
                          <p className="text-[10px] text-gray-400 truncate mt-0.5">
                            e.g. {sampleValues}
                          </p>
                        )}
                      </div>
                      <div className="relative flex-shrink-0">
                        <select
                          value={mapping[idx] ?? "__skip__"}
                          onChange={(e) =>
                            setMapping((prev) => ({ ...prev, [idx]: e.target.value as LeadFieldKey }))
                          }
                          className="appearance-none pl-3 pr-7 py-1.5 rounded-lg text-xs border border-gray-300 bg-white text-gray-700 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 cursor-pointer"
                        >
                          {LEAD_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={12}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Validation hint */}
              {!Object.values(mapping).includes("company_name") && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-600">
                    You must map at least one column to <strong>Company Name</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP: Preview */}
          {step === "preview" && parsed && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-gray-500">
                Showing first {previewRows.length} of {parsed.rows.length} rows.
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {Object.entries(mapping)
                        .filter(([, v]) => v !== "__skip__")
                        .map(([colIdx, field]) => {
                          const fieldLabel = LEAD_FIELDS.find((f) => f.key === field)?.label ?? field;
                          return (
                            <th
                              key={colIdx}
                              className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap"
                            >
                              {fieldLabel}
                            </th>
                          );
                        })}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIdx) => (
                      <tr
                        key={rowIdx}
                        className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                      >
                        {Object.entries(mapping)
                          .filter(([, v]) => v !== "__skip__")
                          .map(([colIdx]) => (
                            <td
                              key={colIdx}
                              className="px-3 py-2 text-gray-700 max-w-[180px] truncate"
                            >
                              {row[parseInt(colIdx)] || (
                                <span className="text-gray-300 italic">empty</span>
                              )}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP: Importing */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 size={32} className="animate-spin text-blue-600" />
              <p className="text-sm font-medium text-gray-700">
                Importing {parsed?.rows.length} leads...
              </p>
              <p className="text-xs text-gray-400">This may take a moment for large files</p>
            </div>
          )}

          {/* STEP: Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-gray-900">
                  {importedCount} lead{importedCount !== 1 ? "s" : ""} imported
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Your CRM has been updated with the new leads.
                </p>
              </div>
              {errors.length > 0 && (
                <div className="w-full p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-xs font-semibold text-amber-700 mb-1">
                    {errors.length} row{errors.length !== 1 ? "s" : ""} skipped:
                  </p>
                  <div className="max-h-32 overflow-y-auto">
                    {errors.map((e, i) => (
                      <p key={i} className="text-[10px] text-amber-600">{e}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-3">
          {step === "upload" && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <div />
            </>
          )}

          {step === "map" && (
            <>
              <button
                onClick={() => { setStep("upload"); setParsed(null); }}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                ← Back
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep("preview")}
                  disabled={!Object.values(mapping).includes("company_name")}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Preview
                </button>
                <button
                  onClick={handleImport}
                  disabled={!Object.values(mapping).includes("company_name")}
                  className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import {parsed?.rows.length} leads
                </button>
              </div>
            </>
          )}

          {step === "preview" && (
            <>
              <button
                onClick={() => setStep("map")}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleImport}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Import {parsed?.rows.length} leads
              </button>
            </>
          )}

          {step === "done" && (
            <>
              <div />
              <button
                onClick={onClose}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

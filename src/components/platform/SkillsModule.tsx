"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Clock, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

type Skill = {
  id: string;
  name: string;
  version: string;
  description: string;
  trigger: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  rules: string[];
  enabled: boolean;
  markdown?: string | null;
  examples?: unknown;
};

type SkillTrace = {
  skillId?: string;
  tool?: string;
  ok?: boolean;
  confidence?: string;
  warnings?: string[];
  durationMs?: number;
  runId?: string;
  leadId?: string | null;
  startedAt?: string;
};

export default function SkillsModule() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [traces, setTraces] = useState<SkillTrace[]>([]);
  const [selectedId, setSelectedId] = useState<string>("searchWeb");
  const [loading, setLoading] = useState(true);

  const selected = useMemo(
    () => skills.find((skill) => skill.id === selectedId) ?? skills[0],
    [skills, selectedId]
  );
  const selectedTraces = useMemo(
    () =>
      traces
        .filter((trace) => (trace.skillId ?? trace.tool) === selected?.id)
        .slice(0, 8),
    [traces, selected?.id]
  );

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent-skills");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load skills");
      setSkills(data.skills ?? []);
      setTraces(data.traces ?? []);
      if (!selectedId && data.skills?.[0]?.id) setSelectedId(data.skills[0].id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full bg-gray-50">
      <div className="px-6 py-5 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Agent Skills</h2>
            <p className="text-xs text-gray-500">
              Built-in repo skills, read-only rules, and recent execution traces.
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid h-[calc(100%-82px)] grid-cols-[280px_1fr] overflow-hidden">
        <aside className="border-r border-gray-200 bg-white p-3 overflow-y-auto">
          {loading && <p className="p-3 text-sm text-gray-500">Loading skills...</p>}
          {skills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => setSelectedId(skill.id)}
              className={`mb-1.5 w-full rounded-md border px-3 py-2 text-left ${
                selected?.id === skill.id
                  ? "border-blue-200 bg-blue-50"
                  : "border-transparent hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900">{skill.name}</span>
                {skill.enabled ? (
                  <CheckCircle2 size={14} className="text-green-600" />
                ) : (
                  <XCircle size={14} className="text-gray-400" />
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{skill.description}</p>
            </button>
          ))}
        </aside>

        <main className="overflow-y-auto p-5">
          {selected && (
            <div className="space-y-4">
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                      {selected.id} - v{selected.version}
                    </p>
                    <h3 className="mt-1 text-xl font-bold text-gray-900">{selected.name}</h3>
                    <p className="mt-1 text-sm text-gray-600">{selected.description}</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                    <ShieldCheck size={13} />
                    {selected.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <BookOpen size={16} className="text-blue-600" />
                    <h4 className="font-semibold text-gray-900">Rules</h4>
                  </div>
                  <div className="space-y-2">
                    {selected.rules.map((rule) => (
                      <p key={rule} className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        {rule}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <h4 className="mb-3 font-semibold text-gray-900">Interfaces</h4>
                  <div className="grid gap-3">
                    <pre className="max-h-44 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100">
                      {JSON.stringify({ input: selected.inputSchema, output: selected.outputSchema }, null, 2)}
                    </pre>
                    {selected.examples != null && (
                      <pre className="max-h-44 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-gray-700">
                        {String(JSON.stringify(selected.examples, null, 2) ?? "")}
                      </pre>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Clock size={16} className="text-blue-600" />
                  <h4 className="font-semibold text-gray-900">Recent Traces</h4>
                </div>
                {selectedTraces.length === 0 ? (
                  <p className="text-sm text-gray-500">No recent traces for this skill yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedTraces.map((trace, idx) => (
                      <div key={`${trace.runId}-${idx}`} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-gray-900">
                            {trace.ok ? "ok" : "fallback"} - {trace.confidence ?? "unknown"} confidence
                          </span>
                          <span className="text-xs text-gray-500">{trace.durationMs ?? 0}ms</span>
                        </div>
                        {trace.warnings?.length ? (
                          <p className="mt-1 text-xs text-amber-700">{trace.warnings[0]}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-gray-500">
                          {trace.startedAt ? new Date(trace.startedAt).toLocaleString() : "recent run"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

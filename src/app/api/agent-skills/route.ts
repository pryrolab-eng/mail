import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "../../../../supabase/server";
import { listSkills } from "@/utils/skill-registry";

export const runtime = "nodejs";

async function readOptional(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseJsonOptional(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: overrides } = await supabase
    .from("agent_skill_overrides")
    .select("skill_id, enabled, version_pin")
    .eq("user_id", user.id);
  const overrideMap = new Map(
    (overrides ?? []).map((override) => [override.skill_id, override])
  );

  const cwd = process.cwd();
  const skills = await Promise.all(
    listSkills().map(async (skill) => {
      const override = overrideMap.get(skill.id);
      const root = path.join(cwd, "skills", skill.id);
      const [markdown, examples] = await Promise.all([
        readOptional(path.join(root, "SKILL.md")),
        readOptional(path.join(root, "references", "examples.json")),
      ]);
      return {
        ...skill,
        enabled: override?.enabled ?? skill.enabled,
        versionPin: override?.version_pin ?? null,
        markdown,
        examples: parseJsonOptional(examples),
      };
    })
  );

  const { data: runs } = await supabase
    .from("agent_runs")
    .select("id, lead_id, run_type, status, tool_calls, started_at, completed_at")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(10);

  const traces = (runs ?? []).flatMap((run) =>
    ((run.tool_calls as unknown[]) ?? []).map((call) => ({
      ...(call && typeof call === "object" ? call : {}),
      runId: run.id,
      leadId: run.lead_id,
      runType: run.run_type,
      runStatus: run.status,
      startedAt: run.started_at,
    }))
  );

  return NextResponse.json({ skills, traces });
}

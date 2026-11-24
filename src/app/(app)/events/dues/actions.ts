"use server";

import { refresh } from "next/cache";

import { requireUserId } from "@/lib/auth";
import { normalizeStudentNo } from "@/lib/events";
import { UUID } from "@/lib/expense-input";
import { createClient } from "@/lib/supabase/server";

export type DuesResult = { ok: true; added: number; skipped: number } | { ok: false; error: string };

const NO_PERMISSION = "행사 관리 권한이 없어요. 학회장·부학회장에게 권한을 요청해 주세요.";

/**
 * 학회비 납부자 추가 (붙여 넣기·한 명씩 공용, 최대 1000명).
 * 이미 있는 사람은 건너뛴다. 추가되면 DB가 행사 명단의 같은 사람을 납부·면제로 바꾼다.
 */
export async function addDuesPayers(termId: string, people: { name: string; student_no: string }[]): Promise<DuesResult> {
  if (!UUID.test(termId)) return { ok: false, error: "잘못된 요청입니다." };
  if (people.length === 0) return { ok: false, error: "추가할 사람이 없어요." };
  if (people.length > 1000) return { ok: false, error: "한 번에 1000명까지 추가할 수 있어요." };

  const rows: { term_id: string; name: string; student_no: string }[] = [];
  const seen = new Set<string>();
  for (const [i, p] of people.entries()) {
    const name = p.name.replace(/\s+/g, " ").trim();
    const studentNo = normalizeStudentNo(p.student_no);
    if (!name || name.length > 30) return { ok: false, error: `${i + 1}번째 사람: 이름을 1~30자로 입력해 주세요.` };
    if (!studentNo) return { ok: false, error: `${i + 1}번째 사람(${name}): 학번을 22, 24처럼 2자리로 입력해 주세요.` };
    const key = `${name}|${studentNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ term_id: termId, name, student_no: studentNo });
  }

  await requireUserId("/events/dues");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dues_payers")
    .upsert(rows, { onConflict: "term_id,name,student_no", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("학회비 납부자 추가 실패", error);
    return { ok: false, error: NO_PERMISSION };
  }
  refresh();
  const added = data?.length ?? 0;
  return { ok: true, added, skipped: people.length - added };
}

/** 납부자에서 빼면, 학회비로 면제 처리됐던 행사 납부도 되돌아간다 */
export async function removeDuesPayer(id: string): Promise<{ error: string } | null> {
  if (!UUID.test(id)) return { error: "잘못된 요청입니다." };
  await requireUserId("/events/dues");
  const supabase = await createClient();
  const { data, error } = await supabase.from("dues_payers").delete().eq("id", id).select("id");
  if (error) console.error("학회비 납부자 삭제 실패", error);
  if (error || !data || data.length === 0) return { error: NO_PERMISSION };
  refresh();
  return null;
}

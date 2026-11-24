"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import { EVENT_KINDS, normalizeGrade, normalizeStudentNo, paidTotal, type EventKind } from "@/lib/events";
import { todayInSeoul } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type ActionError = { error: string } | null;

const NO_PERMISSION = "행사 관리 권한이 없어요. 학회장·부학회장에게 권한을 요청해 주세요.";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type EventInput = {
  termId: string;
  kind: string;
  name: string;
  startsOn: string;
  endsOn: string;
  place: string;
  fee: number;
  capacity: string;
  formUrl: string;
  extraFields: string[];
  memo: string;
};

export type EventFieldErrors = Partial<Record<keyof EventInput, string>>;

function validateEvent(input: EventInput): EventFieldErrors {
  const e: EventFieldErrors = {};
  if (!UUID.test(input.termId)) e.termId = "학생회를 골라 주세요.";
  if (!EVENT_KINDS.includes(input.kind as EventKind)) e.kind = "행사 종류를 골라 주세요.";
  const name = input.name.trim();
  if (!name) e.name = "행사 이름을 입력해 주세요.";
  else if (name.length > 50) e.name = "50자 이내로 입력해 주세요.";
  if (input.startsOn && !ISO_DATE.test(input.startsOn)) e.startsOn = "날짜를 확인해 주세요.";
  if (input.endsOn && !ISO_DATE.test(input.endsOn)) e.endsOn = "날짜를 확인해 주세요.";
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) e.endsOn = "끝나는 날이 시작일보다 빨라요.";
  if (input.place.trim().length > 100) e.place = "100자 이내로 입력해 주세요.";
  if (!Number.isInteger(input.fee) || input.fee < 0 || input.fee > 100_000_000) e.fee = "참가비를 확인해 주세요.";
  if (input.capacity && !/^\d{1,5}$/.test(input.capacity)) e.capacity = "정원은 숫자로 입력해 주세요.";
  const url = input.formUrl.trim();
  if (url && !/^https:\/\/\S+$/.test(url)) e.formUrl = "https:// 로 시작하는 주소를 넣어 주세요.";
  if (url.length > 500) e.formUrl = "주소가 너무 길어요.";
  if (input.extraFields.length > 10 || input.extraFields.some((f) => f.trim().length === 0 || f.trim().length > 20)) {
    e.extraFields = "추가 칸은 10개까지, 각각 20자 이내로 입력해 주세요.";
  }
  if (input.memo.length > 1000) e.memo = "1000자 이내로 입력해 주세요.";
  return e;
}

function toColumns(input: EventInput) {
  return {
    kind: input.kind,
    name: input.name.trim(),
    starts_on: input.startsOn || null,
    ends_on: input.endsOn || null,
    place: input.place.trim(),
    fee: input.fee,
    capacity: input.capacity ? Number(input.capacity) : null,
    form_url: input.formUrl.trim(),
    extra_fields: [...new Set(input.extraFields.map((f) => f.trim()).filter(Boolean))],
    memo: input.memo.trim(),
  };
}

/** 행사 이름과 같은 지출 분류를 찾고, 없으면 만든다 (행사 = 지출 분류) */
async function ensureCategory(supabase: Awaited<ReturnType<typeof createClient>>, termId: string, name: string) {
  const { data: existing } = await supabase
    .from("categories")
    .select("id")
    .eq("term_id", termId)
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("term_id", termId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: created, error } = await supabase
    .from("categories")
    .insert({ term_id: termId, name, sort_order: (last?.sort_order ?? 0) + 10 })
    .select("id")
    .single();
  if (error) console.error("행사 분류 만들기 실패", error);
  return (created?.id as string | undefined) ?? null;
}

export type EventResult = { ok: true; id: string } | { ok: false; error?: string; fieldErrors?: EventFieldErrors };

export async function createEvent(input: EventInput): Promise<EventResult> {
  const fieldErrors = validateEvent(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const userId = await requireUserId("/events/new");
  const supabase = await createClient();
  const columns = toColumns(input);
  const categoryId = await ensureCategory(supabase, input.termId, columns.name);

  const { data, error } = await supabase
    .from("events")
    .insert({ term_id: input.termId, ...columns, category_id: categoryId, created_by: userId })
    .select("id")
    .single();
  if (error || !data) {
    console.error("행사 만들기 실패", error);
    return { ok: false, error: NO_PERMISSION };
  }
  return { ok: true, id: data.id as string };
}

export async function updateEvent(eventId: string, input: EventInput): Promise<EventResult> {
  if (!UUID.test(eventId)) return { ok: false, error: "잘못된 요청입니다." };
  const fieldErrors = validateEvent(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await requireUserId(`/events/${eventId}`);
  const supabase = await createClient();
  const { data: before } = await supabase.from("events").select("name, category_id, term_id").eq("id", eventId).maybeSingle();
  if (!before) return { ok: false, error: "행사를 찾을 수 없어요." };

  const columns = toColumns(input);
  const { data, error } = await supabase.from("events").update(columns).eq("id", eventId).is("deleted_at", null).select("id");
  if (error) console.error("행사 수정 실패", error);
  if (error || !data || data.length === 0) return { ok: false, error: NO_PERMISSION };

  // 이름이 바뀌면 연결된 지출 분류 이름도 바꾼다 (같은 이름이 이미 있으면 그대로 둔다)
  if (before.category_id && before.name !== columns.name) {
    await supabase.from("categories").update({ name: columns.name }).eq("id", before.category_id);
  }
  refresh();
  return { ok: true, id: eventId };
}

export async function deleteEvent(eventId: string): Promise<ActionError> {
  if (!UUID.test(eventId)) return { error: "잘못된 요청입니다." };
  await requireUserId(`/events/${eventId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("deleted_at", null)
    .select("id, category_id");
  if (error) console.error("행사 삭제 실패", error);
  if (error || !data || data.length === 0) return { error: NO_PERMISSION };

  // 행사를 만들 때 자동으로 생긴 분류는, 지출이 하나도 없고 다른 행사도 안 쓰면 같이 지운다.
  const categoryId = data[0].category_id as string | null;
  if (categoryId) {
    const [{ count: expenseCount }, { count: eventCount }] = await Promise.all([
      supabase.from("expenses").select("id", { count: "exact", head: true }).eq("category_id", categoryId),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("category_id", categoryId)
        .is("deleted_at", null),
    ]);
    if (expenseCount === 0 && eventCount === 0) {
      const { error: catError } = await supabase.from("categories").delete().eq("id", categoryId);
      if (catError) console.error("행사 분류 정리 실패", catError);
    }
  }
  redirect("/events");
}

// ---------------------------------------------------------------------
// 참가자 명단
// ---------------------------------------------------------------------

export type ParticipantInput = {
  name: string;
  studentNo: string;
  grade: string;
  fields: Record<string, string>;
  memo?: string;
};

type ParticipantRow = { name: string; student_no: string; grade: number | null; fields: Record<string, string>; memo: string };
type Checked = { ok: false; error: string } | { ok: true; row: ParticipantRow };

function checkParticipant(p: ParticipantInput): Checked {
  const name = p.name.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "이름을 입력해 주세요." };
  if (name.length > 30) return { ok: false, error: "이름은 30자 이내로 입력해 주세요." };
  const studentNo = normalizeStudentNo(p.studentNo);
  if (!studentNo) return { ok: false, error: "학번을 22, 24처럼 2자리로 입력해 주세요." };
  const grade = p.grade.trim() ? normalizeGrade(p.grade) : null;
  if (p.grade.trim() && grade === null) return { ok: false, error: "학년은 1~6 사이 숫자로 입력해 주세요." };
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.fields)) {
    const value = String(v ?? "").trim();
    if (value) fields[k.slice(0, 20)] = value.slice(0, 100);
  }
  return { ok: true, row: { name, student_no: studentNo, grade, fields, memo: (p.memo ?? "").trim().slice(0, 300) } };
}

export async function addParticipant(eventId: string, input: ParticipantInput): Promise<ActionError> {
  if (!UUID.test(eventId)) return { error: "잘못된 요청입니다." };
  const checked = checkParticipant(input);
  if (!checked.ok) return { error: checked.error };

  const userId = await requireUserId(`/events/${eventId}`);
  const supabase = await createClient();
  const { error } = await supabase.from("event_participants").insert({ event_id: eventId, ...checked.row, created_by: userId });
  if (error) {
    console.error("참가자 추가 실패", error);
    return { error: NO_PERMISSION };
  }
  refresh();
  return null;
}

/** 납부·참석 체크를 바꾼다 */
export async function setParticipantFlag(participantId: string, flag: "paid" | "attended", value: boolean): Promise<ActionError> {
  if (!UUID.test(participantId) || (flag !== "paid" && flag !== "attended")) return { error: "잘못된 요청입니다." };
  await requireUserId("/events");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_participants")
    .update({ [flag]: value })
    .eq("id", participantId)
    .select("id");
  if (error) console.error("체크 변경 실패", error);
  if (error || !data || data.length === 0) return { error: NO_PERMISSION };
  refresh();
  return null;
}

/** 고른 사람들의 납부·참석을 한꺼번에 체크하거나 해제한다 */
export async function setParticipantsFlag(
  eventId: string,
  participantIds: string[],
  flag: "paid" | "attended",
  value: boolean,
): Promise<ActionError> {
  const ids = [...new Set(participantIds)];
  if (!UUID.test(eventId) || (flag !== "paid" && flag !== "attended")) return { error: "잘못된 요청입니다." };
  if (ids.length === 0) return { error: "체크할 사람을 먼저 골라 주세요." };
  if (ids.length > 1000 || !ids.every((id) => UUID.test(id))) return { error: "잘못된 요청입니다." };

  await requireUserId("/events");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_participants")
    .update({ [flag]: value })
    .eq("event_id", eventId)
    .in("id", ids)
    .select("id");
  if (error) console.error("일괄 체크 실패", error);
  if (error || !data || data.length === 0) return { error: NO_PERMISSION };
  refresh();
  return null;
}

export async function updateParticipant(participantId: string, input: ParticipantInput): Promise<ActionError> {
  if (!UUID.test(participantId)) return { error: "잘못된 요청입니다." };
  const checked = checkParticipant(input);
  if (!checked.ok) return { error: checked.error };
  await requireUserId("/events");
  const supabase = await createClient();
  const { data, error } = await supabase.from("event_participants").update(checked.row).eq("id", participantId).select("id");
  if (error) console.error("참가자 수정 실패", error);
  if (error || !data || data.length === 0) return { error: NO_PERMISSION };
  refresh();
  return null;
}

export async function deleteParticipant(participantId: string): Promise<ActionError> {
  if (!UUID.test(participantId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/events");
  const supabase = await createClient();
  const { data, error } = await supabase.from("event_participants").delete().eq("id", participantId).select("id");
  if (error) console.error("참가자 삭제 실패", error);
  if (error || !data || data.length === 0) return { error: NO_PERMISSION };
  refresh();
  return null;
}

export type ImportRowInput = {
  name: string;
  student_no: string;
  grade: number | null;
  fields: Record<string, string>;
  /** 시트에 납부·참석 칸이 있을 때의 값 */
  paid?: boolean;
  attended?: boolean;
};

export type ImportOptions = { allPaid?: boolean; allAttended?: boolean };

/**
 * 붙여 넣은 명단을 한꺼번에 추가 (최대 1000명).
 * 시트의 납부·참석 칸 값이나 '모두 체크' 옵션대로 체크하고, 학회비 납부자는 DB가 알아서 납부·면제로 표시한다.
 */
export async function importParticipants(
  eventId: string,
  rows: ImportRowInput[],
  options: ImportOptions = {},
): Promise<{ ok: true; added: number; exempt: number } | { ok: false; error: string }> {
  if (!UUID.test(eventId)) return { ok: false, error: "잘못된 요청입니다." };
  if (rows.length === 0) return { ok: false, error: "가져올 사람이 없어요." };
  if (rows.length > 1000) return { ok: false, error: "한 번에 1000명까지 가져올 수 있어요." };

  const checked = rows.map((r) =>
    checkParticipant({ name: r.name, studentNo: r.student_no, grade: r.grade ? String(r.grade) : "", fields: r.fields }),
  );
  const bad = checked.findIndex((c) => !c.ok);
  if (bad >= 0) {
    const c = checked[bad];
    return { ok: false, error: `${bad + 1}번째 사람: ${c.ok ? "" : c.error}` };
  }

  const userId = await requireUserId(`/events/${eventId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_participants")
    .insert(
      checked.map((c, i) => ({
        event_id: eventId,
        ...(c.ok ? c.row : {}),
        paid: Boolean(options.allPaid || rows[i].paid),
        attended: Boolean(options.allAttended || rows[i].attended),
        created_by: userId,
      })),
    )
    .select("id, dues_exempt");
  if (error) {
    console.error("명단 가져오기 실패", error);
    return { ok: false, error: NO_PERMISSION };
  }
  refresh();
  return { ok: true, added: data?.length ?? 0, exempt: (data ?? []).filter((r) => r.dues_exempt).length };
}

// ---------------------------------------------------------------------
// 참가비 → 수입
// ---------------------------------------------------------------------

/**
 * 납부한 참가비를 수입으로 기록한다 (결산내역서의 '○○ 별도 납입').
 * 이미 기록했으면 금액을 지금 납부 현황으로 고친다.
 * 입금 문자로 확인된 납부는 이미 수입에 한 건씩 있으니 빼고, 손으로 체크한 납부(현금 등)만 기록한다.
 * 학회비 면제자는 돈을 내지 않았으니 넣지 않는다.
 */
export async function recordFeeIncome(eventId: string): Promise<{ ok: true; amount: number } | { ok: false; error: string }> {
  if (!UUID.test(eventId)) return { ok: false, error: "잘못된 요청입니다." };
  const userId = await requireUserId(`/events/${eventId}`);
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, term_id, kind, name, fee, income_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, error: "행사를 찾을 수 없어요." };

  const { data: participants } = await supabase
    .from("event_participants")
    .select("paid, fields, dues_exempt, paid_income_id")
    .eq("event_id", eventId);
  const totals = paidTotal(
    event.kind as EventKind,
    Number(event.fee),
    (participants ?? []) as { paid: boolean; fields: Record<string, unknown>; dues_exempt: boolean; paid_income_id: string | null }[],
  );
  const count = totals.manualCount;
  const amount = totals.manualAmount;
  if (amount <= 0) {
    return {
      ok: false,
      error:
        totals.depositCount > 0
          ? "납부는 모두 입금 문자로 확인돼서 이미 수입에 들어가 있어요. 따로 기록할 금액이 없어요."
          : "납부한 참가비가 없어요. 명단에서 납부 체크를 먼저 해 주세요.",
    };
  }

  const columns = {
    source: `${event.name} 별도 납입`.slice(0, 50),
    payer: `참가자 ${count}명`,
    amount,
    payment_method: "transfer",
    memo: `행사 관리에서 기록 (참가비 ${Number(event.fee).toLocaleString("ko-KR")}원)`,
  };

  if (event.income_id) {
    const { data, error } = await supabase.from("incomes").update(columns).eq("id", event.income_id).is("deleted_at", null).select("id");
    if (!error && data && data.length > 0) {
      refresh();
      return { ok: true, amount };
    }
  }

  const { data: income, error } = await supabase
    .from("incomes")
    .insert({ term_id: event.term_id, received_on: todayInSeoul(), ...columns, created_by: userId })
    .select("id")
    .single();
  if (error || !income) {
    console.error("참가비 수입 기록 실패", error);
    return { ok: false, error: "수입을 기록하지 못했어요. 수입 관리 권한이 있는지 확인해 주세요." };
  }
  await supabase.from("events").update({ income_id: income.id }).eq("id", eventId);
  refresh();
  return { ok: true, amount };
}

// ---------------------------------------------------------------------
// 입금 확인 필요 → 참가자에게 연결
// ---------------------------------------------------------------------

/** 자동으로 연결하지 못한 입금(동명이인·학번 없음 등)을 참가자에게 직접 연결해 납부 체크한다 */
export async function assignDeposit(incomeId: string, participantId: string): Promise<ActionError> {
  if (!UUID.test(incomeId) || !UUID.test(participantId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/events");
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_deposit", { p_income_id: incomeId, p_participant_id: participantId });
  if (error) {
    console.error("입금 연결 실패", error);
    return { error: /[가-힣]/.test(error.message) ? error.message : "입금을 연결하지 못했어요." };
  }
  refresh();
  return null;
}

import React, { useEffect, useState } from "react";
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection } from "firebase/firestore";
import { X, Loader2 } from "lucide-react";
import { db } from "./firebase";

// Operator accounts. The new operator email must be a verified account (Google sign-in),
// otherwise anyone could sign up with that address by email/password and get operator access.
export const DEFAULT_BANK_INFO = "새마을금고 9003-2378-7668-0\n예금주 김형신"; // used until the operator saves another one
export const KAKAO_URL = "https://open.kakao.com/o/suBuN0Ti";
const OPERATORS = [
  { email: "goldriver365@gmail.com", needVerified: true },
  { email: "higidia@gmail.com", needVerified: false }, // legacy operator account
];
export function isOperatorEmail(email) { return OPERATORS.some((o) => o.email === email); }
export function isPlatformOperator(user) {
  if (!user || user.isAnonymous || !user.email) return false;
  const o = OPERATORS.find((x) => x.email === user.email);
  return !!o && (!o.needVerified || user.emailVerified === true);
}
export const TRIAL_DAYS = 7;
export const MONTHLY_LIMIT = 300;
export const PLANS = {
  basic: { label: "기본 (월 300장 미만)", month: 5000, year: 50000 },
  plus: { label: "300장 이상 (무제한)", month: 10000, year: 100000 },
};
const DAY = 86400000;
const fmt = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const won = (n) => n.toLocaleString("ko-KR") + "원";

// Per-store status. store = {name, paidUntil, tier}; company supplies the 7-day trial.
// state: exempt | paid | trial | expired. The 300/month limit applies to basic tier (trial included).
export function computeStatus(store, company, isPlatformOwner, monthCount) {
  const now = Date.now();
  if (isPlatformOwner) return { state: "exempt", canAdd: true };
  const tier = store?.tier === "plus" ? "plus" : "basic";
  const overLimit = tier === "basic" && monthCount >= MONTHLY_LIMIT;
  if ((store?.paidUntil || 0) > now) {
    return { state: "paid", tier, until: store.paidUntil, daysLeft: Math.ceil((store.paidUntil - now) / DAY), overLimit, canAdd: !overLimit };
  }
  const trialEnd = ((company && company.trialStartedAt) || now) + TRIAL_DAYS * DAY;
  if (trialEnd > now) return { state: "trial", tier, until: trialEnd, daysLeft: Math.ceil((trialEnd - now) / DAY), overLimit, canAdd: !overLimit };
  return { state: "expired", tier, until: Math.max(trialEnd, store?.paidUntil || 0), canAdd: false };
}

// Summarise several stores into one banner status.
export function summarize(list) {
  // list: [{name, st}]
  const expired = list.filter((x) => x.st.state === "expired");
  const over = list.filter((x) => x.st.overLimit && x.st.state !== "expired");
  if (list.length && list.every((x) => x.st.state === "exempt")) return { kind: "exempt" };
  if (expired.length) return { kind: "expired", names: expired.map((x) => x.name) };
  if (over.length) return { kind: "over", names: over.map((x) => x.name) };
  const trial = list.filter((x) => x.st.state === "trial");
  if (trial.length) return { kind: "trial", daysLeft: Math.min(...trial.map((x) => x.st.daysLeft)) };
  const soon = list.filter((x) => x.st.state === "paid").sort((a, b) => a.st.until - b.st.until)[0];
  if (soon && soon.st.daysLeft <= 7) return { kind: "soon", name: soon.name, until: soon.st.until, daysLeft: soon.st.daysLeft };
  return { kind: "ok" };
}

export function BillingBanner({ summary, onOpen }) {
  let text, bg = "#2f4f3f";
  if (!summary || summary.kind === "exempt" || summary.kind === "ok") return null;
  if (summary.kind === "trial") text = `무료 체험 중 · ${summary.daysLeft}일 남음`;
  else if (summary.kind === "soon") { text = `${summary.name} 이용 기간 ${fmt(summary.until)}까지 (${summary.daysLeft}일 남음)`; bg = "#b9770e"; }
  else if (summary.kind === "over") { text = `${summary.names.join(", ")}: 이번 달 영수증 ${MONTHLY_LIMIT}장 도달 - 등록이 막혔습니다 (300장 이상 요금제 필요)`; bg = "#b03a2e"; }
  else { text = `${summary.names.join(", ")}: 이용 기간이 끝나 등록·판독이 막혔습니다 (조회만 가능)`; bg = "#b03a2e"; }
  return (
    <div onClick={onOpen} style={{ background: bg, color: "#fff", fontSize: 13, padding: "8px 12px", textAlign: "center", cursor: "pointer" }}>
      {text} <u style={{ marginLeft: 6 }}>요금 안내</u>
    </div>
  );
}

export function BillingModal({ list, billing, company, onClose, welcome }) {
  const [copied, setCopied] = useState(false);
  const bankInfo = billing?.bankInfo || DEFAULT_BANK_INFO;
  const vat = (n) => Math.round(n * 1.1);
  const tierLine = (k) => `${PLANS[k].label}: 월 ${won(PLANS[k].month)} / 연 ${won(PLANS[k].year)} (부가세 별도)`;
  const tierPay = (k) => `${PLANS[k].label}: 월 ${won(vat(PLANS[k].month))} / 연 ${won(vat(PLANS[k].year))}`;
  const stLabel = (st) =>
    st.state === "exempt" ? "무료(운영자)" :
    st.state === "paid" ? `이용 중 ~${fmt(st.until)} (${st.daysLeft}일 남음)${st.overLimit ? " · 이번 달 300장 도달" : ""}` :
    st.state === "trial" ? `무료 체험 ~${fmt(st.until)} (${st.daysLeft}일 남음)${st.overLimit ? " · 300장 도달" : ""}` :
    "이용 기간 종료";
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1500, alignItems: "center" }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ borderRadius: 16, maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>이용 요금 안내 (매장별)</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>
        {welcome && (
          <div style={{ background: "#e8f1ff", color: "#0B3FA8", padding: "10px 12px", borderRadius: 8, fontSize: 14, lineHeight: 1.6, marginBottom: 10 }}>
            <b>가입을 환영합니다!</b><br />
            지금부터 {TRIAL_DAYS}일 동안 무료로 사용하실 수 있습니다. 무료 기간이 끝나면 아래 요금으로 이용해 주세요.
          </div>
        )}
        {list.some((x) => x.st.state === "expired") && (
          <div style={{ background: "#fdecea", color: "#b03a2e", padding: "8px 10px", borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
            이용 기간이 끝나 등록·판독이 제한되었습니다. 아래 계좌로 입금해 주시면 확인 후 바로 연장해 드립니다.
          </div>
        )}
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>
          <b>가입 후 {TRIAL_DAYS}일 무료 체험 · 요금은 매장 1곳 기준</b>
          <div style={{ margin: "8px 0" }}>
            · {tierLine("basic")}<br />
            · {tierLine("plus")}
          </div>
          <div style={{ fontSize: 13, background: "rgba(0,0,0,0.05)", borderRadius: 8, padding: "8px 10px" }}>
            <b>입금하실 금액 (부가세 10% 포함)</b><br />
            · {tierPay("basic")}<br />
            · {tierPay("plus")}
          </div>
          <div style={{ fontSize: 13 }}>
            · 결제 후 1개월(또는 1년)이 지나면 해당 매장은 자동으로 등록·판독이 막힙니다(조회·ZIP 다운로드는 가능).<br />
            · 가입 후 1개월이 지나도 유료 이용(입금)이 없으면 등록하신 이메일로 안내 메일을 보내며, 메일 발송 후 7일 안에 입금이 확인되지 않으면 모든 자료와 계정이 자동 삭제됩니다.<br />
            · 한 매장의 한 달 영수증이 300장에 도달하면 기본 요금제는 등록이 막히고, 300장 이상 요금제로 바꾸면 계속 등록됩니다.
          </div>
          <div style={{ margin: "10px 0" }}>
            {list.map((x) => (
              <div key={x.name} style={{ padding: "4px 0", borderTop: "1px dashed rgba(0,0,0,0.2)" }}>
                <b>{x.name}</b> · {x.st.state === "exempt" ? "" : (x.st.tier === "plus" ? "300장 이상" : "기본")} {stLabel(x.st)}
              </div>
            ))}
            {list.length === 0 && <div>등록된 매장이 없습니다</div>}
          </div>
          <div style={{ marginTop: 12, padding: 12, background: "#fff7e0", border: "2px solid #e0b43c", borderRadius: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>입금 계좌</div>
            <div style={{ fontSize: 17, fontWeight: 700, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {bankInfo}
            </div>
            {bankInfo && (
              <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => { try { navigator.clipboard.writeText(bankInfo); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { /* ignore */ } }}>
                {copied ? "복사되었습니다" : "계좌 복사"}
              </button>
            )}
            <div style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>
              입금자명에 <b>회사명</b>을 적고, 연장할 <b>매장명</b>을 카카오톡으로 알려 주세요{company?.companyName ? ` (${company.companyName})` : ""}.<br />
              입금 확인 후 바로 이용 기간이 연장됩니다.
              세금계산서 발행을 원하시면 카카오톡으로 <b>사업자등록번호</b>를 보내 주세요.
            </div>
          </div>
          <a href={KAKAO_URL} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", textAlign: "center", marginTop: 12, padding: "11px 10px", borderRadius: 10, background: "#FEE500", color: "#191919", fontWeight: 700, textDecoration: "none" }}>
            카카오톡으로 문의하기
          </a>
        </div>
        <button className="btn-secondary" style={{ width: "100%", marginTop: 12 }} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

function addPeriod(base, unit) {
  const d = new Date(base);
  if (unit === "year") d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}


// delete every doc in a collection that passes the filter (runs in small parallel groups)
async function deleteDocsWhere(colRef, filterFn = () => true) {
  const snap = await getDocs(colRef);
  const targets = snap.docs.filter((d) => filterFn(d.data(), d));
  for (let i = 0; i < targets.length; i += 20) {
    await Promise.all(targets.slice(i, i + 20).map((d) => deleteDoc(d.ref)));
  }
  return targets.map((d) => d.id);
}

export function PlatformAdminPanel({ billing }) {
  const [companies, setCompanies] = useState(null);
  const [tiers, setTiers] = useState({});
  const [bank, setBank] = useState(billing?.bankInfo || DEFAULT_BANK_INFO);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const snap = await getDocs(collection(db, "companies"));
    const list = await Promise.all(snap.docs.map(async (d) => {
      let stores = [];
      try {
        const cs = await getDoc(doc(db, "companies", d.id, "config", "store"));
        stores = cs.exists() ? (cs.data().stores || []) : [];
      } catch (e) { /* ignore */ }
      return { id: d.id, ...d.data(), stores };
    }));
    setCompanies(list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  };
  useEffect(() => { load().catch((e) => setMsg("불러오기 실패: " + e.message)); }, []);
  useEffect(() => { setBank(billing?.bankInfo || DEFAULT_BANK_INFO); }, [billing]);

  const saveBilling = async () => {
    await setDoc(doc(db, "config", "billing"), { bankInfo: bank }, { merge: true });
    setMsg("입금 안내를 저장했습니다");
  };
  const updateStore = async (c, storeName, patchFn) => {
    const stores = c.stores.map((s) => (s.name === storeName ? { ...s, ...patchFn(s) } : s));
    await setDoc(doc(db, "companies", c.id, "config", "store"), { stores }, { merge: true });
    await load();
  };
  const extend = async (c, s, unit) => {
    const key = c.id + "__" + s.name;
    const tier = tiers[key] || s.tier || "basic";
    await updateStore(c, s.name, (cur) => ({ paidUntil: addPeriod(Math.max(Date.now(), cur.paidUntil || 0), unit), tier }));
    setMsg(`${c.companyName || c.email} / ${s.name}: ${unit === "year" ? "1년" : "1개월"} 연장했습니다`);
  };
  const clearPaid = async (c, s) => {
    if (!window.confirm(`${s.name}의 유료 기간을 해제할까요?`)) return;
    await updateStore(c, s.name, () => ({ paidUntil: 0 }));
  };
  // remove one store from a company, optionally with all of its data
  const deleteStore = async (c, s) => {
    if (!window.confirm(`[${c.companyName || c.email}] 의 매장 "${s.name}"을(를) 삭제할까요?\n\n이 매장의 영수증·사진·매출·후불 입금 자료도 모두 함께 삭제되며 복구할 수 없습니다.`)) return;
    try {
      const base = ["companies", c.id];
      const ids = await deleteDocsWhere(collection(db, ...base, "receipts"), (x) => x.store === s.name);
      await Promise.all(ids.map((id) => deleteDoc(doc(db, ...base, "photos", id)).catch(() => {})));
      await deleteDocsWhere(collection(db, ...base, "sales"), (x) => x.store === s.name);
      await deleteDocsWhere(collection(db, ...base, "vendorPayments"), (x) => x.store === s.name);
      const stores = c.stores.filter((x) => x.name !== s.name);
      await setDoc(doc(db, "companies", c.id, "config", "store"), { stores }, { merge: true });
      setMsg(`${c.companyName || c.email} / ${s.name} 매장을 삭제했습니다`);
      await load();
    } catch (e) { console.error(e); setMsg("삭제 실패: " + (e.message || "")); }
  };

  // remove a whole member company (all data). The login account itself stays in Firebase Auth.
  const deleteCompany = async (c) => {
    if (isOperatorEmail(c.email)) { window.alert("운영자 계정의 회사는 삭제할 수 없습니다."); return; }
    const name = c.companyName || c.email;
    const typed = window.prompt(`회사 "${name}"의 모든 자료(매장·영수증·사진·매출·입금·보관함)를 삭제합니다. 복구할 수 없습니다.\n\n계속하려면 회사명을 똑같이 입력하세요.`);
    if (typed === null) return;
    if (typed.trim() !== name) { window.alert("회사명이 일치하지 않아 취소했습니다."); return; }
    try {
      const base = ["companies", c.id];
      for (const col of ["receipts", "sales", "vendorPayments", "photos"]) await deleteDocsWhere(collection(db, ...base, col));
      const arch = await getDocs(collection(db, ...base, "taxArchives"));
      for (const d of arch.docs) {
        await deleteDocsWhere(collection(d.ref, "chunks"));
        await deleteDoc(d.ref);
      }
      await deleteDocsWhere(collection(db, ...base, "config"));
      if (c.companyCode) await deleteDoc(doc(db, "companyCodes", c.companyCode)).catch(() => {});
      await deleteDoc(doc(db, "companies", c.id));
      setMsg(`${name} 회사를 삭제했습니다`);
      await load();
    } catch (e) { console.error(e); setMsg("삭제 실패: " + (e.message || "")); }
  };

  const toggleProtected = async (c) => {
    await setDoc(doc(db, "companies", c.id), { protected: !(c.protected === true) }, { merge: true });
    await load();
  };
  const extendTrial = async (c) => {
    await setDoc(doc(db, "companies", c.id), { trialStartedAt: (c.trialStartedAt || Date.now()) + 7 * DAY }, { merge: true });
    await load();
  };

  return (
    <div>
      <div className="tape-card" style={{ padding: 16 }}>
        <h3 style={{ margin: "0 0 10px" }}>입금 안내 문구 (회원에게 표시)</h3>
        <textarea value={bank} onChange={(e) => setBank(e.target.value)} rows={3} placeholder="예) 농협 000-0000-0000-00 홍길동" style={{ width: "100%", boxSizing: "border-box" }} />
        <button className="btn-primary" style={{ marginTop: 8 }} onClick={saveBilling}>저장</button>
        {msg && <div style={{ fontSize: 13, marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="tape-card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ margin: "0 0 10px" }}>회원사·매장별 이용 관리</h3>
        {!companies && <div><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> 불러오는 중...</div>}
        {companies && companies.length === 0 && <div>가입한 회사가 없습니다</div>}
        {companies && companies.map((c) => {
          const owner = isOperatorEmail(c.email);
          return (
            <div key={c.id} style={{ borderTop: "1px dashed rgba(0,0,0,0.2)", padding: "10px 0", fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{c.companyName || "(이름 없음)"} <span style={{ fontWeight: 400, opacity: 0.7 }}>{c.email}</span></div>
              <div style={{ opacity: 0.8 }}>
                가입 {c.createdAt ? fmt(c.createdAt) : "-"} · 체험 ~{fmt((c.trialStartedAt || c.createdAt || Date.now()) + TRIAL_DAYS * DAY)}
                {owner ? " · 운영자(무료)" : ""}
                <button className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => extendTrial(c)}>체험 +7일</button>
                {!owner && <button className="btn-secondary" style={{ marginLeft: 6, color: "#b03a2e" }} onClick={() => deleteCompany(c)}>회사 삭제</button>}
                {!owner && (
                  <label style={{ marginLeft: 8, whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={c.protected === true} onChange={() => toggleProtected(c)} /> 자동삭제 제외
                  </label>
                )}
                {c.deletionWarnedAt && <div style={{ color: "#b03a2e", marginTop: 4 }}>미결제 안내 메일 발송 {fmt(c.deletionWarnedAt)} → {fmt(c.deletionWarnedAt + 7 * DAY)} 이후 자동 삭제</div>}
              </div>
              {c.stores.length === 0 && <div style={{ opacity: 0.7, marginTop: 4 }}>등록된 매장 없음</div>}
              {c.stores.map((s) => {
                const key = c.id + "__" + s.name;
                const st = computeStatus(s, c, owner, 0);
                const label = st.state === "exempt" ? "무료" : st.state === "paid" ? `유료 ~${fmt(st.until)}` : st.state === "trial" ? "체험 중" : "만료";
                return (
                  <div key={key} style={{ marginTop: 8, paddingLeft: 8, borderLeft: "3px solid rgba(0,0,0,0.15)" }}>
                    <b>{s.name}</b> · {label} · {s.tier === "plus" ? "300장 이상" : "기본"}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
                      <select value={tiers[key] || s.tier || "basic"} onChange={(e) => setTiers({ ...tiers, [key]: e.target.value })}>
                        <option value="basic">기본 (5,000/월, 부가세 별도)</option>
                        <option value="plus">300장 이상 (10,000/월, 부가세 별도)</option>
                      </select>
                      <button className="btn-secondary" onClick={() => extend(c, s, "month")}>+1개월</button>
                      <button className="btn-secondary" onClick={() => extend(c, s, "year")}>+1년</button>
                      <button className="btn-secondary" onClick={() => clearPaid(c, s)}>유료 해제</button>
                      {!owner && <button className="btn-secondary" style={{ color: "#b03a2e" }} onClick={() => deleteStore(c, s)}>매장 삭제</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

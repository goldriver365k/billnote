import React, { useEffect, useState } from "react";
import { doc, getDocs, setDoc, collection } from "firebase/firestore";
import { X, Loader2 } from "lucide-react";
import { db } from "./firebase";

export const PLATFORM_ADMIN_EMAIL = "higidia@gmail.com";
export const TRIAL_DAYS = 7;
export const MONTHLY_LIMIT = 300;
export const PLANS = {
  basic: { label: "기본 (월 300장 이하)", month: 5000, year: 50000 },
  plus: { label: "300장 초과 (무제한)", month: 10000, year: 100000 },
};
const DAY = 86400000;
const fmt = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const won = (n) => n.toLocaleString("ko-KR") + "원";

// state: exempt | paid | trial | expired
export function computeStatus(company, isPlatformOwner, monthCount) {
  const now = Date.now();
  if (isPlatformOwner) return { state: "exempt", canAdd: true };
  if (!company) return { state: "trial", canAdd: true, daysLeft: TRIAL_DAYS };
  const tier = company.tier === "plus" ? "plus" : "basic";
  if ((company.paidUntil || 0) > now) {
    const overLimit = tier === "basic" && monthCount >= MONTHLY_LIMIT;
    return { state: "paid", tier, until: company.paidUntil, daysLeft: Math.ceil((company.paidUntil - now) / DAY), overLimit, canAdd: !overLimit };
  }
  const trialEnd = (company.trialStartedAt || now) + TRIAL_DAYS * DAY;
  if (trialEnd > now) return { state: "trial", until: trialEnd, daysLeft: Math.ceil((trialEnd - now) / DAY), canAdd: true };
  return { state: "expired", until: Math.max(trialEnd, company.paidUntil || 0), canAdd: false };
}

export function BillingBanner({ status, onOpen }) {
  if (status.state === "exempt") return null;
  let text, bg = "#2f4f3f", color = "#fff";
  if (status.state === "trial") text = `무료 체험 중 · ${status.daysLeft}일 남음`;
  else if (status.state === "paid") {
    if (status.overLimit) { text = `이번 달 영수증 ${MONTHLY_LIMIT}장을 넘었습니다 - 등록이 제한됩니다. 300장 초과 요금제가 필요합니다`; bg = "#b03a2e"; }
    else if (status.daysLeft <= 7) { text = `이용 기간 ${fmt(status.until)}까지 (${status.daysLeft}일 남음)`; bg = "#b9770e"; }
    else return null;
  } else { text = "무료 체험이 끝났습니다 - 조회만 가능하고 등록·판독은 제한됩니다"; bg = "#b03a2e"; }
  return (
    <div onClick={onOpen} style={{ background: bg, color, fontSize: 13, padding: "8px 12px", textAlign: "center", cursor: "pointer" }}>
      {text} <u style={{ marginLeft: 6 }}>요금 안내</u>
    </div>
  );
}

export function BillingModal({ status, billing, company, onClose }) {
  const tierLine = (k) => `${PLANS[k].label}: 월 ${won(PLANS[k].month)} / 연 ${won(PLANS[k].year)}`;
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1500, alignItems: "center" }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ borderRadius: 16, maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>이용 요금 안내</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>
          <b>가입 후 {TRIAL_DAYS}일 무료 체험</b>
          <div style={{ margin: "8px 0" }}>
            · {tierLine("basic")}<br />
            · {tierLine("plus")}
          </div>
          {status.state === "trial" && <div>무료 체험 {status.daysLeft}일 남음 (~{fmt(status.until)})</div>}
          {status.state === "paid" && <div>이용 기간 ~{fmt(status.until)} · {PLANS[status.tier].label}</div>}
          {status.state === "expired" && <div style={{ color: "var(--stamp)" }}>체험/이용 기간이 끝났습니다. 조회와 ZIP 다운로드는 가능하고, 영수증 등록·판독·매출 입력은 제한됩니다.</div>}
          <div style={{ marginTop: 12, padding: 10, background: "rgba(0,0,0,0.05)", borderRadius: 8, whiteSpace: "pre-wrap" }}>
            <b>입금 안내</b>{"\n"}
            {billing?.bankInfo || "입금 계좌는 운영자에게 문의해 주세요."}
            {"\n"}입금자명에 회사명을 적어 주세요{company?.companyName ? ` (${company.companyName})` : ""}.
            {"\n"}입금 확인 후 이용 기간이 연장됩니다.
            {billing?.contact ? `\n문의: ${billing.contact}` : ""}
          </div>
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

export function PlatformAdminPanel({ billing }) {
  const [companies, setCompanies] = useState(null);
  const [tiers, setTiers] = useState({});
  const [bank, setBank] = useState(billing?.bankInfo || "");
  const [contact, setContact] = useState(billing?.contact || "");
  const [msg, setMsg] = useState("");

  const load = async () => {
    const snap = await getDocs(collection(db, "companies"));
    setCompanies(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  };
  useEffect(() => { load().catch((e) => setMsg("불러오기 실패: " + e.message)); }, []);
  useEffect(() => { setBank(billing?.bankInfo || ""); setContact(billing?.contact || ""); }, [billing]);

  const saveBilling = async () => {
    await setDoc(doc(db, "config", "billing"), { bankInfo: bank, contact }, { merge: true });
    setMsg("입금 안내를 저장했습니다");
  };
  const extend = async (c, unit) => {
    const tier = tiers[c.id] || c.tier || "basic";
    const base = Math.max(Date.now(), c.paidUntil || 0);
    await setDoc(doc(db, "companies", c.id), { paidUntil: addPeriod(base, unit), tier }, { merge: true });
    setMsg(`${c.companyName || c.email}: ${unit === "year" ? "1년" : "1개월"} 연장했습니다`);
    load();
  };
  const extendTrial = async (c) => {
    await setDoc(doc(db, "companies", c.id), { trialStartedAt: (c.trialStartedAt || Date.now()) + 7 * DAY }, { merge: true });
    load();
  };
  const clearPaid = async (c) => {
    if (!window.confirm(`${c.companyName || c.email}의 유료 기간을 해제할까요?`)) return;
    await setDoc(doc(db, "companies", c.id), { paidUntil: 0 }, { merge: true });
    load();
  };

  return (
    <div>
      <div className="tape-card" style={{ padding: 16 }}>
        <h3 style={{ margin: "0 0 10px" }}>입금 안내 문구 (회원에게 표시)</h3>
        <textarea value={bank} onChange={(e) => setBank(e.target.value)} rows={3} placeholder="예) 농협 000-0000-0000-00 홍길동" style={{ width: "100%", boxSizing: "border-box" }} />
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="문의 연락처 (선택)" style={{ width: "100%", boxSizing: "border-box", marginTop: 6 }} />
        <button className="btn-primary" style={{ marginTop: 8 }} onClick={saveBilling}>저장</button>
        {msg && <div style={{ fontSize: 13, marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="tape-card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ margin: "0 0 10px" }}>회원사 관리</h3>
        {!companies && <div><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> 불러오는 중...</div>}
        {companies && companies.length === 0 && <div>가입한 회사가 없습니다</div>}
        {companies && companies.map((c) => {
          const st = computeStatus(c, c.email === PLATFORM_ADMIN_EMAIL, 0);
          const label = st.state === "exempt" ? "운영자(무료)" : st.state === "paid" ? `유료 ~${fmt(st.until)}` : st.state === "trial" ? `체험 ~${fmt(st.until)}` : "만료";
          return (
            <div key={c.id} style={{ borderTop: "1px dashed rgba(0,0,0,0.2)", padding: "10px 0", fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{c.companyName || "(이름 없음)"} <span style={{ fontWeight: 400, opacity: 0.7 }}>{c.email}</span></div>
              <div style={{ opacity: 0.8 }}>가입 {c.createdAt ? fmt(c.createdAt) : "-"} · {label} · {c.tier === "plus" ? "300장 초과" : "기본"}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                <select value={tiers[c.id] || c.tier || "basic"} onChange={(e) => setTiers({ ...tiers, [c.id]: e.target.value })}>
                  <option value="basic">기본 (5,000/월)</option>
                  <option value="plus">300장 초과 (10,000/월)</option>
                </select>
                <button className="btn-secondary" onClick={() => extend(c, "month")}>+1개월</button>
                <button className="btn-secondary" onClick={() => extend(c, "year")}>+1년</button>
                <button className="btn-secondary" onClick={() => extendTrial(c)}>체험 +7일</button>
                <button className="btn-secondary" onClick={() => clearPaid(c)}>유료 해제</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

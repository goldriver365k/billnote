import React, { useState } from "react";
import { ShieldCheck, LogOut, Loader2 } from "lucide-react";

// Login box for billnote.store/admin: login only (no signup, no employee code).
export function AdminLogin({ onGoogle, onEmail }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn) => {
    setErr(""); setBusy(true);
    try { await fn(); } catch (e) { setErr(e?.code?.includes("popup-closed") ? "" : (e?.message || "로그인에 실패했습니다")); }
    setBusy(false);
  };
  return (
    <div className="content" style={{ maxWidth: 380, margin: "40px auto", padding: "0 16px" }}>
      <div className="tape-card" style={{ padding: 20, textAlign: "center" }}>
        <ShieldCheck size={30} />
        <h2 style={{ margin: "8px 0 4px" }}>BillNote 운영자</h2>
        <p style={{ fontSize: 13, opacity: 0.75, margin: "0 0 14px" }}>운영자 전용 페이지입니다. 회원 계정으로는 들어올 수 없습니다.</p>
        <button className="btn-primary" style={{ width: "100%" }} disabled={busy} onClick={() => run(onGoogle)}>
          {busy ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : null} 구글로 로그인
        </button>
        <details style={{ marginTop: 14, textAlign: "left", fontSize: 13 }}>
          <summary style={{ cursor: "pointer", textAlign: "center" }}>이메일로 로그인</summary>
          <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", boxSizing: "border-box", marginTop: 8 }} />
          <input type="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: "100%", boxSizing: "border-box", marginTop: 6 }} />
          <button className="btn-secondary" style={{ width: "100%", marginTop: 8 }} disabled={busy || !email || !pw} onClick={() => run(() => onEmail(email.trim(), pw))}>로그인</button>
        </details>
        {err && <div style={{ color: "var(--stamp)", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ marginTop: 16, fontSize: 12 }}><a href="/">앱으로 돌아가기</a></div>
      </div>
    </div>
  );
}

export function AdminDenied({ email, onLogout }) {
  return (
    <div className="content" style={{ maxWidth: 380, margin: "40px auto", padding: "0 16px" }}>
      <div className="tape-card" style={{ padding: 20, textAlign: "center" }}>
        <ShieldCheck size={30} />
        <h2 style={{ margin: "8px 0 4px" }}>접근 권한이 없습니다</h2>
        <p style={{ fontSize: 13, lineHeight: 1.7, margin: "0 0 14px" }}>
          {email ? <><b>{email}</b> 계정은</> : "이 계정은"} 운영자가 아닙니다.<br />
          운영자 페이지는 BillNote 운영자만 사용할 수 있습니다.
        </p>
        <a href="/" className="btn-primary" style={{ display: "block", textDecoration: "none", padding: "10px 0" }}>앱으로 돌아가기</a>
        <button className="btn-secondary" style={{ width: "100%", marginTop: 8 }} onClick={onLogout}><LogOut size={14} /> 로그아웃하고 운영자로 로그인</button>
      </div>
    </div>
  );
}

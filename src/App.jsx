import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera,
  Image as ImageIcon,
  Store,
  Calendar,
  CalendarDays,
  Receipt,
  X,
  Check,
  Plus,
  Loader2,
  Trash2,
  Pencil,
  Lock,
  ShieldCheck,
  LogOut,
  Settings,
  KeyRound,
  Truck,
  TrendingUp,
  ChevronDown,
  Wallet,
  FileArchive,
  BookOpen,
} from "lucide-react";
import {
  BarChart,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { db, auth, googleProvider } from "./firebase";
import TaxExportView from "./TaxExport";
import CameraCapture from "./CameraCapture";
import { AdminLogin, AdminDenied } from "./AdminPage";
import { AddToHomeModal, isStandalone } from "./AddToHome";
import { computeStatus, summarize, BillingBanner, BillingModal, WelcomeModal, PlatformAdminPanel, KAKAO_URL, isPlatformOperator } from "./Billing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  addDoc,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInAnonymously,
  signOut,
} from "firebase/auth";

// ---------- helpers ----------

const won = (n) => (Number(n) || 0).toLocaleString("ko-KR") + "원";
const sum = (list) => list.reduce((s, n) => s + (Number(n) || 0), 0);
const monthKey = (dateStr) => (dateStr || "").slice(0, 7);
const todayStr = () => new Date().toISOString().slice(0, 10);
const currentMonthKey = () => todayStr().slice(0, 7);
const monthLabel = (mk) => {
  if (!mk) return "";
  const [y, m] = mk.split("-");
  return `${y}년 ${Number(m)}월`;
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function prettyDate(dateStr) {
  if (!dateStr) return { big: "날짜 없음", dow: "" };
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return { big: dateStr, dow: "" };
  return {
    big: `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`,
    dow: DOW[d.getDay()] + "요일",
    year: d.getFullYear(),
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다"));
    reader.readAsDataURL(file);
  });
}

// shrink a photo to a JPEG that fits comfortably inside a Firestore document
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("이미지를 열지 못했습니다"));
      i.src = url;
    });
    const attempts = [[1600, 0.8], [1400, 0.7], [1200, 0.6], [1000, 0.55]];
    let dataUrl = "";
    for (const [maxDim, q] of attempts) {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      dataUrl = c.toDataURL("image/jpeg", q);
      if (dataUrl.length < 700000) break;
    }
    return { dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function analyzeReceipt(base64, mediaType) {
  const response = await fetch("/.netlify/functions/analyze-receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, mediaType }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || "분석에 실패했습니다");
  }
  return data;
}

const DEFAULT_CONFIG = { stores: [] };

// ---------- UI atoms ----------

function MonthPicker({ value, availableMonths, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="month-picker">
      <button className="month-picker-btn" onClick={() => setOpen((o) => !o)}>
        {monthLabel(value)} <ChevronDown size={14} />
      </button>
      {open && (
        <div className="month-picker-dropdown">
          {availableMonths.map((m) => (
            <button
              key={m}
              className={`month-picker-item ${m === value ? "active" : ""}`}
              onClick={() => {
                onChange(m);
                setOpen(false);
              }}
            >
              {monthLabel(m)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TapeCard({ receipt, onEdit, onDelete, onSetPaymentType, showStore, onViewPhoto }) {
  const { big, dow, year } = prettyDate(receipt.date);
  return (
    <div className="tape">
      <div className="tape-head">
        <div className="date-badge">
          <span className="date-big">{big}</span>
          <span className="date-dow">{dow}</span>
          {receipt.paymentType === "후불" && <span className="paid-later-badge">후불</span>}
        </div>
        <div className="tape-actions">
          {receipt.hasPhoto && onViewPhoto && (
            <button className="icon-btn" onClick={() => onViewPhoto(receipt.id)} aria-label="영수증 사진">
              <ImageIcon size={14} />
            </button>
          )}
          <button className="icon-btn" onClick={() => onEdit(receipt)} aria-label="수정">
            <Pencil size={14} />
          </button>
          <button className="icon-btn danger" onClick={() => onDelete(receipt.id)} aria-label="삭제">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {(showStore || receipt.vendor) && (
        <div className="tape-store">
          {showStore && (
            <span>
              <Store size={13} style={{ marginRight: 5, opacity: 0.7 }} />
              {receipt.store || "알 수 없음"}
            </span>
          )}
          {showStore && receipt.vendor && <span className="tape-sep"> · </span>}
          {receipt.vendor && (
            <span>
              <Truck size={13} style={{ marginRight: 5, opacity: 0.7 }} />
              {receipt.vendor}
            </span>
          )}
          {year ? <span className="tape-year"> · {year}</span> : null}
        </div>
      )}
      <div className="tape-divider" />
      <div className="tape-items">
        {(receipt.items || []).length === 0 && <div className="tape-empty">품목 정보 없음</div>}
        {(receipt.items || []).map((it, i) => (
          <div className="tape-item" key={i}>
            <span className="tape-item-name">{it.name}{it.qty > 1 ? ` x${it.qty}` : ""}</span>
            <span className="tape-item-price">{won(it.price)}</span>
          </div>
        ))}
      </div>
      <div className="tape-divider" />
      <div className="tape-total">
        <span>합계</span>
        <span>{won(receipt.total)}</span>
      </div>
      {onSetPaymentType && (
        <div className="tape-payment-toggle">
          <button
            className={(receipt.paymentType || "완료") === "완료" ? "active" : ""}
            onClick={() => onSetPaymentType(receipt.id, "완료")}
          >
            결제완료
          </button>
          <button
            className={receipt.paymentType === "후불" ? "active paid-later" : ""}
            onClick={() => onSetPaymentType(receipt.id, "후불")}
          >
            후불
          </button>
        </div>
      )}
      <div className="tape-jagged" />
    </div>
  );
}

function ReceiptForm({ initial, onCancel, onSave, lockStoreName }) {
  const [store, setStore] = useState(lockStoreName || initial.store || "");
  const [vendor, setVendor] = useState(initial.vendor || "");
  const [date, setDate] = useState(initial.date || todayStr());
  const [paymentType, setPaymentType] = useState(initial.paymentType || "완료");
  const [paymentMethod, setPaymentMethod] = useState(initial.paymentMethod || "카드");
  const [dueDate, setDueDate] = useState(initial.dueDate || "");
  const [memo, setMemo] = useState(initial.memo || "");
  const [items, setItems] = useState(
    initial.items && initial.items.length ? initial.items.map((it) => ({ ...it })) : [{ name: "", qty: 1, price: 0 }]
  );

  const total = items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
  const updateItem = (i, field, value) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const removeItem = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const addItem = () => setItems((prev) => [...prev, { name: "", qty: 1, price: 0 }]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>영수증 확인 · 수정</h3>
          <button className="icon-btn" onClick={onCancel}><X size={18} /></button>
        </div>

        <div className="form-row">
          <label>날짜</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="form-row">
          <label>매장명</label>
          <input
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="예: 두꺼비 종합분식"
            disabled={!!lockStoreName}
          />
          {lockStoreName && <span className="lock-hint"><Lock size={11} /> 로그인한 매장으로 고정됩니다</span>}
        </div>

        <div className="form-row">
          <label>구매처 (어디서 샀는지)</label>
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="예: 이마트 트레이더스, OO식자재마트"
          />
        </div>

        <div className="form-row">
          <label>결제구분</label>
          <div className="payment-toggle">
            <button className={paymentType === "완료" ? "active" : ""} onClick={() => setPaymentType("완료")}>결제완료</button>
            <button className={paymentType === "후불" ? "active paid-later" : ""} onClick={() => setPaymentType("후불")}>후불</button>
          </div>
        </div>

        {paymentType === "완료" && (
          <div className="form-row">
            <label>결제방법</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="카드">카드</option>
              <option value="현금">현금</option>
              <option value="계좌이체">계좌이체</option>
              <option value="기타">기타</option>
            </select>
          </div>
        )}

        {paymentType === "후불" && (
          <>
            <div className="form-row">
              <label>결제예정일 (선택)</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="form-row">
              <label>메모 (선택)</label>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 8월 말 정산 예정" />
            </div>
          </>
        )}

        <div className="form-items-head">
          <label>품목</label>
          <button className="mini-btn" onClick={addItem}><Plus size={13} /> 품목 추가</button>
        </div>

        <div className="form-items">
          {items.map((it, i) => (
            <div className="form-item-row" key={i}>
              <input className="fi-name" placeholder="품목명" value={it.name} onChange={(e) => updateItem(i, "name", e.target.value)} />
              <input className="fi-qty" type="number" min={1} value={it.qty} onChange={(e) => updateItem(i, "qty", Number(e.target.value))} />
              <input className="fi-price" type="number" value={it.price} onChange={(e) => updateItem(i, "price", Number(e.target.value))} />
              <button className="icon-btn danger" onClick={() => removeItem(i)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        <div className="form-total"><span>합계 (자동 계산)</span><span>{won(total)}</span></div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>취소</button>
          <button
            className="btn-primary"
            onClick={() =>
              onSave({
                ...initial,
                store: (lockStoreName || store).trim() || "알 수 없음",
                vendor: vendor.trim() || "알 수 없음",
                date,
                items,
                total,
                paymentType,
                paymentMethod: paymentType === "완료" ? paymentMethod : "",
                dueDate: paymentType === "후불" ? dueDate : "",
                memo: paymentType === "후불" ? memo : "",
              })
            }
          >
            <Check size={15} /> 장부에 기록
          </button>
        </div>
      </div>
    </div>
  );
}

function StoreSelectScreen({ config, onLogin }) {
  const [selectedStore, setSelectedStore] = useState(config.stores[0]?.name || "");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!selectedStore && config.stores[0]) setSelectedStore(config.stores[0].name);
  }, [config.stores]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    setErr("");
    const store = config.stores.find((s) => s.name === selectedStore);
    if (!store) { setErr("매장을 선택해 주세요"); return; }
    if (pin === store.pin) onLogin({ role: "store", storeName: store.name });
    else setErr("PIN이 일치하지 않습니다");
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-stamp"><Receipt size={26} /></div>
        <h1>영수증 장부</h1>
        <p className="login-sub">매장을 선택하고 PIN을 입력하세요</p>

        {config.stores.length === 0 ? (
          <div className="login-empty">
            등록된 매장이 없습니다. 사업주 계정으로 로그인해서 매장을 등록해 주세요.
          </div>
        ) : (
          <select className="login-select" value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)}>
            {config.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        )}

        <input
          className="login-pin"
          type="password"
          inputMode="numeric"
          placeholder="PIN 입력"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        {err && <div className="login-err">{err}</div>}

        <button className="login-submit" onClick={submit}>
          <KeyRound size={15} /> 로그인
        </button>
      </div>
    </div>
  );
}

function CompanyGate({ onOwnerAuth, onGoogleAuth, onEmployeeAuth }) {
  const [mode, setMode] = useState("login"); // login | signup | employee
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedUpCode, setSignedUpCode] = useState("");

  const doGoogle = async () => {
    setErr("");
    setBusy(true);
    try {
      await onGoogleAuth();
    } catch (e) {
      setErr(loginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doLogin = async () => {
    setErr("");
    setBusy(true);
    try {
      await onOwnerAuth("login", { email: email.trim(), pw });
    } catch (e) {
      setErr(loginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doSignup = async () => {
    setErr("");
    if (!companyName.trim()) { setErr("매장(사업체)명을 입력해 주세요"); return; }
    if (pw.length < 6) { setErr("비밀번호는 6자 이상이어야 합니다"); return; }
    if (pw !== pw2) { setErr("비밀번호가 서로 다릅니다"); return; }
    setBusy(true);
    try {
      const code = await onOwnerAuth("signup", { email: email.trim(), pw, companyName: companyName.trim() });
      setSignedUpCode(code);
    } catch (e) {
      setErr(loginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doEmployee = async () => {
    setErr("");
    if (!companyCode.trim()) { setErr("회사 코드를 입력해 주세요"); return; }
    setBusy(true);
    try {
      await onEmployeeAuth(companyCode.trim().toUpperCase());
    } catch (e) {
      setErr(e.message || "회사 코드를 찾을 수 없습니다");
    } finally {
      setBusy(false);
    }
  };

  if (signedUpCode) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-stamp"><ShieldCheck size={26} /></div>
          <h1>가입 완료</h1>
          <p className="login-sub">아래 회사 코드를 직원들에게 알려주세요.<br />직원은 이 코드로 매장을 선택해 로그인합니다.</p>
          <div className="company-code-display">{signedUpCode}</div>
          <button className="login-submit" onClick={() => window.location.reload()}>
            <Check size={15} /> 시작하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-stamp"><Receipt size={26} /></div>
        <h1>영수증 장부</h1>
        <p className="login-sub">사업주 계정으로 로그인하거나, 직원이시면 회사 코드로 들어가세요</p>

        <div className="login-toggle three">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setErr(""); }}>로그인</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setErr(""); }}>회원가입</button>
          <button className={mode === "employee" ? "active" : ""} onClick={() => { setMode("employee"); setErr(""); }}>직원용</button>
        </div>

        {mode === "login" && (
          <>
            <input className="login-select" type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="login-pin" type="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLogin()} />
            {err && <div className="login-err">{err}</div>}
            <button className="login-submit" disabled={busy} onClick={doLogin}><KeyRound size={15} /> 로그인</button>
          </>
        )}

        {mode === "signup" && (
          <>
            <input className="login-select" placeholder="매장(사업체)명" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            <input className="login-select" type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="login-pin" type="password" placeholder="비밀번호 (6자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
            <input className="login-pin" type="password" placeholder="비밀번호 확인" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSignup()} />
            {err && <div className="login-err">{err}</div>}
            <button className="login-submit" disabled={busy} onClick={doSignup}><Check size={15} /> 회원가입</button>
          </>
        )}

        {(mode === "login" || mode === "signup") && (
          <>
            <div className="login-divider"><span>또는</span></div>
            <button className="google-submit" disabled={busy} onClick={doGoogle}>
              <span className="google-g">G</span> Google로 계속하기
            </button>
          </>
        )}

        {mode === "employee" && (
          <>
            <input
              className="login-select company-code-input"
              placeholder="회사 코드 (예: A3F9K2)"
              value={companyCode}
              onChange={(e) => setCompanyCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doEmployee()}
            />
            {err && <div className="login-err">{err}</div>}
            <button className="login-submit" disabled={busy} onClick={doEmployee}><KeyRound size={15} /> 다음</button>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleCompanyNameScreen({ email, onSubmit }) {
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [doneCode, setDoneCode] = useState("");

  const submit = async () => {
    if (!companyName.trim()) { setErr("매장(사업체)명을 입력해 주세요"); return; }
    setBusy(true);
    setErr("");
    try {
      const code = await onSubmit(companyName.trim());
      setDoneCode(code);
    } catch (e) {
      setErr(e.message || "저장에 실패했습니다");
      setBusy(false);
    }
  };

  if (doneCode) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-stamp"><ShieldCheck size={26} /></div>
          <h1>가입 완료</h1>
          <p className="login-sub">아래 회사 코드를 직원들에게 알려주세요.<br />직원은 이 코드로 매장을 선택해 로그인합니다.</p>
          <div className="company-code-display">{doneCode}</div>
          <button className="login-submit" onClick={() => window.location.reload()}>
            <Check size={15} /> 시작하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-stamp"><ShieldCheck size={26} /></div>
        <h1>거의 다 됐어요</h1>
        <p className="login-sub">{email}로 로그인했습니다.<br />매장(사업체)명만 입력하면 가입이 끝납니다.</p>
        <input
          className="login-select"
          placeholder="매장(사업체)명"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {err && <div className="login-err">{err}</div>}
        <button className="login-submit" disabled={busy} onClick={submit}><Check size={15} /> 가입 완료</button>
      </div>
    </div>
  );
}

function loginErrorMessage(e) {
  const code = e?.code || "";
  if (code.includes("email-already-in-use")) return "이미 가입된 이메일입니다";
  if (code.includes("invalid-email")) return "이메일 형식이 올바르지 않습니다";
  if (code.includes("weak-password")) return "비밀번호가 너무 약합니다 (6자 이상)";
  if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential")) return "이메일 또는 비밀번호가 일치하지 않습니다";
  return e?.message || "오류가 발생했습니다";
}

function StoreAdminPanel({ config, onUpdateConfig, onUpdateCompanyCode, onMigrateOldData }) {
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newCode, setNewCode] = useState(config.companyCode || "");
  const [codeMsg, setCodeMsg] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState("");

  const addStore = () => {
    if (!newName.trim() || !newPin.trim()) return;
    if (config.stores.some((s) => s.name === newName.trim())) return;
    onUpdateConfig({
      ...config,
      stores: [...config.stores, { name: newName.trim(), pin: newPin.trim() }],
    });
    setNewName("");
    setNewPin("");
  };

  const removeStore = (name) => {
    onUpdateConfig({ ...config, stores: config.stores.filter((s) => s.name !== name) });
  };

  const updateStorePin = (name, pin) => {
    onUpdateConfig({ ...config, stores: config.stores.map((s) => (s.name === name ? { ...s, pin } : s)) });
  };

  const saveCode = async () => {
    setCodeMsg("");
    const code = newCode.trim().toUpperCase().replace(/\s+/g, "");
    if (code.length < 3 || code.length > 12) {
      setCodeMsg("코드는 3~12자로 입력해 주세요");
      return;
    }
    setCodeBusy(true);
    try {
      await onUpdateCompanyCode(code);
      setCodeMsg("변경되었습니다");
    } catch (e) {
      setCodeMsg(e.message || "변경에 실패했습니다");
    } finally {
      setCodeBusy(false);
    }
  };

  const runMigration = async () => {
    setMigrateMsg("");
    setMigrateBusy(true);
    try {
      const r = await onMigrateOldData();
      setMigrateMsg(`가져오기 완료 — 매장 ${r.storesAdded}개, 영수증 ${r.receiptsCount}건, 매출 ${r.salesCount}건, 후불입금 ${r.paymentsCount}건`);
    } catch (e) {
      setMigrateMsg("가져오기 실패: " + (e.message || ""));
    } finally {
      setMigrateBusy(false);
    }
  };

  return (
    <div className="admin-panel">
      <div className="section-title"><Settings size={16} /> 매장 관리</div>

      <div className="admin-list">
        {config.stores.length === 0 && <div className="tape-empty">등록된 매장이 없습니다</div>}
        {config.stores.map((s) => (
          <div className="admin-row" key={s.name}>
            <span className="admin-row-name">{s.name}</span>
            <input
              className="admin-row-pin"
              value={s.pin}
              onChange={(e) => updateStorePin(s.name, e.target.value)}
            />
            <button className="icon-btn danger" onClick={() => removeStore(s.name)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      <div className="admin-add-row">
        <input placeholder="매장명" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input placeholder="PIN" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
        <button className="mini-btn" onClick={addStore}><Plus size={13} /> 추가</button>
      </div>

      <div className="section-title" style={{ marginTop: 24 }}><ShieldCheck size={16} /> 직원용 회사 코드</div>
      <p className="admin-hint">직원들에게 이 코드를 알려주면, 코드 입력 → 매장 선택 → PIN으로 로그인합니다. 원하는 코드로 직접 바꿀 수 있습니다 (3~12자, 영문·숫자).</p>
      <div className="admin-add-row" style={{ gridTemplateColumns: "1fr auto" }}>
        <input className="company-code-input" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="예: BABSIM2026" />
        <button className="mini-btn" disabled={codeBusy} onClick={saveCode}><Check size={13} /> 저장</button>
      </div>
      {codeMsg && <p className="admin-hint" style={{ color: codeMsg === "변경되었습니다" ? "var(--cover)" : "var(--stamp)" }}>{codeMsg}</p>}

      {onMigrateOldData && (
        <>
          <div className="section-title" style={{ marginTop: 24 }}><Truck size={16} /> 기존 자료 가져오기</div>
          <p className="admin-hint">회원가입 이전에 쓰던 예전 데이터(영수증·매출·후불·매장)를 이 회사 계정으로 복사해옵니다. 여러 번 눌러도 중복 저장되지 않습니다.</p>
          <button className="mini-btn" disabled={migrateBusy} onClick={runMigration}>
            {migrateBusy ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={13} />} 가져오기 실행
          </button>
          {migrateMsg && <p className="admin-hint" style={{ color: migrateMsg.startsWith("가져오기 완료") ? "var(--cover)" : "var(--stamp)" }}>{migrateMsg}</p>}
        </>
      )}
    </div>
  );
}

// ---------- sales / food cost ratio view ----------

function SalesView({ storeOptions, lockedStore, receipts, sales, month, onSaveSale, onDeleteSale }) {
  const [selectedStore, setSelectedStore] = useState(lockedStore || storeOptions[0] || "");
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState("");

  const activeStore = lockedStore || (storeOptions.includes(selectedStore) ? selectedStore : storeOptions[0]);

  const storeReceipts = receipts.filter((r) => r.store === activeStore && monthKey(r.date) === month);
  const storeSales = sales.filter((s) => s.store === activeStore && monthKey(s.date) === month);

  const foodCostByDay = {};
  for (const r of storeReceipts) {
    foodCostByDay[r.date] = (foodCostByDay[r.date] || 0) + (Number(r.total) || 0);
  }
  const salesByDay = {};
  for (const s of storeSales) {
    salesByDay[s.date] = Number(s.amount) || 0;
  }

  const allDates = Array.from(new Set([...Object.keys(foodCostByDay), ...Object.keys(salesByDay)])).sort();

  let cumSales = 0, cumFood = 0;
  const chartData = allDates.map((d) => {
    const daySales = salesByDay[d] || 0;
    const dayFood = foodCostByDay[d] || 0;
    cumSales += daySales;
    cumFood += dayFood;
    return {
      date: d.slice(5),
      매출: daySales,
      식자재: dayFood,
      누적원가율: cumSales > 0 ? Math.round((cumFood / cumSales) * 1000) / 10 : 0,
    };
  });

  const totalSales = Object.values(salesByDay).reduce((a, b) => a + b, 0);
  const totalFood = Object.values(foodCostByDay).reduce((a, b) => a + b, 0);
  const ratio = totalSales > 0 ? ((totalFood / totalSales) * 100).toFixed(1) : null;

  const submit = () => {
    const amt = Number(amount);
    if (!activeStore || !date || !amt) return;
    onSaveSale({ store: activeStore, date, amount: amt });
    setAmount("");
  };

  const recentEntries = storeSales.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);

  return (
    <div>
      {!lockedStore && storeOptions.length > 0 && (
        <div className="vendor-chips">
          {storeOptions.map((s) => (
            <button key={s} className={`vendor-chip ${s === activeStore ? "active" : ""}`} onClick={() => setSelectedStore(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="sales-summary-row">
        <div className="sales-summary-card">
          <div className="sales-summary-label">{monthLabel(month)} 매출</div>
          <div className="sales-summary-value">{won(totalSales)}</div>
        </div>
        <div className="sales-summary-card">
          <div className="sales-summary-label">{monthLabel(month)} 식자재구매</div>
          <div className="sales-summary-value food">{won(totalFood)}</div>
        </div>
        <div className="sales-summary-card">
          <div className="sales-summary-label">식자재 원가율</div>
          <div className="sales-summary-value ratio">{ratio !== null ? `${ratio}%` : "—"}</div>
        </div>
      </div>

      <div className="sales-input-card">
        <div className="section-title" style={{ marginTop: 0 }}><TrendingUp size={16} /> 일매출 입력{activeStore ? ` · ${activeStore}` : ""}</div>
        <div className="sales-input-row">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="number" placeholder="매출액" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="mini-btn" onClick={submit}><Plus size={13} /> 저장</button>
        </div>
        {recentEntries.length > 0 && (
          <div className="sales-recent-list">
            {recentEntries.map((s) => (
              <div className="sales-recent-row" key={s.id}>
                <span>{s.date}</span>
                <span>{won(s.amount)}</span>
                <button className="icon-btn danger" onClick={() => onDeleteSale(s.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {chartData.length > 1 && (
        <div className="chart-card">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#E7DDC6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v, name) => (name === "누적원가율" ? `${v}%` : won(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="매출" fill="#2C3B36" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="식자재" fill="#B58A3B" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="누적원가율" stroke="#A9382B" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length <= 1 && (
        <div className="empty-state">
          <h3>데이터가 더 필요해요</h3>
          <p>매출을 이틀 이상 입력하면 그래프가 나타납니다.</p>
        </div>
      )}
    </div>
  );
}

// ---------- vendor debt (후불관리) view ----------

function DebtView({ storeOptions, lockedStore, receipts, payments, month, onSavePayment, onDeletePayment }) {
  const [selectedStore, setSelectedStore] = useState(lockedStore || storeOptions[0] || "");
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [pDate, setPDate] = useState(todayStr());
  const [pAmount, setPAmount] = useState("");
  const [pMethod, setPMethod] = useState("계좌이체");
  const [pMemo, setPMemo] = useState("");

  const activeStore = lockedStore || (storeOptions.includes(selectedStore) ? selectedStore : storeOptions[0]);

  const storeDebtReceipts = receipts.filter((r) => r.store === activeStore && r.paymentType === "후불");
  const storePayments = payments.filter((p) => p.store === activeStore);

  const vendorNames = Array.from(
    new Set([...storeDebtReceipts.map((r) => r.vendor || "알 수 없음"), ...storePayments.map((p) => p.vendor || "알 수 없음")])
  );

  const vendorSummaries = vendorNames.map((v) => {
    const priorPurchase = sum(storeDebtReceipts.filter((r) => r.vendor === v && monthKey(r.date) < month).map((r) => r.total));
    const priorPaid = sum(storePayments.filter((p) => p.vendor === v && monthKey(p.date) < month).map((p) => p.amount));
    const monthPurchase = sum(storeDebtReceipts.filter((r) => r.vendor === v && monthKey(r.date) === month).map((r) => r.total));
    const monthPaid = sum(storePayments.filter((p) => p.vendor === v && monthKey(p.date) === month).map((p) => p.amount));
    const prior = priorPurchase - priorPaid;
    const balance = prior + monthPurchase - monthPaid;
    return { vendor: v, prior, monthPurchase, monthPaid, balance };
  }).sort((a, b) => b.balance - a.balance);

  const totalBalance = sum(vendorSummaries.map((v) => v.balance));
  const activeVendor = vendorSummaries.find((v) => v.vendor === selectedVendor) || vendorSummaries[0];

  const ledger = activeVendor
    ? [
        ...storeDebtReceipts.filter((r) => r.vendor === activeVendor.vendor && monthKey(r.date) === month).map((r) => ({ date: r.date, type: "구매", amount: r.total })),
        ...storePayments.filter((p) => p.vendor === activeVendor.vendor && monthKey(p.date) === month).map((p) => ({ date: p.date, type: "입금", amount: -p.amount, id: p.id, method: p.method, memo: p.memo })),
      ].sort((a, b) => (a.date > b.date ? 1 : -1))
    : [];

  let running = activeVendor ? activeVendor.prior : 0;
  const ledgerWithRunning = ledger.map((e) => {
    running += e.amount;
    return { ...e, running };
  });

  const submitPayment = () => {
    const amt = Number(pAmount);
    if (!activeVendor || !pDate || !amt) return;
    onSavePayment({ store: activeStore, vendor: activeVendor.vendor, date: pDate, amount: amt, method: pMethod, memo: pMemo });
    setPAmount("");
    setPMemo("");
  };

  return (
    <div>
      {!lockedStore && storeOptions.length > 0 && (
        <div className="vendor-chips">
          {storeOptions.map((s) => (
            <button key={s} className={`vendor-chip ${s === activeStore ? "active" : ""}`} onClick={() => setSelectedStore(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="summary-bar">
        <div><div className="label">{monthLabel(month)} 전체 미지급금</div></div>
        <div className="value">{won(totalBalance)}</div>
      </div>

      {vendorSummaries.length === 0 && (
        <div className="empty-state">
          <h3>후불 거래가 없습니다</h3>
          <p>영수증 저장 시 결제구분을 "후불"로 선택하면 여기 표시됩니다.</p>
        </div>
      )}

      {vendorSummaries.length > 0 && (
        <div className="debt-table">
          <div className="debt-table-head">
            <span>업체명</span><span>전월이월</span><span>이번달후불</span><span>이번달입금</span><span>현재잔액</span>
          </div>
          {vendorSummaries.map((v) => (
            <button
              key={v.vendor}
              className={`debt-table-row ${activeVendor?.vendor === v.vendor ? "active" : ""}`}
              onClick={() => setSelectedVendor(v.vendor)}
            >
              <span className="debt-vendor-name">{v.vendor}</span>
              <span>{won(v.prior)}</span>
              <span>{won(v.monthPurchase)}</span>
              <span>{won(v.monthPaid)}</span>
              <span className="debt-balance">{won(v.balance)}</span>
            </button>
          ))}
        </div>
      )}

      {activeVendor && (
        <>
          <div className="section-title"><Truck size={16} /> {activeVendor.vendor} 후불장부</div>

          <div className="debt-ledger">
            {ledgerWithRunning.length === 0 && <div className="tape-empty">이번 달 거래 내역이 없습니다</div>}
            {ledgerWithRunning.map((e, i) => (
              <div className="debt-ledger-row" key={i}>
                <span className="debt-ledger-date">{e.date}</span>
                <span className={e.type === "구매" ? "debt-plus" : "debt-minus"}>
                  {e.type === "구매" ? "후불구매" : "입금"} {e.amount >= 0 ? "+" : ""}{won(e.amount)}
                </span>
                <span className="debt-ledger-running">잔액 {won(e.running)}</span>
                {e.id && (
                  <button className="icon-btn danger" onClick={() => onDeletePayment(e.id)}><Trash2 size={12} /></button>
                )}
              </div>
            ))}
          </div>

          <div className="sales-input-card">
            <div className="section-title" style={{ marginTop: 0 }}><Plus size={16} /> 입금 등록</div>
            <div className="debt-payment-row">
              <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} />
              <input type="number" placeholder="입금액" value={pAmount} onChange={(e) => setPAmount(e.target.value)} />
              <select value={pMethod} onChange={(e) => setPMethod(e.target.value)}>
                <option value="계좌이체">계좌이체</option>
                <option value="현금">현금</option>
                <option value="카드">카드</option>
                <option value="기타">기타</option>
              </select>
            </div>
            <div className="debt-payment-row">
              <input placeholder="메모 (선택)" value={pMemo} onChange={(e) => setPMemo(e.target.value)} style={{ gridColumn: "1 / -1" }} />
            </div>
            <button className="btn-primary" style={{ marginTop: 8 }} onClick={submitPayment}><Check size={15} /> 입금 저장</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- main app ----------

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [companyId, setCompanyId] = useState(null);

  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [session, setSession] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [receiptsLoaded, setReceiptsLoaded] = useState(false);
  const [sales, setSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tab, setTab] = useState("daily");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const fileInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  // watch Firebase auth state (owner email/password session, or employee anonymous session)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthLoading(false);
      if (u && !u.isAnonymous) {
        setCompanyId(u.uid);
      } else if (u && u.isAnonymous) {
        const cid = localStorage.getItem("employeeCompanyId");
        setCompanyId(cid || null);
      } else {
        setCompanyId(null);
      }
    });
    return () => unsub();
  }, []);

  const isOwner = authUser && !authUser.isAnonymous;

  // owner (real email/password account) is automatically treated as admin — no separate PIN step
  useEffect(() => {
    if (isOwner) {
      setSession({ role: "admin", storeName: null });
    } else if (!authUser) {
      setSession(null);
    }
  }, [isOwner, authUser]);

  const generateCompanyCode = () =>
    Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 33)]).join("");

  const handleOwnerAuth = async (kind, { email, pw, companyName }) => {
    if (kind === "login") {
      await signInWithEmailAndPassword(auth, email, pw);
      return null;
    }
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    const uid = cred.user.uid;
    const code = generateCompanyCode();
    await setDoc(doc(db, "companies", uid), { companyName, email, companyCode: code, createdAt: Date.now(), trialStartedAt: Date.now() });
    await setDoc(doc(db, "companyCodes", code), { companyId: uid });
    await setDoc(doc(db, "companies", uid, "config", "store"), { stores: [], companyCode: code });
    return code;
  };

  const [pendingGoogleUser, setPendingGoogleUser] = useState(null);

  const handleGoogleAuth = async () => {
    const cred = await signInWithPopup(auth, googleProvider);
    const uid = cred.user.uid;
    const companySnap = await getDoc(doc(db, "companies", uid));
    if (!companySnap.exists()) {
      setPendingGoogleUser({ uid, email: cred.user.email || "" });
    }
  };

  const completeGoogleSignup = async (companyName) => {
    if (!pendingGoogleUser) return null;
    const { uid, email } = pendingGoogleUser;
    const code = generateCompanyCode();
    await setDoc(doc(db, "companies", uid), { companyName, email, companyCode: code, createdAt: Date.now(), trialStartedAt: Date.now() });
    await setDoc(doc(db, "companyCodes", code), { companyId: uid });
    await setDoc(doc(db, "companies", uid, "config", "store"), { stores: [], companyCode: code });
    return code;
  };

  const handleEmployeeAuth = async (code) => {
    const snap = await getDoc(doc(db, "companyCodes", code));
    if (!snap.exists()) throw new Error("회사 코드를 찾을 수 없습니다");
    const cid = snap.data().companyId;
    localStorage.setItem("employeeCompanyId", cid);
    setCompanyId(cid);
    if (!auth.currentUser) await signInAnonymously(auth);
  };

  // live config from Firestore (doc: companies/{companyId}/config/store)
  useEffect(() => {
    if (!companyId) { setConfigLoaded(false); return; }
    const unsub = onSnapshot(
      doc(db, "companies", companyId, "config", "store"),
      (snap) => {
        setConfig(snap.exists() ? snap.data() : DEFAULT_CONFIG);
        setConfigLoaded(true);
      },
      (err) => {
        console.error("설정 불러오기 실패", err);
        setConfigLoaded(true);
      }
    );
    return () => unsub();
  }, [companyId]);

  // live receipts from Firestore (collection: companies/{companyId}/receipts)
  useEffect(() => {
    if (!companyId) { setReceipts([]); setReceiptsLoaded(false); return; }
    const unsub = onSnapshot(
      collection(db, "companies", companyId, "receipts"),
      (snap) => {
        setReceipts(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
        setReceiptsLoaded(true);
      },
      (err) => {
        console.error("영수증 불러오기 실패", err);
        setReceiptsLoaded(true);
      }
    );
    return () => unsub();
  }, [companyId]);

  // live daily sales from Firestore (collection: companies/{companyId}/sales)
  useEffect(() => {
    if (!companyId) { setSales([]); return; }
    const unsub = onSnapshot(
      collection(db, "companies", companyId, "sales"),
      (snap) => {
        setSales(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      },
      (err) => {
        console.error("매출 불러오기 실패", err);
      }
    );
    return () => unsub();
  }, [companyId]);

  // live vendor payments from Firestore (collection: companies/{companyId}/vendorPayments)
  useEffect(() => {
    if (!companyId) { setPayments([]); return; }
    const unsub = onSnapshot(
      collection(db, "companies", companyId, "vendorPayments"),
      (snap) => {
        setPayments(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      },
      (err) => {
        console.error("입금 내역 불러오기 실패", err);
      }
    );
    return () => unsub();
  }, [companyId]);

  const persistConfig = useCallback(async (next) => {
    if (!companyId) return;
    try {
      await setDoc(doc(db, "companies", companyId, "config", "store"), next);
    } catch (e) {
      console.error("설정 저장 실패", e);
    }
  }, [companyId]);

  const updateCompanyCode = useCallback(async (newCode) => {
    if (!companyId) return;
    const oldCode = config.companyCode;
    if (newCode === oldCode) return;

    const existing = await getDoc(doc(db, "companyCodes", newCode));
    if (existing.exists() && existing.data().companyId !== companyId) {
      throw new Error("이미 사용 중인 코드입니다. 다른 코드를 입력해 주세요");
    }

    await setDoc(doc(db, "companyCodes", newCode), { companyId });
    await setDoc(doc(db, "companies", companyId), { companyCode: newCode }, { merge: true });
    await setDoc(doc(db, "companies", companyId, "config", "store"), { ...config, companyCode: newCode });
    if (oldCode) {
      try {
        await deleteDoc(doc(db, "companyCodes", oldCode));
      } catch (e) {
        console.error("이전 코드 정리 실패 (무시 가능)", e);
      }
    }
  }, [companyId, config]);

  const migrateOldData = useCallback(async () => {
    if (!companyId) throw new Error("먼저 로그인해 주세요");

    let storesAdded = 0, receiptsCount = 0, salesCount = 0, paymentsCount = 0;

    // 1) old stores (top-level config/store) merged into this company's config
    const oldConfigSnap = await getDoc(doc(db, "config", "store"));
    if (oldConfigSnap.exists()) {
      const oldStores = oldConfigSnap.data().stores || [];
      const currentStores = config.stores || [];
      const merged = [...currentStores];
      for (const s of oldStores) {
        if (!merged.some((m) => m.name === s.name)) {
          merged.push(s);
          storesAdded++;
        }
      }
      if (storesAdded > 0) {
        await setDoc(doc(db, "companies", companyId, "config", "store"), { ...config, stores: merged }, { merge: true });
      }
    }

    // 2) old receipts
    const oldReceipts = await getDocs(collection(db, "receipts"));
    for (const d of oldReceipts.docs) {
      await setDoc(doc(db, "companies", companyId, "receipts", d.id), d.data());
      receiptsCount++;
    }

    // 3) old sales
    const oldSales = await getDocs(collection(db, "sales"));
    for (const d of oldSales.docs) {
      await setDoc(doc(db, "companies", companyId, "sales", d.id), d.data());
      salesCount++;
    }

    // 4) old vendor payments
    const oldPayments = await getDocs(collection(db, "vendorPayments"));
    for (const d of oldPayments.docs) {
      await setDoc(doc(db, "companies", companyId, "vendorPayments", d.id), d.data());
      paymentsCount++;
    }

    return { storesAdded, receiptsCount, salesCount, paymentsCount };
  }, [companyId, config]);

  const isAdmin = isOwner || session?.role === "admin";
  const visibleReceipts = isAdmin ? receipts : receipts.filter((r) => r.store === session?.storeName);

  // ---- multi-photo queue + duplicate suppression ----
  const queueRef = useRef([]);
  const pendingRef = useRef(null);
  const seenKeysRef = useRef(new Set());
  const seenImgRef = useRef(new Set());
  const [queueCount, setQueueCount] = useState(0);
  const [progress, setProgress] = useState(null); // {done,total}
  const [notice, setNotice] = useState("");

  const setPendingBoth = (v) => { pendingRef.current = v; setPending(v); };

  const normText = (t) => String(t || "").replace(/\(주\)|㈜|주식회사|\(유\)|[\s\-_.,()]/g, "").toLowerCase();
  const receiptKey = (r) => {
    const total = Number(r.total) || (r.items || []).reduce((a, i) => a + (Number(i.price) || 0), 0);
    const sig = (r.items || []).map((i) => normText(i.name) + ":" + (Number(i.qty) || 0)).sort().join("|");
    return `${normText(r.vendor)}#${r.date || ""}#${total}#${total ? "" : sig}`;
  };

  const showNext = () => {
    const next = queueRef.current.shift() || null;
    setQueueCount(queueRef.current.length);
    if (!next) { seenKeysRef.current = new Set(); seenImgRef.current = new Set(); }
    setPendingBoth(next);
  };

  const enqueueParsed = (parsed) => {
    if (!pendingRef.current) {
      setPendingBoth(parsed);
    } else {
      queueRef.current.push(parsed);
      setQueueCount(queueRef.current.length);
    }
  };

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    if (blockIfExpired()) return;
    setError("");
    setNotice("");
    setAnalyzing(true);
    // keys of everything already saved
    const existing = new Set(receipts.map(receiptKey));
    let dup = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length });
      try {
        const file = files[i];
        const img = await compressImage(file);
        const imgSig = img.dataUrl.length + ":" + img.dataUrl.slice(2000, 2200) + img.dataUrl.slice(-200);
        if (seenImgRef.current.has(imgSig)) { dup++; continue; }
        seenImgRef.current.add(imgSig);
        const parsed = await analyzeReceipt(img.base64, img.mediaType);
        parsed.store = isAdmin ? "" : session.storeName;
        const key = receiptKey(parsed);
        if (existing.has(key) || seenKeysRef.current.has(key)) { dup++; continue; }
        seenKeysRef.current.add(key);
        enqueueParsed({ id: null, ...parsed, _photo: img.dataUrl });
      } catch (e) {
        fail++;
      }
    }
    setProgress(null);
    setAnalyzing(false);
    const msgs = [];
    if (dup) msgs.push(`중복 ${dup}건 제외`);
    if (fail) setError(`${fail}건은 판독하지 못했습니다. 다시 시도해 주세요.`);
    if (msgs.length) { setNotice(msgs.join(", ")); setTimeout(() => setNotice(""), 4000); }
  };

  const onPickFile = (e) => {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
    e.target.value = "";
  };

  const saveReceipt = async (r) => {
    if (!r.id && blockIfExpired(r.store)) { showNext(); return; }
    try {
      const { id, _photo, ...rest } = r;
      if (id) {
        await setDoc(doc(db, "companies", companyId, "receipts", id), rest, { merge: true });
      } else {
        const ref = await addDoc(collection(db, "companies", companyId, "receipts"), { ...rest, hasPhoto: !!_photo, createdAt: Date.now() });
        if (_photo) {
          try {
            await setDoc(doc(db, "companies", companyId, "photos", ref.id), { dataUrl: _photo, createdAt: Date.now() });
          } catch (pe) {
            console.error("사진 저장 실패", pe);
            await setDoc(ref, { hasPhoto: false }, { merge: true });
            setError("영수증은 저장했지만 사진 저장에 실패했습니다");
          }
        }
      }
    } catch (e) {
      console.error("저장 실패", e);
      setError("저장에 실패했습니다");
    }
    showNext();
  };

  // ---- subscription: 7-day trial, then paid ----
  const [companyDoc, setCompanyDoc] = useState(null);
  const [billingInfo, setBillingInfo] = useState(null);
  const [billingOpen, setBillingOpen] = useState(false);
  // first visit on this device (e.g. right after signup): explain how to add the app to the home screen
  const [a2hsOpen, setA2hsOpen] = useState(false);
  const a2hsChecked = useRef(false);
  // right after signup: home-screen guide first, then the price guide (once per company)
  const [manualHash, setManualHash] = useState("");
  const [welcomePending, setWelcomePending] = useState(false);
  const [welcomeBilling, setWelcomeBilling] = useState(false);
  useEffect(() => {
    if (a2hsChecked.current || !companyId || !authUser) return;
    if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/admin") return;
    a2hsChecked.current = true;
    try {
      if (!isStandalone() && !localStorage.getItem("a2hsSeen")) {
        localStorage.setItem("a2hsSeen", "1");
        setA2hsOpen(true);
      }
      if (!authUser.isAnonymous && !localStorage.getItem("welcomeBilling_" + companyId)) {
        localStorage.setItem("welcomeBilling_" + companyId, "1");
        setWelcomePending(true);
      }
    } catch (e) { /* storage unavailable: skip */ }
  }, [companyId, authUser]);
  useEffect(() => {
    // only for newly registered companies (within 3 days of signup), once the home-screen guide is closed
    if (!welcomePending || a2hsOpen || !companyDoc) return;
    setWelcomePending(false);
    if (Date.now() - (companyDoc.createdAt || 0) < 3 * 86400000) setWelcomeBilling(true);
  }, [welcomePending, a2hsOpen, companyDoc]);
  useEffect(() => {
    if (!companyId) { setCompanyDoc(null); return; }
    return onSnapshot(doc(db, "companies", companyId), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      setCompanyDoc(data);
      // existing companies without a trial start get one now
      if (data && !data.trialStartedAt && authUser && !authUser.isAnonymous) {
        setDoc(doc(db, "companies", companyId), { trialStartedAt: Date.now() }, { merge: true }).catch(() => {});
      }
    }, (e) => console.error("회사 정보 불러오기 실패", e));
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!companyId) return;
    return onSnapshot(doc(db, "config", "billing"), (snap) => setBillingInfo(snap.exists() ? snap.data() : null), () => {});
  }, [companyId]);
  const isPlatformOwner = isPlatformOperator(authUser);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const countFor = (storeName) => receipts.filter((r) => r.store === storeName && (r.createdAt || 0) >= monthStart).length;
  const storeStatusFor = (storeName) => {
    const entry = (config.stores || []).find((s) => s.name === storeName) || { name: storeName };
    return computeStatus(entry, companyDoc, isPlatformOwner, countFor(storeName));
  };
  // stores this session can see (employees: their own store only)
  const billingStores = (config.stores || []).filter((s) => (isAdmin ? true : s.name === session?.storeName));
  const billingList = billingStores.map((s) => ({ name: s.name, st: storeStatusFor(s.name) }));
  const billingSummary = summarize(billingList);
  // pop the payment guide up automatically once the free/paid period has ended (once per visit)
  const billingPopupShown = useRef(false);
  useEffect(() => {
    if (!billingPopupShown.current && companyDoc && billingSummary.kind === "expired") {
      billingPopupShown.current = true;
      setBillingOpen(true);
    }
  }, [companyDoc, billingSummary.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // storeName given -> that store must be allowed; otherwise at least one store must be allowed
  const blockIfExpired = (storeName) => {
    const ok = storeName
      ? storeStatusFor(storeName).canAdd
      : (billingList.length === 0 ? computeStatus({}, companyDoc, isPlatformOwner, 0).canAdd : billingList.some((x) => x.st.canAdd));
    if (ok) return false;
    setBillingOpen(true);
    return true;
  };

  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoView, setPhotoView] = useState(null); // {loading, dataUrl}
  // ALL data is deleted 6 months after registration; downloaded archives 1 month after download
  const PHOTO_KEEP_MONTHS = 6;
  const registeredAt = (x) => x.createdAt ?? x.updatedAt ?? Date.parse(x.date) ?? 0;
  const cleanupDone = useRef(false);
  useEffect(() => {
    if (!isAdmin || !companyId || cleanupDone.current) return;
    cleanupDone.current = true;
    (async () => {
      try {
        const lim = new Date();
        lim.setMonth(lim.getMonth() - PHOTO_KEEP_MONTHS);
        const cutoff = lim.getTime();
        const base = ["companies", companyId];
        for (const name of ["receipts", "sales", "vendorPayments"]) {
          const snap = await getDocs(collection(db, ...base, name));
          for (const d of snap.docs) {
            const reg = registeredAt(d.data());
            if (reg < cutoff) {
              await deleteDoc(d.ref);
              if (name === "receipts") await deleteDoc(doc(db, ...base, "photos", d.id)).catch(() => {});
            }
          }
        }
        const arch = await getDocs(collection(db, ...base, "taxArchives"));
        for (const d of arch.docs) {
          if ((d.data().expiresAt || 0) < Date.now()) {
            const ch = await getDocs(collection(d.ref, "chunks"));
            await Promise.all(ch.docs.map((c) => deleteDoc(c.ref)));
            await deleteDoc(d.ref);
          }
        }
      } catch (e) { console.error("자동 정리 실패", e); }
    })();
  }, [isAdmin, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewPhoto = async (id) => {
    setPhotoView({ loading: true });
    try {
      const snap = await getDoc(doc(db, "companies", companyId, "photos", id));
      setPhotoView(snap.exists() ? { dataUrl: snap.data().dataUrl } : { missing: true });
    } catch (e) {
      setPhotoView({ missing: true });
    }
  };

  const cancelPending = () => showNext();

  const deleteReceipt = async (id) => {
    if (!id) {
      console.error("삭제 실패: id가 없습니다", id);
      setError("이 영수증에는 삭제에 필요한 ID가 없습니다 (콘솔 참고)");
      return;
    }
    try {
      await deleteDoc(doc(db, "companies", companyId, "receipts", id));
      deleteDoc(doc(db, "companies", companyId, "photos", id)).catch(() => {});
    } catch (e) {
      console.error("삭제 실패", e);
      setError("삭제에 실패했습니다: " + (e.message || ""));
    }
  };

  const editReceipt = (r) => setPendingBoth(r);

  const setReceiptPaymentType = async (id, paymentType) => {
    if (!id) return;
    try {
      await setDoc(doc(db, "companies", companyId, "receipts", id), { paymentType }, { merge: true });
    } catch (e) {
      console.error("결제구분 변경 실패", e);
      setError("결제구분 변경에 실패했습니다");
    }
  };

  const saveSale = async ({ store, date, amount }) => {
    if (blockIfExpired(store)) return;
    try {
      const id = `${store}__${date}`;
      await setDoc(doc(db, "companies", companyId, "sales", id), { store, date, amount, updatedAt: Date.now() });
    } catch (e) {
      console.error("매출 저장 실패", e);
      setError("매출 저장에 실패했습니다");
    }
  };

  const deleteSale = async (id) => {
    try {
      await deleteDoc(doc(db, "companies", companyId, "sales", id));
    } catch (e) {
      console.error("매출 삭제 실패", e);
      setError("매출 삭제에 실패했습니다");
    }
  };

  const saveVendorPayment = async ({ store, vendor, date, amount, method, memo }) => {
    if (blockIfExpired(store)) return;
    try {
      await addDoc(collection(db, "companies", companyId, "vendorPayments"), { store, vendor, date, amount, method, memo, createdAt: Date.now() });
    } catch (e) {
      console.error("입금 저장 실패", e);
      setError("입금 저장에 실패했습니다");
    }
  };

  const deleteVendorPayment = async (id) => {
    try {
      await deleteDoc(doc(db, "companies", companyId, "vendorPayments", id));
    } catch (e) {
      console.error("입금 삭제 실패", e);
      setError("입금 삭제에 실패했습니다");
    }
  };

  const monthReceipts = visibleReceipts.filter((r) => monthKey(r.date) === selectedMonth);

  const byMonth = {};
  for (const r of visibleReceipts) {
    (byMonth[monthKey(r.date)] = byMonth[monthKey(r.date)] || []).push(r);
  }
  const byDay = {}, byStore = {}, byVendor = {};
  for (const r of monthReceipts) {
    (byDay[r.date] = byDay[r.date] || []).push(r);
    const sk = r.store || "알 수 없음";
    (byStore[sk] = byStore[sk] || []).push(r);
    const vk = r.vendor || "알 수 없음";
    (byVendor[vk] = byVendor[vk] || []).push(r);
  }
  const sumTotal = (list) => list.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const monthlyChartData = Object.keys(byMonth).sort().map((mk) => ({ month: mk, total: sumTotal(byMonth[mk]) }));
  const days = Object.keys(byDay).sort((a, b) => (a < b ? 1 : -1));
  const months = Object.keys(byMonth).sort((a, b) => (a < b ? 1 : -1));
  const stores = Object.keys(byStore).sort((a, b) => sumTotal(byStore[b]) - sumTotal(byStore[a]));
  const vendors = Object.keys(byVendor).sort((a, b) => sumTotal(byVendor[b]) - sumTotal(byVendor[a]));

  const monthsWithData = new Set([currentMonthKey(), selectedMonth]);
  for (const r of visibleReceipts) monthsWithData.add(monthKey(r.date));
  for (const s of sales) monthsWithData.add(monthKey(s.date));
  const availableMonths = Array.from(monthsWithData).filter(Boolean).sort((a, b) => (a < b ? 1 : -1));

  const activeVendor = vendors.includes(selectedVendor) ? selectedVendor : vendors[0];
  const vendorDailyMap = {};
  if (activeVendor) {
    for (const r of byVendor[activeVendor] || []) {
      vendorDailyMap[r.date] = (vendorDailyMap[r.date] || 0) + (Number(r.total) || 0);
    }
  }
  let running = 0;
  const vendorChartData = Object.keys(vendorDailyMap)
    .sort()
    .map((d) => {
      running += vendorDailyMap[d];
      return { date: d.slice(5), 일별: vendorDailyMap[d], 누적: running };
    });

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700&family=Noto+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');

    :root {
      --paper: #F1EADA; --paper-deep: #E7DDC6; --ink: #23201A; --ink-soft: #5B5748;
      --stamp: #A9382B; --line: #C9BEA0; --cover: #2C3B36; --cover-soft: #3E524C; --gold: #B58A3B;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    .app-root {
      font-family: 'Noto Sans KR', sans-serif; background: var(--paper);
      background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px);
      background-size: 28px 28px; background-position: -1px -1px; color: var(--ink); min-height: 100vh; padding-bottom: 100px;
    }
    .header { background: var(--cover); background-image: linear-gradient(160deg, var(--cover), var(--cover-soft));
      color: #EFE7D2; padding: 22px 20px 18px; border-bottom: 6px solid var(--gold); display: flex; justify-content: space-between; align-items: flex-start; }
    .header h1 { font-family: 'Noto Serif KR', serif; font-weight: 700; font-size: 24px; margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
    .header p { margin: 0; font-size: 12px; color: #C9C0A6; font-family: 'IBM Plex Mono', monospace; }
    .who-badge { display: flex; align-items: center; gap: 8px; background: rgba(239,231,210,0.1); border: 1px solid rgba(239,231,210,0.25); border-radius: 999px; padding: 6px 12px; font-size: 12px; }
    .who-badge button { background: none; border: none; color: #EFE7D2; cursor: pointer; display: flex; align-items: center; opacity: 0.8; }
    .who-badge button:hover { opacity: 1; }

    .month-bar { padding: 12px 16px 0; position: relative; }
    .month-picker { position: relative; display: inline-block; }
    .month-picker-btn { font-family: 'Noto Serif KR', serif; font-weight: 700; font-size: 16px; color: var(--cover);
      background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 8px 16px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .month-picker-dropdown { position: absolute; top: calc(100% + 6px); left: 0; background: #fff; border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 8px 20px rgba(35,32,26,0.15); overflow: hidden; z-index: 20; min-width: 140px; max-height: 260px; overflow-y: auto; }
    .month-picker-item { display: block; width: 100%; text-align: left; padding: 10px 16px; border: none; background: none; cursor: pointer;
      font-size: 13.5px; font-family: 'Noto Sans KR', sans-serif; color: var(--ink); }
    .month-picker-item:hover { background: var(--paper-deep); }
    .month-picker-item.active { background: var(--cover); color: #EFE7D2; font-weight: 700; }

    .tabs { display: flex; gap: 6px; padding: 14px 16px 0; overflow-x: auto; }
    .tab-btn { font-weight: 500; font-size: 13.5px; padding: 9px 14px; border-radius: 8px 8px 0 0; border: 1px solid var(--line); border-bottom: none;
      background: var(--paper-deep); color: var(--ink-soft); cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .tab-btn.active { background: var(--paper); color: var(--ink); font-weight: 700; box-shadow: 0 -2px 0 var(--gold) inset; }

    .content { padding: 16px; }
    .section-title { font-family: 'Noto Serif KR', serif; font-weight: 700; font-size: 16px; margin: 18px 0 10px; display: flex; align-items: center; gap: 6px; color: var(--cover); }
    .section-title:first-child { margin-top: 4px; }

    .summary-bar { display: flex; justify-content: space-between; align-items: baseline; background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; }
    .summary-bar .label { font-weight: 700; font-size: 14px; font-family: 'IBM Plex Mono', monospace; }
    .summary-bar .sub { font-size: 11.5px; color: var(--ink-soft); font-family: 'IBM Plex Mono', monospace; }
    .summary-bar .value { font-family: 'IBM Plex Mono', monospace; font-weight: 700; color: var(--stamp); }

    .group-block { margin-bottom: 4px; }
    .cards-wrap { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; margin-bottom: 18px; }

    .tape { background: #FFFDF8; border: 1px solid var(--line); border-radius: 4px 4px 0 0; padding: 14px 14px 16px; position: relative;
      box-shadow: 0 3px 8px rgba(35,32,26,0.08); font-family: 'IBM Plex Mono', monospace; }
    .tape-head { display: flex; justify-content: space-between; align-items: flex-start; }
    .date-badge { display: flex; align-items: baseline; gap: 7px; }
    .date-big { font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: 22px; color: var(--stamp); letter-spacing: 0.5px; }
    .date-dow { font-family: 'Noto Sans KR', sans-serif; font-size: 12px; font-weight: 700; color: var(--ink-soft); background: var(--paper-deep); padding: 2px 7px; border-radius: 5px; }
    .tape-store { font-family: 'Noto Sans KR', sans-serif; font-weight: 700; font-size: 13px; display: flex; align-items: center; margin-top: 8px; }
    .tape-year { font-weight: 400; color: var(--ink-soft); }
    .tape-sep { color: var(--ink-soft); margin: 0 4px; }
    .vendor-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .vendor-chip { background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 7px 13px; font-size: 12.5px; font-weight: 600;
      color: var(--ink-soft); cursor: pointer; display: flex; align-items: center; gap: 7px; font-family: 'Noto Sans KR', sans-serif; }
    .vendor-chip.active { background: var(--cover); color: #EFE7D2; border-color: var(--cover); }
    .vendor-chip-amt { font-family: 'IBM Plex Mono', monospace; font-size: 11px; opacity: 0.85; }

    .sales-summary-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
    .sales-summary-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px; text-align: center; }
    .sales-summary-label { font-size: 11px; color: var(--ink-soft); margin-bottom: 4px; }
    .sales-summary-value { font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: 15px; color: var(--cover); }
    .sales-summary-value.food { color: var(--gold); }
    .sales-summary-value.ratio { color: var(--stamp); }
    .sales-input-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 16px; }
    .sales-input-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-bottom: 10px; }
    .sales-input-row input { border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; font-size: 13.5px; font-family: 'IBM Plex Mono', monospace; }
    .sales-recent-list { display: flex; flex-direction: column; gap: 4px; border-top: 1px dashed var(--line); padding-top: 10px; }
    .sales-recent-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; font-size: 12.5px; font-family: 'IBM Plex Mono', monospace; color: var(--ink-soft); }

    .debt-table { background: #fff; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; margin-bottom: 18px; }
    .debt-table-head, .debt-table-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr 1.2fr; gap: 6px; padding: 10px 12px; align-items: center; }
    .debt-table-head { background: var(--paper-deep); font-size: 11px; color: var(--ink-soft); font-weight: 700; }
    .debt-table-row { border: none; border-top: 1px solid var(--line); background: #fff; width: 100%; text-align: left; cursor: pointer;
      font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink); }
    .debt-table-row:hover { background: var(--paper-deep); }
    .debt-table-row.active { background: #F6E9DA; }
    .debt-vendor-name { font-family: 'Noto Sans KR', sans-serif; font-weight: 700; font-size: 13px; }
    .debt-balance { font-weight: 700; color: var(--stamp); }
    .debt-ledger { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; }
    .debt-ledger-row { display: grid; grid-template-columns: 90px 1fr auto auto; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--line);
      font-size: 12.5px; font-family: 'IBM Plex Mono', monospace; }
    .debt-ledger-row:last-child { border-bottom: none; }
    .debt-ledger-date { color: var(--ink-soft); }
    .debt-plus { color: var(--gold); font-weight: 600; }
    .debt-minus { color: var(--cover); font-weight: 600; }
    .debt-ledger-running { color: var(--ink-soft); font-size: 11.5px; }
    .debt-payment-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 8px; }
    .debt-payment-row input, .debt-payment-row select { border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; font-size: 13px; font-family: 'IBM Plex Mono', monospace; }
    @media (max-width: 560px) {
      .debt-table-head, .debt-table-row { grid-template-columns: 1.4fr 1fr; font-size: 10.5px; }
      .debt-table-head span:nth-child(2), .debt-table-head span:nth-child(3), .debt-table-head span:nth-child(4),
      .debt-table-row span:nth-child(2), .debt-table-row span:nth-child(3), .debt-table-row span:nth-child(4) { display: none; }
      .debt-payment-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 480px) { .sales-summary-row { grid-template-columns: 1fr; } }
    .tape-actions { display: flex; gap: 4px; }
    .icon-btn { background: none; border: none; cursor: pointer; color: var(--ink-soft); padding: 4px; border-radius: 5px; display: flex; }
    .icon-btn:hover { background: var(--paper-deep); color: var(--ink); }
    .icon-btn.danger:hover { background: #F6DEDB; color: var(--stamp); }
    .tape-divider { border-top: 1px dashed var(--line); margin: 10px 0; }
    .tape-items { display: flex; flex-direction: column; gap: 4px; }
    .tape-item { display: flex; justify-content: space-between; font-size: 12.5px; }
    .tape-item-name { color: var(--ink); padding-right: 8px; }
    .tape-item-price { color: var(--ink-soft); }
    .tape-empty { font-size: 12px; color: var(--ink-soft); font-style: italic; }
    .tape-total { display: flex; justify-content: space-between; font-weight: 700; font-size: 14px; color: var(--stamp); }
    .tape-jagged { position: absolute; bottom: -9px; left: 0; right: 0; height: 9px;
      background: linear-gradient(-45deg, var(--paper) 5px, transparent 0) 0 -2px, linear-gradient(45deg, var(--paper) 5px, transparent 0) 0 -2px;
      background-size: 10px 12px; background-repeat: repeat-x; }

    .empty-state { text-align: center; padding: 60px 20px; color: var(--ink-soft); }
    .empty-state h3 { font-family: 'Noto Serif KR', serif; color: var(--cover); margin-bottom: 6px; }

    .fab { position: fixed; bottom: 22px; right: 20px; display: flex; gap: 10px; }
    .fab-btn { background: var(--stamp); color: #fff; border: none; border-radius: 999px; padding: 13px 18px; font-weight: 700; font-size: 13.5px;
      display: flex; align-items: center; gap: 7px; cursor: pointer; box-shadow: 0 4px 14px rgba(169,56,43,0.35); }
    .fab-btn.secondary { background: var(--cover); box-shadow: 0 4px 14px rgba(44,59,54,0.35); }

    .analyzing-banner, .error-banner { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 999px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
    .analyzing-banner { background: var(--cover); color: #EFE7D2; }
    .error-banner { background: var(--stamp); color: #fff; }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(35,32,26,0.55); display: flex; align-items: flex-end; justify-content: center; z-index: 50; }
    .modal { background: var(--paper); width: 100%; max-width: 480px; max-height: 88vh; overflow-y: auto; border-radius: 16px 16px 0 0; padding: 20px; }
    .modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .modal-head h3 { font-family: 'Noto Serif KR', serif; margin: 0; font-size: 17px; }
    .form-row { margin-bottom: 12px; display: flex; flex-direction: column; gap: 5px; }
    .form-row label { font-size: 12px; color: var(--ink-soft); font-weight: 600; }
    .form-row input { border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; font-size: 14px; background: #fff; font-family: 'Noto Sans KR', sans-serif; }
    .form-row input:disabled { background: var(--paper-deep); color: var(--ink-soft); }
    .form-row select { border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; font-size: 14px; background: #fff; font-family: 'Noto Sans KR', sans-serif; }
    .payment-toggle { display: flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
    .payment-toggle button { flex: 1; padding: 9px; border: none; background: #fff; font-size: 13px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
    .payment-toggle button.active { background: var(--cover); color: #EFE7D2; }
    .payment-toggle button.active.paid-later { background: var(--stamp); }
    .paid-later-badge { background: var(--stamp); color: #fff; font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 5px; font-family: 'Noto Sans KR', sans-serif; }
    .tape-payment-toggle { display: flex; gap: 5px; margin-top: 10px; }
    .tape-payment-toggle button { flex: 1; border: 1px solid var(--line); background: #fff; color: var(--ink-soft); border-radius: 7px; padding: 5px 0;
      font-size: 10.5px; font-weight: 700; cursor: pointer; font-family: 'Noto Sans KR', sans-serif; }
    .tape-payment-toggle button.active { background: var(--cover); color: #EFE7D2; border-color: var(--cover); }
    .tape-payment-toggle button.active.paid-later { background: var(--stamp); border-color: var(--stamp); }
    .lock-hint { font-size: 11px; color: var(--ink-soft); display: flex; align-items: center; gap: 4px; }
    .form-items-head { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 8px; }
    .form-items-head label { font-size: 12px; color: var(--ink-soft); font-weight: 600; }
    .mini-btn { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 6px; padding: 5px 9px; font-size: 11.5px; display: flex; align-items: center; gap: 4px; cursor: pointer; color: var(--ink); }
    .form-items { display: flex; flex-direction: column; gap: 6px; }
    .form-item-row { display: grid; grid-template-columns: 1fr 52px 90px 28px; gap: 6px; align-items: center; }
    .form-item-row input { border: 1px solid var(--line); border-radius: 6px; padding: 7px 8px; font-size: 12.5px; background: #fff; font-family: 'IBM Plex Mono', monospace; }
    .fi-name { font-family: 'Noto Sans KR', sans-serif !important; }
    .form-total { display: flex; justify-content: space-between; font-weight: 700; font-family: 'IBM Plex Mono', monospace; margin: 16px 0; font-size: 15px; color: var(--stamp); }
    .modal-actions { display: flex; gap: 8px; }
    .btn-secondary, .btn-primary { flex: 1; padding: 11px; border-radius: 9px; border: none; font-weight: 700; font-size: 13.5px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .btn-secondary { background: var(--paper-deep); color: var(--ink); border: 1px solid var(--line); }
    .btn-primary { background: var(--stamp); color: #fff; }
    .chart-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 18px; }

    .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--cover);
      background-image: radial-gradient(circle at 30% 20%, var(--cover-soft), var(--cover)); padding: 20px; font-family: 'Noto Sans KR', sans-serif; }
    .login-card { background: var(--paper); border-radius: 16px; padding: 28px 24px; width: 100%; max-width: 360px; text-align: center; box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
    .login-stamp { width: 52px; height: 52px; border-radius: 50%; border: 2px solid var(--stamp); color: var(--stamp); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; }
    .login-card h1 { font-family: 'Noto Serif KR', serif; font-size: 20px; margin: 0 0 4px; }
    .login-sub { font-size: 12.5px; color: var(--ink-soft); margin: 0 0 18px; }
    .login-toggle { display: flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; margin-bottom: 14px; }
    .login-toggle.three button { font-size: 11.5px; padding: 9px 4px; }
    .login-toggle button { flex: 1; padding: 9px; border: none; background: #fff; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
    .login-toggle button.active { background: var(--cover); color: #EFE7D2; }
    .login-select, .login-pin { width: 100%; padding: 11px; border-radius: 9px; border: 1px solid var(--line); font-size: 14px; margin-bottom: 10px; font-family: 'Noto Sans KR', sans-serif; background: #fff; }
    .login-pin { font-family: 'IBM Plex Mono', monospace; text-align: center; letter-spacing: 3px; }
    .login-empty { font-size: 12.5px; color: var(--ink-soft); background: var(--paper-deep); border-radius: 8px; padding: 12px; margin-bottom: 10px; }
    .login-err { color: var(--stamp); font-size: 12px; margin-bottom: 10px; }
    .login-submit { width: 100%; background: var(--stamp); color: #fff; border: none; padding: 12px; border-radius: 9px; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 7px; cursor: pointer; }
    .login-submit:disabled { opacity: 0.6; cursor: default; }
    .login-default-hint { margin-top: 12px; font-size: 10.5px; color: var(--ink-soft); }
    .login-divider { display: flex; align-items: center; gap: 10px; margin: 12px 0; color: var(--ink-soft); font-size: 11px; }
    .login-divider::before, .login-divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }
    .google-submit { width: 100%; background: #fff; color: var(--ink); border: 1px solid var(--line); padding: 11px; border-radius: 9px;
      font-weight: 600; font-size: 13.5px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
    .google-submit:disabled { opacity: 0.6; cursor: default; }
    .google-g { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%;
      background: linear-gradient(135deg, #4285F4, #34A853 50%, #FBBC05 75%, #EA4335); color: #fff; font-weight: 800; font-size: 12px; font-family: 'IBM Plex Mono', monospace; }
    .company-code-input { text-align: center; font-family: 'IBM Plex Mono', monospace; letter-spacing: 3px; text-transform: uppercase; }
    .company-code-display { font-family: 'IBM Plex Mono', monospace; font-size: 26px; font-weight: 700; letter-spacing: 4px; color: var(--stamp);
      background: #fff; border: 1px dashed var(--line); border-radius: 10px; padding: 14px; margin-bottom: 16px; }
    .company-code-display.small { font-size: 18px; padding: 10px; margin: 6px 0; text-align: center; }
    .admin-hint { font-size: 11.5px; color: var(--ink-soft); margin: 0 0 4px; }

    .admin-panel { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 18px; }
    .admin-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .admin-row { display: grid; grid-template-columns: 1fr 90px 28px; gap: 8px; align-items: center; }
    .admin-row-name { font-weight: 600; font-size: 13px; }
    .admin-row-pin, .admin-add-row input { border: 1px solid var(--line); border-radius: 6px; padding: 7px 8px; font-size: 12.5px; font-family: 'IBM Plex Mono', monospace; }
    .admin-add-row { display: grid; grid-template-columns: 1fr 90px auto; gap: 8px; align-items: center; }

    @media (max-width: 480px) { .cards-wrap { grid-template-columns: 1fr; } .header { flex-direction: column; gap: 10px; } }
    @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
  `;

  if (authLoading) {
    return <div className="app-root"><style>{styles}</style><div className="empty-state">불러오는 중...</div></div>;
  }

  // billnote.store/admin : operator-only. Login only (no signup / employee code); members are refused.
  if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/admin") {
    const head = (
      <div className="header">
        <div>
          <h1><ShieldCheck size={22} /> BillNote 운영자</h1>
          <p>회원사·매장 이용 기간 관리</p>
        </div>
        {isPlatformOwner && (
          <div className="who-badge">
            <a href="/" style={{ color: "inherit", marginRight: 8 }}>앱으로</a>
            <button onClick={() => signOut(auth)} aria-label="로그아웃"><LogOut size={14} /></button>
          </div>
        )}
      </div>
    );
    let body;
    if (!authUser || authUser.isAnonymous) {
      body = (
        <AdminLogin
          onGoogle={() => signInWithPopup(auth, googleProvider)}
          onEmail={(email, pw) => signInWithEmailAndPassword(auth, email, pw)}
        />
      );
    } else if (!isPlatformOwner) {
      body = <AdminDenied email={authUser.email} onLogout={() => signOut(auth)} />;
    } else {
      body = <div className="content"><PlatformAdminPanel billing={billingInfo} /></div>;
    }
    return (
      <div className="app-root">
        <style>{styles}</style>
        {head}
        {body}
      </div>
    );
  }

  if (!authUser || (authUser.isAnonymous && !companyId)) {
    return (
      <div className="app-root">
        <style>{styles}</style>
        <CompanyGate onOwnerAuth={handleOwnerAuth} onGoogleAuth={handleGoogleAuth} onEmployeeAuth={handleEmployeeAuth} />
      </div>
    );
  }

  if (pendingGoogleUser) {
    return (
      <div className="app-root">
        <style>{styles}</style>
        <GoogleCompanyNameScreen email={pendingGoogleUser.email} onSubmit={completeGoogleSignup} />
      </div>
    );
  }

  if (!configLoaded) {
    return <div className="app-root"><style>{styles}</style><div className="empty-state">불러오는 중...</div></div>;
  }

  if (!isOwner && !session) {
    return (
      <div className="app-root">
        <style>{styles}</style>
        <StoreSelectScreen config={config} onLogin={setSession} />
      </div>
    );
  }

  const handleLogout = async () => {
    if (isOwner) {
      await signOut(auth);
    } else {
      setSession(null);
    }
  };

  return (
    <div className="app-root">
      <style>{styles}</style>

      <div className="header">
        <div>
          <h1><Receipt size={22} /> 영수증 장부</h1>
          <p>사진 한 장으로 매장 지출을 자동 정리합니다</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
        <div className="who-badge" onClick={isAdmin ? handleLogout : undefined} style={isAdmin ? { cursor: "pointer" } : undefined}>
          {isAdmin ? <LogOut size={14} /> : <Store size={14} />}
          {isAdmin ? <b>로그아웃</b> : session.storeName}
          {!isAdmin && <button onClick={handleLogout} aria-label="로그아웃"><LogOut size={14} /></button>}
        </div>
        <a href={KAKAO_URL} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 12px", borderRadius: 999, background: "#FEE500", color: "#191919", fontWeight: 700, fontSize: 12.5, textDecoration: "none" }}>💬 카톡 문의</a>
        </div>
      </div>

      <div className="month-bar">
        <MonthPicker value={selectedMonth} availableMonths={availableMonths} onChange={setSelectedMonth} />
      </div>

      <BillingBanner summary={billingSummary} onOpen={() => setBillingOpen(true)} />

      <div className="tabs">
        <button className={`tab-btn ${tab === "daily" ? "active" : ""}`} onClick={() => setTab("daily")}><Calendar size={14} /> 일별</button>
        <button className={`tab-btn ${tab === "monthly" ? "active" : ""}`} onClick={() => setTab("monthly")}><CalendarDays size={14} /> 월별</button>
        {isAdmin && <button className={`tab-btn ${tab === "store" ? "active" : ""}`} onClick={() => setTab("store")}><Store size={14} /> 매장별</button>}
        <button className={`tab-btn ${tab === "vendor" ? "active" : ""}`} onClick={() => setTab("vendor")}><Truck size={14} /> 구매처</button>
        <button className={`tab-btn ${tab === "debt" ? "active" : ""}`} onClick={() => setTab("debt")}><Wallet size={14} /> 후불관리</button>
        <button className={`tab-btn ${tab === "sales" ? "active" : ""}`} onClick={() => setTab("sales")}><TrendingUp size={14} /> 매출/원가율</button>
        {isAdmin && <button className={`tab-btn ${tab === "tax" ? "active" : ""}`} onClick={() => setTab("tax")}><FileArchive size={14} /> 세무자료</button>}
        <button className={`tab-btn ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}><Receipt size={14} /> 전체</button>
        <button className={`tab-btn ${tab === "manual" ? "active" : ""}`} onClick={() => setTab("manual")}><BookOpen size={14} /> 설명서</button>
        {isAdmin && <button className={`tab-btn ${tab === "manage" ? "active" : ""}`} onClick={() => setTab("manage")}><Settings size={14} /> 매장 관리</button>}
      </div>

      <div className="content">
        {tab === "manual" && (
          <div style={{ margin: "-4px -4px 0" }}>
            <iframe title="BillNote 사용 설명서" src={"/manual.html" + manualHash} style={{ width: "100%", height: "calc(100vh - 170px)", minHeight: 480, border: 0, borderRadius: 10, background: "#fff" }} />
            <div style={{ textAlign: "center", fontSize: 12, marginTop: 6 }}>
              <a href="/manual.html" target="_blank" rel="noopener noreferrer">설명서를 새 창에서 크게 보기</a>
            </div>
          </div>
        )}
        {tab === "manage" && isAdmin && <StoreAdminPanel config={config} onUpdateConfig={persistConfig} onUpdateCompanyCode={updateCompanyCode} onMigrateOldData={migrateOldData} />}

        {tab === "tax" && isAdmin && (
          <TaxExportView registeredAt={registeredAt} keepMonths={PHOTO_KEEP_MONTHS} companyId={companyId} storeOptions={config.stores.map((s) => s.name)} receipts={receipts} sales={sales} payments={payments} companyName={config.companyName || ""} defaultMonth={selectedMonth} />
        )}

        {tab === "debt" && (
          <DebtView
            storeOptions={isAdmin ? config.stores.map((s) => s.name) : [session.storeName]}
            lockedStore={isAdmin ? null : session.storeName}
            receipts={receipts}
            payments={payments}
            month={selectedMonth}
            onSavePayment={saveVendorPayment}
            onDeletePayment={deleteVendorPayment}
          />
        )}

        {tab === "sales" && (
          <SalesView
            storeOptions={isAdmin ? config.stores.map((s) => s.name) : [session.storeName]}
            lockedStore={isAdmin ? null : session.storeName}
            receipts={receipts}
            sales={sales}
            month={selectedMonth}
            onSaveSale={saveSale}
            onDeleteSale={deleteSale}
          />
        )}


        {tab !== "manage" && tab !== "manual" && tab !== "sales" && tab !== "debt" && !receiptsLoaded && <div className="empty-state">불러오는 중...</div>}


        {tab !== "manage" && tab !== "manual" && tab !== "sales" && tab !== "debt" && tab !== "monthly" && receiptsLoaded && monthReceipts.length === 0 && (
          <div className="empty-state">
            <h3>아직 기록된 영수증이 없습니다</h3>
            <p>오른쪽 아래 버튼으로 영수증 사진을 올려보세요.<br />쿠팡·인터넷 주문은 핸드폰 주문내역 화면을 캡처해서 올리면 됩니다.</p>
          </div>
        )}

        {tab === "daily" && receiptsLoaded && days.map((d) => (
          <div className="group-block" key={d}>
            <div className="summary-bar">
              <div><div className="label">{d}</div><div className="sub">{byDay[d].length}건</div></div>
              <div className="value">{won(sumTotal(byDay[d]))}</div>
            </div>
            <div className="cards-wrap">
              {byDay[d].map((r) => <TapeCard key={r.id} receipt={r} onEdit={editReceipt} onDelete={deleteReceipt} onSetPaymentType={setReceiptPaymentType} onViewPhoto={viewPhoto} showStore={isAdmin} />)}
            </div>
          </div>
        ))}

        {tab === "monthly" && receiptsLoaded && (
          <>
            {monthlyChartData.length > 1 && (
              <div className="chart-card">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid stroke="#E7DDC6" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => won(v)} />
                    <Bar dataKey="total" fill="#A9382B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {months.map((m) => (
              <div className="group-block" key={m}>
                <div className="summary-bar">
                  <div><div className="label">{m}</div><div className="sub">{byMonth[m].length}건</div></div>
                  <div className="value">{won(sumTotal(byMonth[m]))}</div>
                </div>
                <div className="cards-wrap">
                  {byMonth[m].map((r) => <TapeCard key={r.id} receipt={r} onEdit={editReceipt} onDelete={deleteReceipt} onSetPaymentType={setReceiptPaymentType} onViewPhoto={viewPhoto} showStore={isAdmin} />)}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "store" && isAdmin && receiptsLoaded && stores.map((s) => (
          <div className="group-block" key={s}>
            <div className="summary-bar">
              <div><div className="label">{s}</div><div className="sub">{byStore[s].length}건</div></div>
              <div className="value">{won(sumTotal(byStore[s]))}</div>
            </div>
            <div className="cards-wrap">
              {byStore[s].map((r) => <TapeCard key={r.id} receipt={r} onEdit={editReceipt} onDelete={deleteReceipt} onSetPaymentType={setReceiptPaymentType} onViewPhoto={viewPhoto} showStore={false} />)}
            </div>
          </div>
        ))}

        {tab === "vendor" && receiptsLoaded && vendors.length > 0 && (
          <>
            <div className="vendor-chips">
              {vendors.map((v) => (
                <button
                  key={v}
                  className={`vendor-chip ${v === activeVendor ? "active" : ""}`}
                  onClick={() => setSelectedVendor(v)}
                >
                  {v}
                  <span className="vendor-chip-amt">{won(sumTotal(byVendor[v]))}</span>
                </button>
              ))}
            </div>

            {activeVendor && (
              <>
                <div className="summary-bar">
                  <div><div className="label">{activeVendor}</div><div className="sub">{byVendor[activeVendor].length}건</div></div>
                  <div className="value">누적 {won(sumTotal(byVendor[activeVendor]))}</div>
                </div>

                {vendorChartData.length > 1 && (
                  <div className="chart-card">
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={vendorChartData}>
                        <CartesianGrid stroke="#E7DDC6" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                        <Tooltip formatter={(v) => won(v)} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar yAxisId="left" dataKey="일별" fill="#B58A3B" radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="누적" stroke="#A9382B" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="cards-wrap">
                  {byVendor[activeVendor]
                    .slice()
                    .sort((a, b) => (a.date < b.date ? 1 : -1))
                    .map((r) => (
                      <TapeCard key={r.id} receipt={r} onEdit={editReceipt} onDelete={deleteReceipt} onSetPaymentType={setReceiptPaymentType} onViewPhoto={viewPhoto} showStore={isAdmin} />
                    ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "all" && receiptsLoaded && (
          <div className="cards-wrap">
            {monthReceipts.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((r) => (
              <TapeCard key={r.id} receipt={r} onEdit={editReceipt} onDelete={deleteReceipt} onSetPaymentType={setReceiptPaymentType} onViewPhoto={viewPhoto} showStore={isAdmin} />
            ))}
          </div>
        )}
      </div>

      <div style={{ textAlign: "center", padding: "12px 12px 0" }}>
        <a href={KAKAO_URL} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", padding: "10px 22px", borderRadius: 10, background: "#FEE500", color: "#191919", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>💬 카카오톡으로 문의하기</a>
      </div>
      <div style={{ textAlign: "center", fontSize: 11, opacity: 0.6, padding: "16px 12px 110px" }}>
        다운로드한 자료는 1개월 후 삭제되며, 모든 자료는 등록 {PHOTO_KEEP_MONTHS}개월 후 삭제됩니다.<br />
        <button onClick={() => setA2hsOpen(true)} style={{ background: "none", border: "none", textDecoration: "underline", color: "inherit", fontSize: 11, cursor: "pointer", marginTop: 4 }}>휴대폰 바탕화면에 추가하는 방법</button>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onPickFile} />
      <input ref={galleryInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onPickFile} />

      <div className="fab">
        <button className="fab-btn secondary" onClick={() => { if (!blockIfExpired()) galleryInputRef.current?.click(); }}><ImageIcon size={16} /> 앨범에서 여러 장 선택</button>
        <button className="fab-btn" onClick={() => { if (!blockIfExpired()) setCameraOpen(true); }}><Camera size={16} /> 연속 촬영</button>
      </div>

      {analyzing && <div className="analyzing-banner"><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> 영수증 판독 중{progress ? ` (${Math.min(progress.done + 1, progress.total)}/${progress.total})` : "..."}</div>}
      {notice && !analyzing && <div className="analyzing-banner">{notice}</div>}
      {error && !analyzing && <div className="error-banner">{error}</div>}

      {a2hsOpen && <AddToHomeModal onClose={() => setA2hsOpen(false)} />}

      {billingOpen && <BillingModal list={billingList} billing={billingInfo} company={companyDoc} onClose={() => setBillingOpen(false)} />}
      {welcomeBilling && <WelcomeModal company={companyDoc} onClose={() => setWelcomeBilling(false)} onMore={() => { setWelcomeBilling(false); setManualHash("#price"); setTab("manual"); }} />}

      {cameraOpen && (
        <CameraCapture
          onCancel={() => setCameraOpen(false)}
          onDone={(files) => { setCameraOpen(false); handleFiles(files); }}
          onUnavailable={() => { setCameraOpen(false); setError("카메라를 열 수 없어 기본 카메라로 전환합니다"); fileInputRef.current?.click(); }}
        />
      )}

      {photoView && (
        <div className="modal-backdrop" onClick={() => setPhotoView(null)} style={{ zIndex: 1100, alignItems: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 10, maxWidth: "94vw", maxHeight: "92vh", overflow: "auto" }}>
            {photoView.loading && <div style={{ padding: 30 }}><Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} /> 불러오는 중...</div>}
            {photoView.missing && <div style={{ padding: 30 }}>사진을 찾을 수 없습니다</div>}
            {photoView.dataUrl && <img src={photoView.dataUrl} alt="영수증" style={{ maxWidth: "100%", display: "block" }} />}
            <button className="btn-secondary" style={{ marginTop: 8, width: "100%" }} onClick={() => setPhotoView(null)}>닫기</button>
          </div>
        </div>
      )}

      {pending && queueCount > 0 && <div className="analyzing-banner" style={{ top: 12, bottom: "auto", zIndex: 1000 }}>대기 중인 영수증 {queueCount}장 더 있음</div>}
      {pending && (
        <ReceiptForm
          initial={pending}
          onCancel={cancelPending}
          onSave={saveReceipt}
          lockStoreName={isAdmin ? null : session.storeName}
        />
      )}
    </div>
  );
}

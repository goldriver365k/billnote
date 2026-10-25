import React, { useState } from "react";
import { X } from "lucide-react";

const ua = () => (typeof navigator !== "undefined" ? navigator.userAgent : "");
export const isIOS = () => /iPhone|iPad|iPod/i.test(ua());
export const isAndroid = () => /Android/i.test(ua());
export const isStandalone = () =>
  typeof window !== "undefined" &&
  ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);

export function AddToHomeModal({ onClose }) {
  const [tab, setTab] = useState(isIOS() ? "ios" : "android");
  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)}
      style={{ flex: 1, padding: "9px 6px", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer",
        background: tab === k ? "#2f4f3f" : "rgba(0,0,0,0.07)", color: tab === k ? "#fff" : "inherit" }}>
      {label}
    </button>
  );
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1400, alignItems: "center" }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ borderRadius: 16, maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>휴대폰 바탕화면에 추가하기</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기"><X size={16} /></button>
        </div>
        <p style={{ fontSize: 13, margin: "0 0 10px", lineHeight: 1.6 }}>
          홈 화면에 추가해 두면 앱처럼 아이콘을 눌러 바로 열 수 있고, 영수증 촬영도 더 빠릅니다.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {tabBtn("android", "안드로이드")}
          {tabBtn("ios", "아이폰")}
        </div>

        {tab === "android" ? (
          <ol style={{ fontSize: 14, lineHeight: 1.9, paddingLeft: 20, margin: 0 }}>
            <li><b>크롬(Chrome)</b>으로 <b>billnote.store</b>에 접속합니다.</li>
            <li>오른쪽 위 <b>점 세 개(⋮)</b> 메뉴를 누릅니다.</li>
            <li><b>"홈 화면에 추가"</b> 또는 <b>"앱 설치"</b>를 누릅니다.</li>
            <li><b>추가</b>(설치)를 누르면 바탕화면에 아이콘이 생깁니다.</li>
          </ol>
        ) : (
          <ol style={{ fontSize: 14, lineHeight: 1.9, paddingLeft: 20, margin: 0 }}>
            <li><b>사파리(Safari)</b>로 <b>billnote.store</b>에 접속합니다.</li>
            <li>아래쪽 가운데 <b>공유 버튼(□ 위로 화살표)</b>을 누릅니다.</li>
            <li>메뉴를 올려서 <b>"홈 화면에 추가"</b>를 누릅니다.</li>
            <li>오른쪽 위 <b>추가</b>를 누르면 바탕화면에 아이콘이 생깁니다.</li>
          </ol>
        )}

        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 12, lineHeight: 1.6 }}>
          카카오톡 등 다른 앱 안에서 연 화면에서는 추가되지 않을 수 있습니다. 이때는 오른쪽 위 메뉴에서 <b>"다른 브라우저로 열기"</b>를 눌러 {tab === "ios" ? "사파리" : "크롬"}에서 여세요.
        </div>
        <button className="btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={onClose}>확인</button>
      </div>
    </div>
  );
}

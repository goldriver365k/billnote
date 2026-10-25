import React, { useEffect, useRef, useState } from "react";
import { Camera, X, Check, Loader2 } from "lucide-react";

// Full-screen continuous camera: keep shooting, then press 완료 to send all shots at once.
export default function CameraCapture({ onDone, onCancel, onUnavailable }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState([]); // [{file, url}]
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e) {
        console.error("카메라 열기 실패", e);
        if (!cancelled) onUnavailable();
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `shot-${Date.now()}.jpg`, { type: "image/jpeg" });
      setShots((p) => [...p, { file, url: URL.createObjectURL(blob) }]);
    }, "image/jpeg", 0.9);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(30);
  };

  const removeShot = (i) => setShots((p) => { URL.revokeObjectURL(p[i].url); return p.filter((_, k) => k !== i); });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 2000, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        {!ready && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} /> &nbsp;카메라 여는 중...</div>}
        {flash && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.6 }} />}
        <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 13, textShadow: "0 1px 3px #000" }}>
          영수증을 한 장씩 계속 찍으세요 · 같은 영수증은 한 번만 등록됩니다
        </div>
      </div>

      {shots.length > 0 && (
        <div style={{ display: "flex", gap: 6, padding: "8px 10px", overflowX: "auto", background: "#111" }}>
          {shots.map((s, i) => (
            <div key={s.url} style={{ position: "relative", flex: "0 0 auto" }}>
              <img src={s.url} alt="" style={{ height: 56, width: 44, objectFit: "cover", borderRadius: 4, display: "block" }} />
              <button onClick={() => removeShot(i)} aria-label="삭제"
                style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: 9, border: "none", background: "#c0392b", color: "#fff", fontSize: 11, lineHeight: "18px", padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px calc(14px + env(safe-area-inset-bottom))", background: "#111" }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "#fff", fontSize: 14, display: "flex", alignItems: "center", gap: 4 }}><X size={16} /> 취소</button>
        <button onClick={shoot} disabled={!ready} aria-label="촬영"
          style={{ width: 68, height: 68, borderRadius: 34, border: "4px solid #fff", background: ready ? "#e74c3c" : "#555", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Camera size={26} />
        </button>
        <button onClick={() => onDone(shots.map((s) => s.file))} disabled={shots.length === 0}
          style={{ background: shots.length ? "#2e8b57" : "#444", border: "none", color: "#fff", fontSize: 14, borderRadius: 999, padding: "10px 16px", display: "flex", alignItems: "center", gap: 4 }}>
          <Check size={16} /> 완료 ({shots.length}장)
        </button>
      </div>
    </div>
  );
}

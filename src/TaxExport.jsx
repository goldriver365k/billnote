import React, { useState, useMemo, useEffect } from "react";
import { FileArchive, Loader2, Download, Trash2 } from "lucide-react";
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

const num = (n) => Number(n) || 0;
const mk = (d) => (d || "").slice(0, 7);
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// BOM so Excel opens Korean text correctly
const toCsv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");


const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const CHUNK = 700000; // chars per Firestore chunk doc (limit is ~1MiB)
const ONE_MONTH_MS = 31 * 24 * 3600 * 1000;
const fmtDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(b / 1024)) + "KB");

function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const blobToBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result.split(",")[1]);
  r.onerror = () => rej(new Error("파일 변환 실패"));
  r.readAsDataURL(blob);
});

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export default function TaxExportView({ keepMonths = 6, registeredAt, companyId, storeOptions, receipts, sales, payments, companyName, defaultMonth }) {
  const [from, setFrom] = useState(defaultMonth);
  const [to, setTo] = useState(defaultMonth);
  const [store, setStore] = useState("전체");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [withPhotos, setWithPhotos] = useState(true);
  const [photoProgress, setPhotoProgress] = useState("");
  const [archives, setArchives] = useState([]);

  useEffect(() => {
    if (!companyId) return;
    return onSnapshot(collection(db, "companies", companyId, "taxArchives"), (snap) => {
      setArchives(snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => b.downloadedAt - a.downloadedAt));
    }, (e) => console.error("보관함 불러오기 실패", e));
  }, [companyId]);

  const inRange = (d) => { const k = mk(d); return k >= from && k <= to; };
  const storeOk = (s) => store === "전체" || s === store;

  const data = useMemo(() => {
    const r = receipts.filter((x) => inRange(x.date) && storeOk(x.store)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const s = sales.filter((x) => inRange(x.date) && storeOk(x.store)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const p = payments.filter((x) => inRange(x.date) && storeOk(x.store)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    return { r, s, p };
  }, [receipts, sales, payments, from, to, store]); // eslint-disable-line react-hooks/exhaustive-deps

  // anything registered more than (keepMonths - 1) months ago expires within 30 days
  const soon = useMemo(() => {
    const lim = new Date(); lim.setMonth(lim.getMonth() - keepMonths); lim.setDate(lim.getDate() + 30);
    const ms = lim.getTime();
    const cnt = (list) => list.filter((x) => registeredAt(x) < ms).length;
    return cnt(receipts) + cnt(sales) + cnt(payments);
  }, [receipts, sales, payments, keepMonths]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPurchase = data.r.reduce((a, x) => a + num(x.total), 0);
  const totalSales = data.s.reduce((a, x) => a + num(x.amount), 0);

  const makeZip = async () => {
    setErr("");
    if (from > to) { setErr("시작 월이 종료 월보다 늦습니다"); return; }
    setBusy(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const { r, s, p } = data;

      const safe = (v) => String(v || "").replace(/[\\/:*?"<>|\s]+/g, "_");
      const photoName = (x) => `${x.date}_${safe(x.store)}_${safe(x.vendor)}_${num(x.total)}_${String(x.id).slice(0, 6)}.jpg`;
      let photoCount = 0, photoMissing = 0;
      if (withPhotos) {
        const targets = r.filter((x) => x.hasPhoto);
        const folder = zip.folder("영수증사진");
        for (let i = 0; i < targets.length; i += 8) {
          setPhotoProgress(`사진 가져오는 중 ${Math.min(i + 8, targets.length)}/${targets.length}`);
          await Promise.all(targets.slice(i, i + 8).map(async (x) => {
            try {
              const snap = await getDoc(doc(db, "companies", companyId, "photos", x.id));
              if (snap.exists()) {
                folder.file(photoName(x), snap.data().dataUrl.split(",")[1], { base64: true });
                x._photoFile = photoName(x); photoCount++;
              } else photoMissing++;
            } catch (e) { photoMissing++; }
          }));
        }
        setPhotoProgress("");
      }

      zip.file("1_매입내역(영수증별).csv", toCsv([
        ["날짜", "매장", "구매처", "합계금액", "결제구분", "결제수단", "지급예정일", "메모", "사진파일"],
        ...r.map((x) => [x.date, x.store, x.vendor, num(x.total), x.paymentType || "", x.paymentMethod || "", x.dueDate || "", x.memo || "", x._photoFile ? "영수증사진/" + x._photoFile : ""]),
      ]));

      zip.file("2_매입품목상세.csv", toCsv([
        ["날짜", "매장", "구매처", "품목", "수량", "금액"],
        ...r.flatMap((x) => (x.items || []).map((i) => [x.date, x.store, x.vendor, i.name, num(i.qty), num(i.price)])),
      ]));

      const byVendor = {};
      r.forEach((x) => {
        const k = x.vendor || "(미상)";
        byVendor[k] = byVendor[k] || { cnt: 0, total: 0, credit: 0 };
        byVendor[k].cnt++; byVendor[k].total += num(x.total);
        if (x.paymentType === "후불") byVendor[k].credit += num(x.total);
      });
      zip.file("3_구매처별합계.csv", toCsv([
        ["구매처", "건수", "매입합계", "그중 후불"],
        ...Object.entries(byVendor).sort((a, b) => b[1].total - a[1].total).map(([v, o]) => [v, o.cnt, o.total, o.credit]),
        ["합계", r.length, totalPurchase, r.filter((x) => x.paymentType === "후불").reduce((a, x) => a + num(x.total), 0)],
      ]));

      zip.file("4_매출내역(일별).csv", toCsv([
        ["날짜", "매장", "매출액"],
        ...s.map((x) => [x.date, x.store, num(x.amount)]),
        ["합계", "", totalSales],
      ]));

      const months = monthsBetween(from, to);
      const monthRows = months.map((m) => {
        const pur = r.filter((x) => mk(x.date) === m).reduce((a, x) => a + num(x.total), 0);
        const sal = s.filter((x) => mk(x.date) === m).reduce((a, x) => a + num(x.amount), 0);
        const cred = r.filter((x) => mk(x.date) === m && x.paymentType === "후불").reduce((a, x) => a + num(x.total), 0);
        const paid = p.filter((x) => mk(x.date) === m).reduce((a, x) => a + num(x.amount), 0);
        return [m, sal, pur, sal ? (pur / sal * 100).toFixed(1) + "%" : "", cred, paid];
      });
      zip.file("5_월별요약.csv", toCsv([
        ["월", "매출", "매입(식자재)", "원가율", "후불 매입", "후불 입금"],
        ...monthRows,
        ["합계", totalSales, totalPurchase, totalSales ? (totalPurchase / totalSales * 100).toFixed(1) + "%" : "", "", ""],
      ]));

      zip.file("6_후불입금내역.csv", toCsv([
        ["날짜", "매장", "구매처", "입금액", "방법", "메모"],
        ...p.map((x) => [x.date, x.store, x.vendor, num(x.amount), x.method || "", x.memo || ""]),
      ]));

      zip.file("읽어주세요.txt",
        `BillNote 세무자료\r\n회사: ${companyName || ""}\r\n기간: ${from} ~ ${to}\r\n매장: ${store}\r\n생성일: ${new Date().toISOString().slice(0, 10)}\r\n\r\n` +
        `- 모든 CSV 파일은 엑셀에서 바로 열 수 있습니다.\r\n- 금액은 영수증 판독값이며 부가세 구분은 포함되어 있지 않습니다.\r\n- 영수증 사진은 '영수증사진' 폴더에 들어 있습니다(${photoCount}장). 사진 저장 기능 도입 이전 영수증은 사진이 없습니다.\r\n`);

      setPhotoProgress("압축 파일 만드는 중...");
      const blob = await zip.generateAsync({ type: "blob" });
      const fileName = `세무자료_${from}_${to}_${store}.zip`;
      saveBlob(blob, fileName);

      // keep a copy in the 보관함 (deleted 1 month after download)
      if (blob.size <= MAX_ARCHIVE_BYTES) {
        try {
          setPhotoProgress("보관함에 저장하는 중...");
          const b64 = await blobToBase64(blob);
          const id = String(Date.now());
          const n = Math.ceil(b64.length / CHUNK);
          for (let i = 0; i < n; i++) {
            await setDoc(doc(db, "companies", companyId, "taxArchives", id, "chunks", String(i).padStart(4, "0")), { data: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
          }
          const now = Date.now();
          await setDoc(doc(db, "companies", companyId, "taxArchives", id), {
            name: fileName, from, to, store, size: blob.size, chunks: n, withPhotos, receiptCount: r.length,
            downloadedAt: now, expiresAt: now + ONE_MONTH_MS,
          });
        } catch (ae) {
          console.error("보관함 저장 실패", ae);
          setErr("다운로드는 되었지만 보관함 저장에 실패했습니다");
        }
      } else {
        setErr("다운로드는 되었지만 파일이 커서(40MB 초과) 보관함에는 저장하지 않았습니다. 기간을 나누어 받으세요.");
      }
      setPhotoProgress("");
    } catch (e) {
      console.error(e);
      setErr("압축 파일 생성에 실패했습니다: " + (e.message || ""));
    }
    setBusy(false);
  };

  const redownload = async (a) => {
    setErr(""); setBusy(true); setPhotoProgress("보관함에서 불러오는 중...");
    try {
      const snap = await getDocs(collection(db, "companies", companyId, "taxArchives", a.id, "chunks"));
      const b64 = snap.docs.sort((x, y) => x.id.localeCompare(y.id)).map((d) => d.data().data).join("");
      const res = await fetch("data:application/zip;base64," + b64);
      saveBlob(await res.blob(), a.name);
    } catch (e) {
      console.error(e);
      setErr("보관함 파일을 불러오지 못했습니다");
    }
    setPhotoProgress(""); setBusy(false);
  };

  const removeArchive = async (a) => {
    if (!window.confirm(`${a.name} 파일을 보관함에서 삭제할까요?`)) return;
    try {
      const snap = await getDocs(collection(db, "companies", companyId, "taxArchives", a.id, "chunks"));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, "companies", companyId, "taxArchives", a.id));
    } catch (e) { setErr("삭제에 실패했습니다"); }
  };

  return (
    <div>
      <div className="tape-card" style={{ padding: 16 }}>
        <h3 style={{ margin: "0 0 10px" }}>자료 보관 안내</h3>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          · 다운로드한 자료는 <b>1개월 후</b> 삭제됩니다.<br />
          · 모든 자료(영수증·사진·매출·입금)는 <b>등록 {keepMonths}개월 후</b> 삭제됩니다.
          {soon > 0 && <div style={{ color: "var(--stamp)", marginTop: 6 }}><b>30일 안에 삭제될 자료 {soon}건</b> - 미리 ZIP으로 받아 두세요.</div>}
        </div>
      </div>

      <div className="tape-card" style={{ padding: 16 }}>
        <h3 style={{ margin: "0 0 12px" }}>세무서 제출자료 만들기</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>~</span>
          <input type="month" value={to} onChange={(e) => setTo(e.target.value)} />
          <select value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="전체">전체 매장</option>
            {storeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
          영수증 {data.r.length}건 · 매입 {totalPurchase.toLocaleString("ko-KR")}원<br />
          매출 입력 {data.s.length}일 · 매출 {totalSales.toLocaleString("ko-KR")}원<br />
          후불 입금 {data.p.length}건
        </div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} /> 영수증 사진 포함 ({data.r.filter((x) => x.hasPhoto).length}장)
        </label>
        <button className="fab-btn" style={{ position: "static" }} onClick={makeZip} disabled={busy || (!data.r.length && !data.s.length)}>
          {busy ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <FileArchive size={16} />} ZIP 파일 내려받기
        </button>
        {photoProgress && <div style={{ fontSize: 13, marginTop: 8 }}>{photoProgress}</div>}
        {err && <div style={{ color: "var(--stamp)", marginTop: 8, fontSize: 13 }}>{err}</div>}
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>
          매입내역, 품목상세, 구매처별 합계, 매출, 월별요약, 후불입금 내역이 CSV(엑셀)로, 영수증 사진은 폴더로 들어갑니다.
        </p>
      </div>

      <div className="tape-card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ margin: "0 0 10px" }}>세무자료 보관함</h3>
        {archives.length === 0 && <div style={{ fontSize: 13, opacity: 0.7 }}>보관 중인 자료가 없습니다. ZIP을 내려받으면 여기에 보관됩니다.</div>}
        {archives.map((a) => {
          const left = Math.ceil((a.expiresAt - Date.now()) / 86400000);
          return (
            <div key={a.id} style={{ borderTop: "1px dashed rgba(0,0,0,0.2)", padding: "10px 0", fontSize: 13 }}>
              <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{a.name}</div>
              <div style={{ opacity: 0.8, lineHeight: 1.7 }}>
                다운로드한 날짜: {fmtDate(a.downloadedAt)} · {fmtSize(a.size)}<br />
                삭제 예정일: {fmtDate(a.expiresAt)} ({left > 0 ? `${left}일 남음` : "곧 삭제"})
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button className="btn-secondary" onClick={() => redownload(a)} disabled={busy}><Download size={13} /> 다시 받기</button>
                <button className="btn-secondary" onClick={() => removeArchive(a)} disabled={busy}><Trash2 size={13} /> 삭제</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

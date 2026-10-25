import React, { useState, useMemo } from "react";
import { FileArchive, Loader2 } from "lucide-react";

const num = (n) => Number(n) || 0;
const mk = (d) => (d || "").slice(0, 7);
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// BOM so Excel opens Korean text correctly
const toCsv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

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

export default function TaxExportView({ storeOptions, receipts, sales, payments, companyName, defaultMonth }) {
  const [from, setFrom] = useState(defaultMonth);
  const [to, setTo] = useState(defaultMonth);
  const [store, setStore] = useState("전체");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const inRange = (d) => { const k = mk(d); return k >= from && k <= to; };
  const storeOk = (s) => store === "전체" || s === store;

  const data = useMemo(() => {
    const r = receipts.filter((x) => inRange(x.date) && storeOk(x.store)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const s = sales.filter((x) => inRange(x.date) && storeOk(x.store)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const p = payments.filter((x) => inRange(x.date) && storeOk(x.store)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    return { r, s, p };
  }, [receipts, sales, payments, from, to, store]); // eslint-disable-line react-hooks/exhaustive-deps

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

      zip.file("1_매입내역(영수증별).csv", toCsv([
        ["날짜", "매장", "구매처", "합계금액", "결제구분", "결제수단", "지급예정일", "메모"],
        ...r.map((x) => [x.date, x.store, x.vendor, num(x.total), x.paymentType || "", x.paymentMethod || "", x.dueDate || "", x.memo || ""]),
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
        `- 모든 CSV 파일은 엑셀에서 바로 열 수 있습니다.\r\n- 금액은 영수증 판독값이며 부가세 구분은 포함되어 있지 않습니다.\r\n- 영수증 원본 사진은 포함되어 있지 않습니다(앱에 사진을 저장하지 않음). 원본은 별도로 보관해 주세요.\r\n`);

      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `세무자료_${from}_${to}_${store}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      console.error(e);
      setErr("압축 파일 생성에 실패했습니다: " + (e.message || ""));
    }
    setBusy(false);
  };

  return (
    <div>
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
        <button className="fab-btn" style={{ position: "static" }} onClick={makeZip} disabled={busy || (!data.r.length && !data.s.length)}>
          {busy ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <FileArchive size={16} />} ZIP 파일 내려받기
        </button>
        {err && <div style={{ color: "var(--stamp)", marginTop: 8, fontSize: 13 }}>{err}</div>}
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>
          매입내역, 품목상세, 구매처별 합계, 매출, 월별요약, 후불입금 내역이 CSV(엑셀)로 들어갑니다. 영수증 원본 사진은 포함되지 않습니다.
        </p>
      </div>
    </div>
  );
}

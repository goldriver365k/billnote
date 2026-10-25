// Daily job (09:00 KST): companies that never paid within 1 month of signup get a warning mail,
// and are deleted 7 days later if there is still no paid period.
//
// SAFETY: nothing is sent or deleted unless env AUTO_CLEANUP_LIVE = "true" (otherwise it only logs what it WOULD do).
// Required env (scope: Functions): FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
//                                  GMAIL_USER, GMAIL_APP_PASSWORD
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import nodemailer from "nodemailer";

const DAY = 86400000;
const GRACE_DAYS_NO_PAYMENT = 30;
const WARN_DAYS = 7;
const OPERATOR_EMAILS = ["goldriver365@gmail.com", "higidia@gmail.com"];
const KAKAO_URL = "https://open.kakao.com/o/suBuN0Ti";
const SITE = "https://billnote.store";
const BANK = "새마을금고 9003-2378-7668-0 (예금주 김형신)";

const fmt = (ms) => {
  const d = new Date(ms + 9 * 3600 * 1000); // KST
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

function init() {
  if (getApps().length) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

function mailBody(name, deleteOn) {
  const text =
`안녕하세요, BillNote입니다.

${name ? `${name} 님은 ` : ""}BillNote 회원가입 후 1개월이 지났지만 아직 유료 이용 내역이 없습니다.

▶ ${fmt(deleteOn)} 까지 유료 이용(입금)이 확인되지 않으면, 등록하신 모든 자료
  (매장, 영수증, 영수증 사진, 매출, 후불 입금, 세무자료 보관함)와 회원 계정이 자동으로 삭제되며 복구할 수 없습니다.

삭제를 원하지 않으시면 위 날짜 전에 아래 계좌로 입금해 주세요. (부가세 별도)
- 기본(월 300장 미만): 1개월 5,000원 / 1년 50,000원
- 300장 이상: 1개월 10,000원 / 1년 100,000원
- 입금 계좌: ${BANK}
- 입금자명에 회사명을 적고, 연장할 매장명을 카카오톡으로 알려 주세요.
- 세금계산서가 필요하시면 카카오톡으로 사업자등록번호를 보내 주세요.

삭제 전에 필요한 자료는 ${SITE} 의 [세무자료] 탭에서 ZIP으로 내려받으실 수 있습니다.
(조회와 ZIP 다운로드는 이용 기간이 끝난 뒤에도 가능합니다.)

문의: ${KAKAO_URL}

감사합니다.`;
  return text;
}

export default async () => {
  const live = process.env.AUTO_CLEANUP_LIVE === "true";
  const log = [];
  try {
    init();
    const db = getFirestore();
    const auth = getAuth();
    const mailer = live
      ? nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
      : null;

    const now = Date.now();
    const snap = await db.collection("companies").get();
    for (const d of snap.docs) {
      const c = d.data();
      const tag = `${c.companyName || ""}<${c.email || ""}>`;
      if (c.protected === true) continue;
      if (!c.email || OPERATOR_EMAILS.includes(c.email)) continue;
      if (!c.trialStartedAt) continue; // not yet migrated to the trial system

      const cfg = await d.ref.collection("config").doc("store").get();
      const stores = cfg.exists ? cfg.data().stores || [] : [];
      const paidEver = stores.some((s) => (s.paidUntil || 0) > 0);

      if (paidEver) {
        if (c.deletionWarnedAt) await d.ref.update({ deletionWarnedAt: FieldValue.delete() });
        continue;
      }

      if (!c.deletionWarnedAt) {
        if (now - c.trialStartedAt < GRACE_DAYS_NO_PAYMENT * DAY) continue;
        const deleteOn = now + WARN_DAYS * DAY;
        log.push(`${live ? "WARN" : "DRY-WARN"} ${tag} -> delete on ${fmt(deleteOn)}`);
        if (live) {
          await mailer.sendMail({
            from: `BillNote <${process.env.GMAIL_USER}>`,
            to: c.email,
            subject: `[BillNote] ${fmt(deleteOn)} 까지 이용 결제가 없으면 모든 자료가 삭제됩니다`,
            text: mailBody(c.companyName, deleteOn),
          });
          await d.ref.update({ deletionWarnedAt: now });
        }
      } else if (now - c.deletionWarnedAt >= WARN_DAYS * DAY) {
        log.push(`${live ? "DELETE" : "DRY-DELETE"} ${tag}`);
        if (live) {
          await db.recursiveDelete(d.ref);
          if (c.companyCode) await db.collection("companyCodes").doc(c.companyCode).delete().catch(() => {});
          await auth.deleteUser(d.id).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error("cleanup-unpaid failed", e);
    return new Response("error: " + e.message, { status: 500 });
  }
  console.log(`[cleanup-unpaid] live=${live}\n` + (log.join("\n") || "nothing to do"));
  return new Response("ok");
};

export const config = { schedule: "0 0 * * *" }; // 00:00 UTC = 09:00 KST

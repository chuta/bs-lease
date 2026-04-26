import type { EoiPdfData, EoiPdfSelectedLineItem, EoiPdfTotals } from "../pdf/EoiSubmissionPdf";
import type { EoiSubmissionDetail } from "./submissionsApi";

export function parseSelectedLineItemsForPdf(raw: unknown): EoiPdfSelectedLineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: EoiPdfSelectedLineItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = String(o.id ?? "");
    if (!id) continue;
    out.push({
      id,
      label: String(o.label ?? ""),
      price_kobo: Number(o.price_kobo ?? 0),
    });
  }
  return out;
}

function boolToYesNo(v: unknown): string {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "—";
}

function formatDateForPdf(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

export function submissionDetailToPdfData(detail: EoiSubmissionDetail): EoiPdfData {
  return {
    fullName: detail.full_name,
    dateOfBirth: formatDateForPdf(detail.date_of_birth),
    gender: detail.gender,
    religion: detail.religion,
    stateOfOrigin: detail.state_of_origin,
    currentAddress: detail.current_address,
    phoneNumber: detail.phone_number,
    whatsappNumber: (detail.whatsapp_number ?? "").trim(),
    email: detail.email,
    occupation: detail.occupation,
    industry: detail.industry,
    facebookHandle: detail.facebook_handle,
    xHandle: detail.x_handle,
    instagramHandle: detail.instagram_handle,
    linkedinHandle: detail.linkedin_handle,
    nin: detail.nin,
    preferredUnit: detail.preferred_unit,
    moveInDate: formatDateForPdf(detail.move_in_date),
    leaseDurationMonths: String(detail.lease_duration_months),
    convictedCrime: boolToYesNo(detail.convicted_crime),
    ongoingCourtCase: boolToYesNo(detail.ongoing_court_case),
    stayingAlone: boolToYesNo(detail.staying_alone),
    married: boolToYesNo(detail.married),
    numberOfChildren: String(detail.number_of_children),
    drugAddiction: boolToYesNo(detail.drug_addiction),
    estateAgent: detail.estate_agent,
  };
}

export function submissionDetailToPdfTotals(detail: EoiSubmissionDetail): EoiPdfTotals {
  return {
    currency: detail.currency || "NGN",
    base_rent_kobo: Number(detail.base_rent_kobo ?? 0),
    options_kobo: Number(detail.options_kobo ?? 0),
    total_kobo: Number(detail.total_kobo ?? 0),
  };
}

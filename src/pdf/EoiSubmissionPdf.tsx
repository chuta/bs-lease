import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export type EoiPdfSelectedLineItem = { id: string; label: string; price_kobo: number };

export type EoiPdfTotals = {
  currency: string;
  base_rent_kobo: number;
  options_kobo: number;
  total_kobo: number;
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: "Helvetica", color: "#0f172a" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 6 },
  subtitle: { fontSize: 11, color: "#475569", marginBottom: 12 },
  badge: {
    fontSize: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: "#0f172a",
    color: "white",
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  section: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  h: { fontSize: 12, fontWeight: 700, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 3 },
  label: { color: "#475569" },
  value: { color: "#0f172a", maxWidth: "70%" },
  small: { fontSize: 9, color: "#64748b", marginTop: 12 },
});

/** Form field map (submit flow) or DB-backed map (admin); keys must match EoiSubmissionPdf rows. */
export type EoiPdfData = Record<string, string>;

export function EoiSubmissionPdf({
  referenceId,
  submittedAt,
  data,
  selectedLineItems,
  totals,
}: {
  referenceId: string;
  submittedAt: string;
  data: EoiPdfData;
  selectedLineItems: EoiPdfSelectedLineItem[];
  totals: EoiPdfTotals;
}) {
  const fmt = (kobo: number) => {
    const naira = kobo / 100;
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: totals.currency,
      maximumFractionDigits: 2,
    }).format(naira);
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.badge}>BlockSpace Technologies Ltd Leasing</Text>
        <Text style={styles.title}>Lease Agreement – Expression of Interest (Non-binding)</Text>
        <Text style={styles.subtitle}>
          Reference: {referenceId} • Submitted: {submittedAt}
        </Text>

        <View style={styles.section}>
          <Text style={styles.h}>Applicant Information</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Full name</Text>
            <Text style={styles.value}>{data.fullName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Date of Birth</Text>
            <Text style={styles.value}>{data.dateOfBirth}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Gender</Text>
            <Text style={styles.value}>{data.gender}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Religion</Text>
            <Text style={styles.value}>{data.religion}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>State of origin</Text>
            <Text style={styles.value}>{data.stateOfOrigin}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Phone</Text>
            <Text style={styles.value}>{data.phoneNumber}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>WhatsApp</Text>
            <Text style={styles.value}>{data.whatsappNumber || "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{data.email}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Current address</Text>
            <Text style={styles.value}>{data.currentAddress}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Occupation</Text>
            <Text style={styles.value}>{data.occupation}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Industry</Text>
            <Text style={styles.value}>{data.industry}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Facebook</Text>
            <Text style={styles.value}>{data.facebookHandle}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Twitter/X</Text>
            <Text style={styles.value}>{data.xHandle}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Instagram</Text>
            <Text style={styles.value}>{data.instagramHandle}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>LinkedIn</Text>
            <Text style={styles.value}>{data.linkedinHandle}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>NIN</Text>
            <Text style={styles.value}>{data.nin}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.h}>Apartment Preference</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Preferred unit</Text>
            <Text style={styles.value}>
              {data.preferredUnit === "any" ? "Any available" : `Unit ${data.preferredUnit}`}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Move-in date</Text>
            <Text style={styles.value}>{data.moveInDate || "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Lease duration</Text>
            <Text style={styles.value}>{data.leaseDurationMonths} months</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.h}>Screening Declarations</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Convicted of crime</Text>
            <Text style={styles.value}>{data.convictedCrime}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Ongoing court case</Text>
            <Text style={styles.value}>{data.ongoingCourtCase}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Staying alone</Text>
            <Text style={styles.value}>{data.stayingAlone}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Married</Text>
            <Text style={styles.value}>{data.married}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Number of children</Text>
            <Text style={styles.value}>{data.numberOfChildren}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Drug-related addiction</Text>
            <Text style={styles.value}>{data.drugAddiction}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.h}>Selected Items & Options</Text>
          {selectedLineItems.length ? (
            selectedLineItems.map((li) => (
              <View key={li.id} style={styles.row}>
                <Text style={styles.label}>•</Text>
                <Text style={styles.value}>
                  {li.label} ({fmt(li.price_kobo)})
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.value}>None selected</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.h}>Totals</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Base rent</Text>
            <Text style={styles.value}>{fmt(totals.base_rent_kobo)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Selected options</Text>
            <Text style={styles.value}>{fmt(totals.options_kobo)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Total</Text>
            <Text style={styles.value}>{fmt(totals.total_kobo)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.h}>Estate Agent</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Selected</Text>
            <Text style={styles.value}>{data.estateAgent}</Text>
          </View>
        </View>

        <Text style={styles.small}>
          IMPORTANT: This document is an Expression of Interest only. It is not a final tenancy
          agreement and does not create a binding landlord-tenant relationship. Final terms (rent,
          deposits, fees, and verification outcomes) are subject to review and a separate signed
          agreement.
        </Text>
      </Page>
    </Document>
  );
}

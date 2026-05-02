import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { estateAgents } from "../data/agents";
import { formatMoney, type LineItem, type Money } from "../data/lineItems";
import { fetchPricingConfig } from "../lib/pricingConfig";
import { ListingImageCarousel } from "../components/ListingImageCarousel";
import {
  listLeaseDurationTiers,
  scaleKoboAmountFrom12MonthPrice,
  type LeaseDurationTier,
} from "../lib/leaseDurationApi";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
const ACCEPTED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

function validateUpload(file: File | undefined): true | string {
  if (!file) return "This upload is required.";
  if (file.size > MAX_UPLOAD_BYTES) return "File is too large (max 8MB).";
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type as (typeof ACCEPTED_UPLOAD_TYPES)[number])) {
    return "Invalid file type. Use PDF, JPG, or PNG.";
  }
  return true;
}

const FormSchema = z
  .object({
    fullName: z.string().min(2, "Full name is required."),
    dateOfBirth: z.string().min(1, "Date of Birth is required."),
    gender: z.enum(["male", "female", "other"], { required_error: "Gender is required." }),
    religion: z.string().min(2, "Religion is required."),
    stateOfOrigin: z.string().min(2, "State of origin is required."),
    currentAddress: z.string().min(5, "Current address is required."),
    phoneNumber: z.string().min(7, "Phone number is required."),
    whatsappNumber: z.string().optional(),
    email: z.string().email("Enter a valid email."),
    occupation: z.string().min(2, "Current occupation is required."),
    industry: z.string().min(2, "Industry/sector is required."),
    facebookHandle: z.string().optional(),
    xHandle: z.string().optional(),
    instagramHandle: z.string().optional(),
    linkedinHandle: z.string().optional(),
    nin: z.string().min(5, "NIN is required."),
    passportUpload: z
      .any()
      .refine((v) => v instanceof File, "Passport upload is required.")
      .refine((v) => validateUpload(v as File) === true, (v) => ({
        message: validateUpload(v as File) as string,
      })),
    ninUpload: z
      .any()
      .refine((v) => v instanceof File, "NIN upload is required.")
      .refine((v) => validateUpload(v as File) === true, (v) => ({
        message: validateUpload(v as File) as string,
      })),
    preferredUnit: z.string().min(1, "Select a preferred unit option."),
    moveInDate: z.string().optional(),
    leaseDurationMonths: z.string().min(1, "Select a lease duration."),
    convictedCrime: z.enum(["yes", "no"]),
    ongoingCourtCase: z.enum(["yes", "no"]),
    stayingAlone: z.enum(["yes", "no"]),
    married: z.enum(["yes", "no"]),
    numberOfChildren: z.coerce.number().int().min(0),
    drugAddiction: z.enum(["yes", "no"]),
    selectedLineItemIds: z.array(z.string()).default([]),
    estateAgentId: z.string().min(1, "Select the estate agent."),
    otherAgentName: z.string().optional(),
    otherAgentPhone: z.string().optional(),
    consentAccuracy: z.literal(true, { message: "Consent is required." }),
    consentVerification: z.literal(true, { message: "Consent is required." }),
  })
  .superRefine((data, ctx) => {
    const social = [
      (data.facebookHandle ?? "").trim(),
      (data.xHandle ?? "").trim(),
      (data.instagramHandle ?? "").trim(),
      (data.linkedinHandle ?? "").trim(),
    ];
    const hasOne = social.some((s) => s.length >= 2);
    if (!hasOne) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["facebookHandle"],
        message: "Provide at least one social media profile (any of Facebook, X, Instagram, LinkedIn).",
      });
    }
    if (data.estateAgentId === "other") {
      if (!data.otherAgentName || data.otherAgentName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["otherAgentName"],
          message: "Enter the agent name.",
        });
      }
      if (!data.otherAgentPhone || data.otherAgentPhone.trim().length < 7) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["otherAgentPhone"],
          message: "Enter the agent phone number.",
        });
      }
    }
  });

type FormValues = z.infer<typeof FormSchema>;

function fieldError(message?: string) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-red-600">{message}</p>;
}

function YesNoRow({
  label,
  name,
  register,
  error,
}: {
  label: string;
  name:
    | "convictedCrime"
    | "ongoingCourtCase"
    | "stayingAlone"
    | "married"
    | "drugAddiction";
  register: ReturnType<typeof useForm<FormValues>>["register"];
  error?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="font-medium text-slate-900">{label}</div>
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              value="no"
              className="h-4 w-4 accent-slate-900"
              {...register(name)}
            />
            <span>No</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              value="yes"
              className="h-4 w-4 accent-slate-900"
              {...register(name)}
            />
            <span>Yes</span>
          </label>
        </div>
      </div>
      {fieldError(error)}
    </div>
  );
}

export default function PublicEoi() {
  const [config, setConfig] = useState<{ baseRent: Money; lineItems: LineItem[] } | null>(null);
  const [durationTiers, setDurationTiers] = useState<LeaseDurationTier[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPricingConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        // fetchPricingConfig already falls back; keep null until resolved.
      });
    listLeaseDurationTiers()
      .then((tiers) => {
        if (!cancelled) setDurationTiers(tiers);
      })
      .catch(() => {
        if (!cancelled) setDurationTiers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const baseRent = config?.baseRent;
  const lineItems = useMemo(() => config?.lineItems ?? [], [config]);

  const defaultSelected = useMemo(() => {
    return lineItems.filter((i) => i.defaultChecked).map((i) => i.id);
  }, [lineItems]);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    control,
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema) as unknown as never,
    defaultValues: {
      fullName: "",
      dateOfBirth: "",
      gender: "male",
      religion: "",
      stateOfOrigin: "",
      currentAddress: "",
      phoneNumber: "",
      whatsappNumber: "",
      email: "",
      occupation: "",
      industry: "",
      facebookHandle: "",
      xHandle: "",
      instagramHandle: "",
      linkedinHandle: "",
      nin: "",
      passportUpload: undefined as unknown as File,
      ninUpload: undefined as unknown as File,
      preferredUnit: "any",
      moveInDate: "",
      leaseDurationMonths: "12",
      convictedCrime: "no",
      ongoingCourtCase: "no",
      stayingAlone: "yes",
      married: "no",
      numberOfChildren: 0,
      drugAddiction: "no",
      selectedLineItemIds: [],
      estateAgentId: "",
      otherAgentName: "",
      otherAgentPhone: "",
      consentAccuracy: false as unknown as true,
      consentVerification: false as unknown as true,
    },
  });

  useEffect(() => {
    if (!config) return;
    setValue("selectedLineItemIds", defaultSelected, { shouldDirty: false });
  }, [config, defaultSelected, setValue]);

  const [submitResult, setSubmitResult] = useState<
    { ok: true; referenceId: string } | { ok: false; message: string } | null
  >(null);

  const watchedSelectedLineItemIds = useWatch({ control, name: "selectedLineItemIds" });
  const selectedLineItemIds = useMemo(
    () => watchedSelectedLineItemIds ?? [],
    [watchedSelectedLineItemIds],
  );
  const leaseDurationMonthsRaw = useWatch({ control, name: "leaseDurationMonths" });
  const estateAgentId = useWatch({ control, name: "estateAgentId" });

  const leaseDurationMonths = useMemo(() => {
    const n = Number(leaseDurationMonthsRaw ?? "12");
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 12;
  }, [leaseDurationMonthsRaw]);

  const selectedTier = useMemo(() => {
    const tiers = durationTiers ?? [];
    return tiers.find((t) => Number(t.months) === leaseDurationMonths) ?? null;
  }, [durationTiers, leaseDurationMonths]);

  const durationMultiplierBps = selectedTier?.multiplier_bps ?? 10000;

  const scaledBaseRentKobo = useMemo(() => {
    return scaleKoboAmountFrom12MonthPrice({
      amount12_kobo: Number(baseRent?.amountKobo ?? 0),
      months: leaseDurationMonths,
      multiplier_bps: durationMultiplierBps,
    });
  }, [baseRent?.amountKobo, leaseDurationMonths, durationMultiplierBps]);

  const selectedLineItems = useMemo(() => {
    const set = new Set(selectedLineItemIds);
    return lineItems.filter((i) => set.has(i.id));
  }, [selectedLineItemIds, lineItems]);

  const scaledSelectedLineItems = useMemo(() => {
    return selectedLineItems.map((i) => ({
      ...i,
      price: {
        ...i.price,
        amountKobo: scaleKoboAmountFrom12MonthPrice({
          amount12_kobo: Number(i.price.amountKobo ?? 0),
          months: leaseDurationMonths,
          multiplier_bps: durationMultiplierBps,
        }),
      },
    }));
  }, [selectedLineItems, leaseDurationMonths, durationMultiplierBps]);

  const optionsSubtotal = useMemo(() => {
    return scaledSelectedLineItems.reduce((acc, i) => acc + i.price.amountKobo, 0);
  }, [scaledSelectedLineItems]);

  const total = useMemo(() => {
    return scaledBaseRentKobo + optionsSubtotal;
  }, [scaledBaseRentKobo, optionsSubtotal]);

  async function onSubmit(values: FormValues) {
    setSubmitResult(null);
    const formData = new FormData();

    (Object.entries(values) as Array<[keyof FormValues, FormValues[keyof FormValues]]>).forEach(
      ([k, v]) => {
        if (k === "passportUpload" || k === "ninUpload") return;
        if (k === "selectedLineItemIds") {
          for (const id of values.selectedLineItemIds) formData.append("selectedLineItemIds", id);
          return;
        }
        formData.append(String(k), String(v ?? ""));
      },
    );

    formData.set("passportUpload", values.passportUpload as unknown as File);
    formData.set("ninUpload", values.ninUpload as unknown as File);

    const res = await fetch("/api/submit-eoi", {
      method: "POST",
      body: formData,
    });

    const json = (await res.json().catch(() => null)) as null | {
      ok?: boolean;
      referenceId?: string;
      message?: string;
    };

    if (!res.ok || !json?.ok || !json.referenceId) {
      setSubmitResult({ ok: false, message: json?.message ?? "Submission failed. Try again." });
      return;
    }

    setSubmitResult({ ok: true, referenceId: json.referenceId });
  }

  const pageMoney = {
    currency: baseRent?.currency ?? "NGN",
    amountKobo: 0,
  } as Money;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-800">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            BlockSpace Technologies Ltd Leasing
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
            Lease Agreement – Expression of Interest
          </h1>
          <div className="mt-4">
            <ListingImageCarousel />
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 md:text-base">
            This is an <span className="font-semibold">interest-only</span> form and{" "}
            <span className="font-semibold">not a final agreement</span>. Your submission will
            generate a non-binding PDF copy for you and the property admin. Property Location: 2 Oladele Makunjuola Obalodu Stret, Alagemo Yahweh, Igbe Lara Ikorodu, Lagos.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <form
            className="space-y-8"
            onSubmit={handleSubmit(onSubmit)}
            encType="multipart/form-data"
          >
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-950">Applicant Information</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-slate-700">Full name *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("fullName")}
                    placeholder="e.g., John Okafor"
                  />
                  {fieldError(errors.fullName?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Date of Birth *</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("dateOfBirth")}
                  />
                  {fieldError(errors.dateOfBirth?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Gender *</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("gender")}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                  {fieldError(errors.gender?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Religion *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("religion")}
                    placeholder="e.g., Christianity, Islam, Traditional, Other"
                  />
                  {fieldError(errors.religion?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">State of origin *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("stateOfOrigin")}
                    placeholder="e.g., Enugu"
                  />
                  {fieldError(errors.stateOfOrigin?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Phone number *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("phoneNumber")}
                    placeholder="e.g., +234..."
                  />
                  {fieldError(errors.phoneNumber?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">
                    WhatsApp number (if different)
                  </label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("whatsappNumber")}
                    placeholder="e.g., +234..."
                  />
                  {fieldError(errors.whatsappNumber?.message)}
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-slate-700">Current address *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("currentAddress")}
                    placeholder="Street, City, State"
                  />
                  {fieldError(errors.currentAddress?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Email address *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("email")}
                    placeholder="name@example.com"
                  />
                  {fieldError(errors.email?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Current occupation *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("occupation")}
                    placeholder="e.g., Software Engineer"
                  />
                  {fieldError(errors.occupation?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Industry/sector *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("industry")}
                    placeholder="e.g., Technology"
                  />
                  {fieldError(errors.industry?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Facebook</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("facebookHandle")}
                    placeholder="e.g., facebook.com/yourprofile or @username"
                  />
                  {fieldError(errors.facebookHandle?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Twitter/X</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("xHandle")}
                    placeholder="e.g., x.com/yourhandle or @yourhandle"
                  />
                  {fieldError(errors.xHandle?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Instagram</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("instagramHandle")}
                    placeholder="e.g., instagram.com/yourhandle or @yourhandle"
                  />
                  {fieldError(errors.instagramHandle?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">LinkedIn</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("linkedinHandle")}
                    placeholder="e.g., linkedin.com/in/yourname"
                  />
                  {fieldError(errors.linkedinHandle?.message)}
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-slate-700">NIN *</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("nin")}
                    placeholder="National Identification Number"
                  />
                  {fieldError(errors.nin?.message)}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-950">Uploads (Required)</h2>
              <p className="mt-1 text-sm text-slate-600">
                Accepted: PDF/JPG/PNG. Max size: 8MB each. Uploads are submitted for verification
                and emailed to the property admin.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-slate-700">Passport (Head shot) upload *</label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
                    onChange={(e) => setValue("passportUpload", e.target.files?.[0] as File)}
                  />
                  {fieldError(errors.passportUpload?.message as string | undefined)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">NIN upload *</label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
                    onChange={(e) => setValue("ninUpload", e.target.files?.[0] as File)}
                  />
                  {fieldError(errors.ninUpload?.message as string | undefined)}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-950">Apartment Preference</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-medium text-slate-700">Preferred unit *</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("preferredUnit")}
                  >
                    <option value="any">Any available</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={String(i + 1)}>
                        Unit {i + 1}
                      </option>
                    ))}
                  </select>
                  {fieldError(errors.preferredUnit?.message)}
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Move-in date</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("moveInDate")}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Lease duration *</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("leaseDurationMonths")}
                  >
                    {(durationTiers ?? []).map((t) => (
                      <option key={t.months} value={String(t.months)}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {fieldError(errors.leaseDurationMonths?.message)}
                  {selectedTier ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Pricing factor:{" "}
                      <span className="font-semibold text-slate-700">
                        {(selectedTier.multiplier_bps / 10000).toFixed(2)}x
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-950">Screening Declarations</h2>
              <div className="mt-4 grid gap-4">
                <YesNoRow
                  label="Have you been convicted of any crime before now?"
                  name="convictedCrime"
                  register={register}
                  error={errors.convictedCrime?.message}
                />
                <YesNoRow
                  label="Do you have any ongoing court case?"
                  name="ongoingCourtCase"
                  register={register}
                  error={errors.ongoingCourtCase?.message}
                />
                <YesNoRow
                  label="Would you be staying alone?"
                  name="stayingAlone"
                  register={register}
                  error={errors.stayingAlone?.message}
                />
                <YesNoRow
                  label="Are you married?"
                  name="married"
                  register={register}
                  error={errors.married?.message}
                />
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="font-medium text-slate-900">Number of children</div>
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2 md:w-40"
                      {...register("numberOfChildren", { valueAsNumber: true })}
                    />
                  </div>
                  {fieldError(errors.numberOfChildren?.message)}
                </div>
                <YesNoRow
                  label="Do you have any drug related addiction?"
                  name="drugAddiction"
                  register={register}
                  error={errors.drugAddiction?.message}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-950">Included Items & Options</h2>
              <p className="mt-1 text-sm text-slate-600">
                Use the checkboxes to select what you want included in your interest document.
                Totals update instantly.
              </p>
              {!config ? (
                <p className="mt-4 text-sm text-slate-600">Loading pricing…</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {lineItems.map((item) => {
                    const checked = selectedLineItemIds.includes(item.id);
                    const scaledKobo = scaleKoboAmountFrom12MonthPrice({
                      amount12_kobo: Number(item.price.amountKobo ?? 0),
                      months: leaseDurationMonths,
                      multiplier_bps: durationMultiplierBps,
                    });
                    return (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-slate-900"
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(selectedLineItemIds);
                              if (e.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              setValue("selectedLineItemIds", Array.from(next));
                            }}
                          />
                          <div>
                            <div className="font-medium text-slate-900">{item.label}</div>
                            {item.description ? (
                              <div className="mt-1 text-sm text-slate-600">{item.description}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-sm font-semibold text-slate-900">
                          {formatMoney({ ...item.price, amountKobo: scaledKobo })}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-950">Estate Agent</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-slate-700">Agent *</label>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                    {...register("estateAgentId")}
                  >
                    <option value="">Select…</option>
                    {estateAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.phone})
                      </option>
                    ))}
                    <option value="other">Other</option>
                  </select>
                  {fieldError(errors.estateAgentId?.message)}
                </div>
                {estateAgentId === "other" ? (
                  <>
                    <div>
                      <label className="text-sm font-medium text-slate-700">Other agent name *</label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                        {...register("otherAgentName")}
                        placeholder="Agent name"
                      />
                      {fieldError(errors.otherAgentName?.message)}
                    </div>
                    <div>
                      <label className="text-sm font-medium text-slate-700">
                        Other agent phone *
                      </label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-slate-300 focus:ring-2"
                        {...register("otherAgentPhone")}
                        placeholder="+234..."
                      />
                      {fieldError(errors.otherAgentPhone?.message)}
                    </div>
                  </>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-950">Consent & Submit</h2>
              <div className="mt-4 space-y-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-slate-900"
                    {...register("consentAccuracy")}
                  />
                  <span className="text-sm text-slate-700">
                    I confirm that the information provided is accurate and complete.
                  </span>
                </label>
                {fieldError(errors.consentAccuracy?.message)}
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-slate-900"
                    {...register("consentVerification")}
                  />
                  <span className="text-sm text-slate-700">
                    I consent to identity/background verification related to this Expression of
                    Interest.
                  </span>
                </label>
                {fieldError(errors.consentVerification?.message)}

                <button
                  type="submit"
                  disabled={isSubmitting || !config}
                  className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Submitting…" : "Submit Expression of Interest"}
                </button>

                {submitResult?.ok ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    Submitted successfully. Reference ID:{" "}
                    <span className="font-semibold">{submitResult.referenceId}</span>. Please check
                    your email.
                  </div>
                ) : null}
                {submitResult?.ok === false ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                    {submitResult.message}
                  </div>
                ) : null}
              </div>
            </section>
          </form>

          <aside className="lg:sticky lg:top-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-950">Totals</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Base rent</span>
                  <span className="font-semibold text-slate-900">
                    {baseRent ? formatMoney({ ...baseRent, amountKobo: scaledBaseRentKobo }) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Selected options</span>
                  <span className="font-semibold text-slate-900">
                    {formatMoney({ ...pageMoney, amountKobo: optionsSubtotal })}
                  </span>
                </div>
                <div className="h-px bg-slate-200" />
                <div className="flex items-center justify-between text-base">
                  <span className="font-semibold text-slate-900">Total</span>
                  <span className="font-bold text-slate-950">
                    {formatMoney({ ...pageMoney, amountKobo: total })}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-950">Privacy note</h2>
              <p className="mt-2 text-xs text-slate-600">
                Sensitive uploads (passport and NIN) are used only for verification related to this
                Expression of Interest and are delivered via email to the property admin.
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-950">Payment information</h2>
              <p className="mt-2 text-xs font-medium text-slate-900">
                All payments must be made only to the company account below. Do not send funds to
                any other account or name.
              </p>
              <dl className="mt-3 space-y-2 text-xs text-slate-700">
                <div>
                  <dt className="text-slate-500">Account name</dt>
                  <dd className="font-medium text-slate-950">BLOCKSPACE TECH. NIGERIA LTD</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Account number</dt>
                  <dd className="font-mono font-medium text-slate-950">1307580457</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Bank name</dt>
                  <dd className="font-medium text-slate-950">Providus Bank</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}


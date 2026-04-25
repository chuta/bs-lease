export type Money = {
  currency: "NGN";
  amountKobo: number;
};

export type LineItem = {
  id: string;
  label: string;
  description?: string;
  price: Money;
  defaultChecked?: boolean;
};

export const currency = "NGN" as const;

export const baseRent: Money = {
  currency,
  amountKobo: 0,
};

export const lineItems: LineItem[] = [
  {
    id: "furnish_bed_mattress",
    label: '6x4 bed & mattress (pre-furnished)',
    description: "Included in the apartment furnishings.",
    price: { currency, amountKobo: 0 },
    defaultChecked: true,
  },
  {
    id: "furnish_reading_table_chair",
    label: "Reading table & chair (pre-furnished)",
    description: "Included in the apartment furnishings.",
    price: { currency, amountKobo: 0 },
    defaultChecked: true,
  },
  {
    id: "furnish_sofas",
    label: "2 seating room sofas (pre-furnished)",
    description: "Included in the apartment furnishings.",
    price: { currency, amountKobo: 0 },
    defaultChecked: true,
  },
  {
    id: "furnish_center_rug",
    label: "Center rug (pre-furnished)",
    description: "Included in the apartment furnishings.",
    price: { currency, amountKobo: 0 },
    defaultChecked: true,
  },
  {
    id: "facility_solar_power",
    label: "Solar power (stable electricity)",
    price: { currency, amountKobo: 0 },
    defaultChecked: true,
  },
  {
    id: "facility_starlink_internet",
    label: "High-speed Starlink Internet",
    price: { currency, amountKobo: 0 },
    defaultChecked: true,
  },
  {
    id: "facility_security",
    label: "Security",
    price: { currency, amountKobo: 0 },
    defaultChecked: true,
  },
];

export function formatMoney(m: Money): string {
  const naira = m.amountKobo / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: m.currency,
    maximumFractionDigits: 2,
  }).format(naira);
}


// Common ISO 4217 currency codes surfaced in the base-currency picker.
// Not exhaustive — user can type any 3-letter ISO 4217 code (validated server-side).

export const COMMON_CURRENCIES: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "JPY", label: "JPY — Japanese Yen" },
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "NZD", label: "NZD — New Zealand Dollar" },
  { code: "SEK", label: "SEK — Swedish Krona" },
  { code: "NOK", label: "NOK — Norwegian Krone" },
  { code: "DKK", label: "DKK — Danish Krone" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
  { code: "HKD", label: "HKD — Hong Kong Dollar" },
  { code: "THB", label: "THB — Thai Baht" },
  { code: "CNY", label: "CNY — Chinese Yuan" },
];

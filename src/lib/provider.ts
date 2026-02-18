export const supportedProviders = ["garmin", "fitbit"] as const;

export type SupportedProvider = (typeof supportedProviders)[number];

export function parseProvider(value: string): SupportedProvider | null {
  if ((supportedProviders as readonly string[]).includes(value)) {
    return value as SupportedProvider;
  }

  return null;
}

import type { Source } from "@repo/domain"

// The hosts each adapter asks, so one HttpClient paces them all.
export const hosts = new Map<string, Source>([
  ["xmart-api-public.who.int", "WHO"],
  ["bulks-faostat.fao.org", "FAOSTAT"],
  ["api.insee.fr", "INSEE"],
  ["rplumber.ilo.org", "ILOSTAT"],
  ["api.worldbank.org", "World Bank"],
  ["ec.europa.eu", "Eurostat"],
  ["sdmx.oecd.org", "OECD"],
])

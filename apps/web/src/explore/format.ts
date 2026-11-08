import { type Country, countries } from "@civicdata/domain"

const names = new Map(countries.map((country) => [country.code, country.name]))

export const countryName = (country: Country) => names.get(country) ?? country

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const full = new Intl.NumberFormat("en", { maximumFractionDigits: 2 })

export const formatCompact = (value: number) => compact.format(value)

export const formatValue = (value: number) => full.format(value)

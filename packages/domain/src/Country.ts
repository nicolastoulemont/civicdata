import { Option, Schema, SchemaGetter } from "effect"

// Generated on 2026-11-08 from https://api.worldbank.org/v2/country?format=json&per_page=400,
// keeping the 217 entries whose region is not "Aggregates" (regions, income groups).
// `alpha2` is the entry's iso2Code: ISO 3166-1 alpha-2, except JG for the
// Channel Islands, which have none. Regenerate when the World Bank adds or
// renames an economy.
export const countries = [
  { code: "ABW", alpha2: "AW", name: "Aruba" },
  { code: "AFG", alpha2: "AF", name: "Afghanistan" },
  { code: "AGO", alpha2: "AO", name: "Angola" },
  { code: "ALB", alpha2: "AL", name: "Albania" },
  { code: "AND", alpha2: "AD", name: "Andorra" },
  { code: "ARE", alpha2: "AE", name: "United Arab Emirates" },
  { code: "ARG", alpha2: "AR", name: "Argentina" },
  { code: "ARM", alpha2: "AM", name: "Armenia" },
  { code: "ASM", alpha2: "AS", name: "American Samoa" },
  { code: "ATG", alpha2: "AG", name: "Antigua and Barbuda" },
  { code: "AUS", alpha2: "AU", name: "Australia" },
  { code: "AUT", alpha2: "AT", name: "Austria" },
  { code: "AZE", alpha2: "AZ", name: "Azerbaijan" },
  { code: "BDI", alpha2: "BI", name: "Burundi" },
  { code: "BEL", alpha2: "BE", name: "Belgium" },
  { code: "BEN", alpha2: "BJ", name: "Benin" },
  { code: "BFA", alpha2: "BF", name: "Burkina Faso" },
  { code: "BGD", alpha2: "BD", name: "Bangladesh" },
  { code: "BGR", alpha2: "BG", name: "Bulgaria" },
  { code: "BHR", alpha2: "BH", name: "Bahrain" },
  { code: "BHS", alpha2: "BS", name: "Bahamas, The" },
  { code: "BIH", alpha2: "BA", name: "Bosnia and Herzegovina" },
  { code: "BLR", alpha2: "BY", name: "Belarus" },
  { code: "BLZ", alpha2: "BZ", name: "Belize" },
  { code: "BMU", alpha2: "BM", name: "Bermuda" },
  { code: "BOL", alpha2: "BO", name: "Bolivia" },
  { code: "BRA", alpha2: "BR", name: "Brazil" },
  { code: "BRB", alpha2: "BB", name: "Barbados" },
  { code: "BRN", alpha2: "BN", name: "Brunei Darussalam" },
  { code: "BTN", alpha2: "BT", name: "Bhutan" },
  { code: "BWA", alpha2: "BW", name: "Botswana" },
  { code: "CAF", alpha2: "CF", name: "Central African Republic" },
  { code: "CAN", alpha2: "CA", name: "Canada" },
  { code: "CHE", alpha2: "CH", name: "Switzerland" },
  { code: "CHI", alpha2: "JG", name: "Channel Islands" },
  { code: "CHL", alpha2: "CL", name: "Chile" },
  { code: "CHN", alpha2: "CN", name: "China" },
  { code: "CIV", alpha2: "CI", name: "Cote d'Ivoire" },
  { code: "CMR", alpha2: "CM", name: "Cameroon" },
  { code: "COD", alpha2: "CD", name: "Congo, Dem. Rep." },
  { code: "COG", alpha2: "CG", name: "Congo, Rep." },
  { code: "COL", alpha2: "CO", name: "Colombia" },
  { code: "COM", alpha2: "KM", name: "Comoros" },
  { code: "CPV", alpha2: "CV", name: "Cabo Verde" },
  { code: "CRI", alpha2: "CR", name: "Costa Rica" },
  { code: "CUB", alpha2: "CU", name: "Cuba" },
  { code: "CUW", alpha2: "CW", name: "Curacao" },
  { code: "CYM", alpha2: "KY", name: "Cayman Islands" },
  { code: "CYP", alpha2: "CY", name: "Cyprus" },
  { code: "CZE", alpha2: "CZ", name: "Czechia" },
  { code: "DEU", alpha2: "DE", name: "Germany" },
  { code: "DJI", alpha2: "DJ", name: "Djibouti" },
  { code: "DMA", alpha2: "DM", name: "Dominica" },
  { code: "DNK", alpha2: "DK", name: "Denmark" },
  { code: "DOM", alpha2: "DO", name: "Dominican Republic" },
  { code: "DZA", alpha2: "DZ", name: "Algeria" },
  { code: "ECU", alpha2: "EC", name: "Ecuador" },
  { code: "EGY", alpha2: "EG", name: "Egypt, Arab Rep." },
  { code: "ERI", alpha2: "ER", name: "Eritrea" },
  { code: "ESP", alpha2: "ES", name: "Spain" },
  { code: "EST", alpha2: "EE", name: "Estonia" },
  { code: "ETH", alpha2: "ET", name: "Ethiopia" },
  { code: "FIN", alpha2: "FI", name: "Finland" },
  { code: "FJI", alpha2: "FJ", name: "Fiji" },
  { code: "FRA", alpha2: "FR", name: "France" },
  { code: "FRO", alpha2: "FO", name: "Faroe Islands" },
  { code: "FSM", alpha2: "FM", name: "Micronesia, Fed. Sts." },
  { code: "GAB", alpha2: "GA", name: "Gabon" },
  { code: "GBR", alpha2: "GB", name: "United Kingdom" },
  { code: "GEO", alpha2: "GE", name: "Georgia" },
  { code: "GHA", alpha2: "GH", name: "Ghana" },
  { code: "GIB", alpha2: "GI", name: "Gibraltar" },
  { code: "GIN", alpha2: "GN", name: "Guinea" },
  { code: "GMB", alpha2: "GM", name: "Gambia, The" },
  { code: "GNB", alpha2: "GW", name: "Guinea-Bissau" },
  { code: "GNQ", alpha2: "GQ", name: "Equatorial Guinea" },
  { code: "GRC", alpha2: "GR", name: "Greece" },
  { code: "GRD", alpha2: "GD", name: "Grenada" },
  { code: "GRL", alpha2: "GL", name: "Greenland" },
  { code: "GTM", alpha2: "GT", name: "Guatemala" },
  { code: "GUM", alpha2: "GU", name: "Guam" },
  { code: "GUY", alpha2: "GY", name: "Guyana" },
  { code: "HKG", alpha2: "HK", name: "Hong Kong SAR, China" },
  { code: "HND", alpha2: "HN", name: "Honduras" },
  { code: "HRV", alpha2: "HR", name: "Croatia" },
  { code: "HTI", alpha2: "HT", name: "Haiti" },
  { code: "HUN", alpha2: "HU", name: "Hungary" },
  { code: "IDN", alpha2: "ID", name: "Indonesia" },
  { code: "IMN", alpha2: "IM", name: "Isle of Man" },
  { code: "IND", alpha2: "IN", name: "India" },
  { code: "IRL", alpha2: "IE", name: "Ireland" },
  { code: "IRN", alpha2: "IR", name: "Iran, Islamic Rep." },
  { code: "IRQ", alpha2: "IQ", name: "Iraq" },
  { code: "ISL", alpha2: "IS", name: "Iceland" },
  { code: "ISR", alpha2: "IL", name: "Israel" },
  { code: "ITA", alpha2: "IT", name: "Italy" },
  { code: "JAM", alpha2: "JM", name: "Jamaica" },
  { code: "JOR", alpha2: "JO", name: "Jordan" },
  { code: "JPN", alpha2: "JP", name: "Japan" },
  { code: "KAZ", alpha2: "KZ", name: "Kazakhstan" },
  { code: "KEN", alpha2: "KE", name: "Kenya" },
  { code: "KGZ", alpha2: "KG", name: "Kyrgyz Republic" },
  { code: "KHM", alpha2: "KH", name: "Cambodia" },
  { code: "KIR", alpha2: "KI", name: "Kiribati" },
  { code: "KNA", alpha2: "KN", name: "St. Kitts and Nevis" },
  { code: "KOR", alpha2: "KR", name: "Korea, Rep." },
  { code: "KWT", alpha2: "KW", name: "Kuwait" },
  { code: "LAO", alpha2: "LA", name: "Lao PDR" },
  { code: "LBN", alpha2: "LB", name: "Lebanon" },
  { code: "LBR", alpha2: "LR", name: "Liberia" },
  { code: "LBY", alpha2: "LY", name: "Libya" },
  { code: "LCA", alpha2: "LC", name: "St. Lucia" },
  { code: "LIE", alpha2: "LI", name: "Liechtenstein" },
  { code: "LKA", alpha2: "LK", name: "Sri Lanka" },
  { code: "LSO", alpha2: "LS", name: "Lesotho" },
  { code: "LTU", alpha2: "LT", name: "Lithuania" },
  { code: "LUX", alpha2: "LU", name: "Luxembourg" },
  { code: "LVA", alpha2: "LV", name: "Latvia" },
  { code: "MAC", alpha2: "MO", name: "Macao SAR, China" },
  { code: "MAF", alpha2: "MF", name: "St. Martin (French part)" },
  { code: "MAR", alpha2: "MA", name: "Morocco" },
  { code: "MCO", alpha2: "MC", name: "Monaco" },
  { code: "MDA", alpha2: "MD", name: "Moldova" },
  { code: "MDG", alpha2: "MG", name: "Madagascar" },
  { code: "MDV", alpha2: "MV", name: "Maldives" },
  { code: "MEX", alpha2: "MX", name: "Mexico" },
  { code: "MHL", alpha2: "MH", name: "Marshall Islands" },
  { code: "MKD", alpha2: "MK", name: "North Macedonia" },
  { code: "MLI", alpha2: "ML", name: "Mali" },
  { code: "MLT", alpha2: "MT", name: "Malta" },
  { code: "MMR", alpha2: "MM", name: "Myanmar" },
  { code: "MNE", alpha2: "ME", name: "Montenegro" },
  { code: "MNG", alpha2: "MN", name: "Mongolia" },
  { code: "MNP", alpha2: "MP", name: "Northern Mariana Islands" },
  { code: "MOZ", alpha2: "MZ", name: "Mozambique" },
  { code: "MRT", alpha2: "MR", name: "Mauritania" },
  { code: "MUS", alpha2: "MU", name: "Mauritius" },
  { code: "MWI", alpha2: "MW", name: "Malawi" },
  { code: "MYS", alpha2: "MY", name: "Malaysia" },
  { code: "NAM", alpha2: "NA", name: "Namibia" },
  { code: "NCL", alpha2: "NC", name: "New Caledonia" },
  { code: "NER", alpha2: "NE", name: "Niger" },
  { code: "NGA", alpha2: "NG", name: "Nigeria" },
  { code: "NIC", alpha2: "NI", name: "Nicaragua" },
  { code: "NLD", alpha2: "NL", name: "Netherlands" },
  { code: "NOR", alpha2: "NO", name: "Norway" },
  { code: "NPL", alpha2: "NP", name: "Nepal" },
  { code: "NRU", alpha2: "NR", name: "Naoero" },
  { code: "NZL", alpha2: "NZ", name: "New Zealand" },
  { code: "OMN", alpha2: "OM", name: "Oman" },
  { code: "PAK", alpha2: "PK", name: "Pakistan" },
  { code: "PAN", alpha2: "PA", name: "Panama" },
  { code: "PER", alpha2: "PE", name: "Peru" },
  { code: "PHL", alpha2: "PH", name: "Philippines" },
  { code: "PLW", alpha2: "PW", name: "Palau" },
  { code: "PNG", alpha2: "PG", name: "Papua New Guinea" },
  { code: "POL", alpha2: "PL", name: "Poland" },
  { code: "PRI", alpha2: "PR", name: "Puerto Rico (US)" },
  { code: "PRK", alpha2: "KP", name: "Korea, Dem. People's Rep." },
  { code: "PRT", alpha2: "PT", name: "Portugal" },
  { code: "PRY", alpha2: "PY", name: "Paraguay" },
  { code: "PSE", alpha2: "PS", name: "West Bank and Gaza" },
  { code: "PYF", alpha2: "PF", name: "French Polynesia" },
  { code: "QAT", alpha2: "QA", name: "Qatar" },
  { code: "ROU", alpha2: "RO", name: "Romania" },
  { code: "RUS", alpha2: "RU", name: "Russian Federation" },
  { code: "RWA", alpha2: "RW", name: "Rwanda" },
  { code: "SAU", alpha2: "SA", name: "Saudi Arabia" },
  { code: "SDN", alpha2: "SD", name: "Sudan" },
  { code: "SEN", alpha2: "SN", name: "Senegal" },
  { code: "SGP", alpha2: "SG", name: "Singapore" },
  { code: "SLB", alpha2: "SB", name: "Solomon Islands" },
  { code: "SLE", alpha2: "SL", name: "Sierra Leone" },
  { code: "SLV", alpha2: "SV", name: "El Salvador" },
  { code: "SMR", alpha2: "SM", name: "San Marino" },
  { code: "SOM", alpha2: "SO", name: "Somalia, Fed. Rep." },
  { code: "SRB", alpha2: "RS", name: "Serbia" },
  { code: "SSD", alpha2: "SS", name: "South Sudan" },
  { code: "STP", alpha2: "ST", name: "Sao Tome and Principe" },
  { code: "SUR", alpha2: "SR", name: "Suriname" },
  { code: "SVK", alpha2: "SK", name: "Slovak Republic" },
  { code: "SVN", alpha2: "SI", name: "Slovenia" },
  { code: "SWE", alpha2: "SE", name: "Sweden" },
  { code: "SWZ", alpha2: "SZ", name: "Eswatini" },
  { code: "SXM", alpha2: "SX", name: "Sint Maarten (Dutch part)" },
  { code: "SYC", alpha2: "SC", name: "Seychelles" },
  { code: "SYR", alpha2: "SY", name: "Syrian Arab Republic" },
  { code: "TCA", alpha2: "TC", name: "Turks and Caicos Islands" },
  { code: "TCD", alpha2: "TD", name: "Chad" },
  { code: "TGO", alpha2: "TG", name: "Togo" },
  { code: "THA", alpha2: "TH", name: "Thailand" },
  { code: "TJK", alpha2: "TJ", name: "Tajikistan" },
  { code: "TKM", alpha2: "TM", name: "Turkmenistan" },
  { code: "TLS", alpha2: "TL", name: "Timor-Leste" },
  { code: "TON", alpha2: "TO", name: "Tonga" },
  { code: "TTO", alpha2: "TT", name: "Trinidad and Tobago" },
  { code: "TUN", alpha2: "TN", name: "Tunisia" },
  { code: "TUR", alpha2: "TR", name: "Turkiye" },
  { code: "TUV", alpha2: "TV", name: "Tuvalu" },
  { code: "TZA", alpha2: "TZ", name: "Tanzania" },
  { code: "UGA", alpha2: "UG", name: "Uganda" },
  { code: "UKR", alpha2: "UA", name: "Ukraine" },
  { code: "URY", alpha2: "UY", name: "Uruguay" },
  { code: "USA", alpha2: "US", name: "United States" },
  { code: "UZB", alpha2: "UZ", name: "Uzbekistan" },
  { code: "VCT", alpha2: "VC", name: "St. Vincent and the Grenadines" },
  { code: "VEN", alpha2: "VE", name: "Venezuela, RB" },
  { code: "VGB", alpha2: "VG", name: "British Virgin Islands" },
  { code: "VIR", alpha2: "VI", name: "Virgin Islands (U.S.)" },
  { code: "VNM", alpha2: "VN", name: "Viet Nam" },
  { code: "VUT", alpha2: "VU", name: "Vanuatu" },
  { code: "WSM", alpha2: "WS", name: "Samoa" },
  { code: "XKX", alpha2: "XK", name: "Kosovo" },
  { code: "YEM", alpha2: "YE", name: "Yemen, Rep." },
  { code: "ZAF", alpha2: "ZA", name: "South Africa" },
  { code: "ZMB", alpha2: "ZM", name: "Zambia" },
  { code: "ZWE", alpha2: "ZW", name: "Zimbabwe" },
] as const

// An ISO 3166-1 alpha-3 code the World Bank publishes data for.
export const Country = Schema.Literals(countries.map((country) => country.code))

export type Country = typeof Country.Type

const byAlpha2 = new Map<string, Country>(countries.map(({ code, alpha2 }) => [alpha2, code]))

// The country an ISO 3166-1 alpha-2 code names, as Cloudflare places a
// request in one: "FR" → "FRA". None for a code with no data here, or for
// Cloudflare's "XX" (unknown) and "T1" (Tor).
export const fromAlpha2 = (code: string): Option.Option<Country> =>
  Option.fromUndefinedOr(byAlpha2.get(code.toUpperCase()))

// Names people use that the World Bank spells differently, e.g. "Viet Nam"
// for Vietnam, or that its names do not contain, e.g. "UK".
const aliases = new Map<string, Country>([
  ["us", "USA"],
  ["usa", "USA"],
  ["america", "USA"],
  ["united states of america", "USA"],
  ["uk", "GBR"],
  ["britain", "GBR"],
  ["great britain", "GBR"],
  ["south korea", "KOR"],
  ["north korea", "PRK"],
  ["dprk", "PRK"],
  ["russia", "RUS"],
  ["turkey", "TUR"],
  ["vietnam", "VNM"],
  ["laos", "LAO"],
  ["ivory coast", "CIV"],
  ["czech republic", "CZE"],
  ["slovakia", "SVK"],
  ["kyrgyzstan", "KGZ"],
  ["syria", "SYR"],
  ["drc", "COD"],
  ["dr congo", "COD"],
  ["democratic republic of the congo", "COD"],
  ["republic of the congo", "COG"],
  ["cape verde", "CPV"],
  ["swaziland", "SWZ"],
  ["burma", "MMR"],
  ["macedonia", "MKD"],
  ["east timor", "TLS"],
  ["palestine", "PSE"],
  ["macau", "MAC"],
])

// Lowercase words without accents or punctuation, "saint" as "st", and no
// leading "the": "the Côte d'Ivoire" → "cote d ivoire".
const normalize = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/\bsaint\b/g, "st")

const named = countries.map((country) => ({
  country,
  words: normalize(country.name).split(" "),
}))

// The countries a place name may mean, best first: one for an exact code,
// alias or name, else those whose names hold every word of it as a prefix,
// e.g. both Koreas for "korea". Empty when nothing matches.
export const locate = (name: string): ReadonlyArray<(typeof countries)[number]> => {
  const text = normalize(name)

  const exact = named.find(
    ({ country, words }) =>
      country.code === name.trim().toUpperCase() ||
      country.code === aliases.get(text) ||
      words.join(" ") === text,
  )

  if (exact !== undefined) return [exact.country]

  const asked = text.split(" ").filter((word) => word !== "")

  return asked.length === 0
    ? []
    : named
        .filter(({ words }) => asked.every((word) => words.some((each) => each.startsWith(word))))
        .slice(0, 5)
        .map(({ country }) => country)
}

// "FRA,DEU" ⇄ ["FRA", "DEU"], as a query parameter.
export const CountryList = Schema.String.pipe(
  Schema.decodeTo(Schema.Array(Schema.String), {
    decode: SchemaGetter.split(),
    encode: SchemaGetter.transform((list) => list.join(",")),
  }),
  Schema.decodeTo(Schema.NonEmptyArray(Country).check(Schema.isUnique())),
)

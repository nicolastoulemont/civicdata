import type { Country } from "./Country.ts"

const baltics: ReadonlyArray<Country> = ["EST", "LTU", "LVA"]

const southCaucasus: ReadonlyArray<Country> = ["ARM", "AZE", "GEO"]

const gulf: ReadonlyArray<Country> = ["ARE", "BHR", "KWT", "OMN", "QAT", "SAU"]

const caribbean: ReadonlyArray<Country> = [
  "ABW",
  "ATG",
  "BHS",
  "BRB",
  "CUB",
  "CUW",
  "CYM",
  "DMA",
  "DOM",
  "GRD",
  "HTI",
  "JAM",
  "KNA",
  "LCA",
  "MAF",
  "PRI",
  "SXM",
  "TCA",
  "TTO",
  "VCT",
  "VGB",
  "VIR",
]

const centralAmerica: ReadonlyArray<Country> = [
  "BLZ",
  "CRI",
  "GTM",
  "HND",
  "MEX",
  "NIC",
  "PAN",
  "SLV",
]

const southAmerica: ReadonlyArray<Country> = [
  "ARG",
  "BOL",
  "BRA",
  "CHL",
  "COL",
  "ECU",
  "GUY",
  "PER",
  "PRY",
  "SUR",
  "URY",
  "VEN",
]

const northAmerica: ReadonlyArray<Country> = ["BMU", "CAN", "GRL", "MEX", "USA"]

const northAfrica: ReadonlyArray<Country> = ["DZA", "EGY", "LBY", "MAR", "SDN", "TUN"]

const westAfrica: ReadonlyArray<Country> = [
  "BEN",
  "BFA",
  "CIV",
  "CPV",
  "GHA",
  "GIN",
  "GMB",
  "GNB",
  "LBR",
  "MLI",
  "MRT",
  "NER",
  "NGA",
  "SEN",
  "SLE",
  "TGO",
]

const centralAfrica: ReadonlyArray<Country> = [
  "AGO",
  "CAF",
  "CMR",
  "COD",
  "COG",
  "GAB",
  "GNQ",
  "STP",
  "TCD",
]

const eastAfrica: ReadonlyArray<Country> = [
  "BDI",
  "COM",
  "DJI",
  "ERI",
  "ETH",
  "KEN",
  "RWA",
  "SOM",
  "SSD",
  "SYC",
  "TZA",
  "UGA",
]

const southernAfrica: ReadonlyArray<Country> = [
  "AGO",
  "BWA",
  "LSO",
  "MDG",
  "MOZ",
  "MUS",
  "MWI",
  "NAM",
  "SWZ",
  "ZAF",
  "ZMB",
  "ZWE",
]

const centralAsia: ReadonlyArray<Country> = ["KAZ", "KGZ", "TJK", "TKM", "UZB"]

const eastAsia: ReadonlyArray<Country> = ["CHN", "HKG", "JPN", "KOR", "MAC", "MNG", "PRK"]

const australia: ReadonlyArray<Country> = ["AUS", "FJI", "NCL", "NZL", "PNG", "SLB", "VUT"]

// Neighbouring regions can share a country, e.g. Angola is in both Central
// and Southern Africa, and Mexico in North and Central America. A region
// joined from them lists it once.
const joined = (...parts: ReadonlyArray<ReadonlyArray<Country>>) => [...new Set(parts.flat())]

const africa = joined(northAfrica, westAfrica, centralAfrica, eastAfrica, southernAfrica)

const latinAmerica = [...centralAmerica, ...caribbean, ...southAmerica]

// A group of countries people often compare, with a map of its own. `name`
// reads after "Map of". A map draws the first region, in this order, that
// holds every country it shows, so the narrower regions come first; a map
// with a country in no region, e.g. France with the United States, draws the
// world. Most follow the UN's M49 regions or the World Bank's.
export const regions = [
  { id: "baltics", name: "the Baltic states", countries: baltics },
  {
    id: "western-balkans",
    name: "the Western Balkans",
    countries: ["ALB", "BIH", "MKD", "MNE", "SRB", "XKX"],
  },
  { id: "south-caucasus", name: "the South Caucasus", countries: southCaucasus },
  { id: "gulf", name: "the Gulf states", countries: gulf },
  { id: "caribbean", name: "the Caribbean", countries: caribbean },
  { id: "central-america", name: "Central America", countries: centralAmerica },
  {
    id: "nordics",
    name: "the Nordic countries",
    countries: ["DNK", "FIN", "FRO", "ISL", "NOR", "SWE"],
  },
  { id: "west-africa", name: "West Africa", countries: westAfrica },
  { id: "central-africa", name: "Central Africa", countries: centralAfrica },
  { id: "east-africa", name: "East Africa", countries: eastAfrica },
  { id: "southern-africa", name: "Southern Africa", countries: southernAfrica },
  { id: "north-africa", name: "North Africa", countries: northAfrica },
  {
    id: "middle-east",
    name: "the Middle East",
    countries: [
      ...gulf,
      "CYP",
      "EGY",
      "IRN",
      "IRQ",
      "ISR",
      "JOR",
      "LBN",
      "PSE",
      "SYR",
      "TUR",
      "YEM",
    ],
  },
  { id: "central-asia", name: "Central Asia", countries: centralAsia },
  {
    id: "south-asia",
    name: "South Asia",
    countries: ["AFG", "BGD", "BTN", "IND", "IRN", "LKA", "MDV", "NPL", "PAK"],
  },
  {
    id: "southeast-asia",
    name: "Southeast Asia",
    countries: ["BRN", "IDN", "KHM", "LAO", "MMR", "MYS", "PHL", "SGP", "THA", "TLS", "VNM"],
  },
  { id: "east-asia", name: "East Asia", countries: eastAsia },
  { id: "australia", name: "Australia, New Zealand and their neighbours", countries: australia },
  // The countries Eurostat maps: the EU 27, the EFTA four, the United
  // Kingdom, and the candidate and potential candidate countries. Then every
  // other economy inside the frame those need. Russia reaches the Pacific, so
  // it is not here.
  {
    id: "europe",
    name: "Europe",
    countries: [
      // The EU 27.
      "AUT",
      "BEL",
      "BGR",
      "CYP",
      "CZE",
      "DEU",
      "DNK",
      "ESP",
      "EST",
      "FIN",
      "FRA",
      "GRC",
      "HRV",
      "HUN",
      "IRL",
      "ITA",
      "LTU",
      "LUX",
      "LVA",
      "MLT",
      "NLD",
      "POL",
      "PRT",
      "ROU",
      "SVK",
      "SVN",
      "SWE",
      // EFTA and the United Kingdom.
      "CHE",
      "GBR",
      "ISL",
      "LIE",
      "NOR",
      // Candidates and potential candidates.
      "ALB",
      "BIH",
      "GEO",
      "MDA",
      "MKD",
      "MNE",
      "SRB",
      "TUR",
      "UKR",
      "XKX",
      // The rest of the frame.
      "AND",
      "ARM",
      "BLR",
      "CHI",
      "FRO",
      "GIB",
      "IMN",
      "MCO",
      "SMR",
    ],
  },
  { id: "south-america", name: "South America", countries: southAmerica },
  { id: "latin-america", name: "Latin America and the Caribbean", countries: latinAmerica },
  { id: "north-america", name: "North America", countries: northAmerica },
  {
    id: "sub-saharan-africa",
    name: "Sub-Saharan Africa",
    countries: africa.filter((country) => !["DZA", "EGY", "LBY", "MAR", "TUN"].includes(country)),
  },
  { id: "africa", name: "Africa", countries: africa },
  { id: "northeast-asia", name: "Northeast Asia", countries: [...eastAsia, "RUS"] },
  {
    id: "post-soviet",
    name: "the post-Soviet states",
    countries: [...baltics, ...southCaucasus, ...centralAsia, "BLR", "MDA", "RUS", "UKR"],
  },
  {
    id: "oceania",
    name: "Oceania",
    countries: [
      ...australia,
      "ASM",
      "FSM",
      "GUM",
      "KIR",
      "MHL",
      "MNP",
      "NRU",
      "PLW",
      "PYF",
      "TON",
      "TUV",
      "WSM",
    ],
  },
  { id: "americas", name: "the Americas", countries: joined(northAmerica, latinAmerica) },
] as const satisfies ReadonlyArray<{
  readonly id: string
  readonly name: string
  readonly countries: ReadonlyArray<Country>
}>

export type Region = (typeof regions)[number]

// The first region holding every country, or none: those countries draw on
// the world map.
export const regionOf = (countries: ReadonlyArray<Country>): Region | undefined =>
  regions.find((region) =>
    countries.every((country) => region.countries.some((each) => each === country)),
  )

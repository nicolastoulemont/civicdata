import {
  type Country,
  inYear,
  isRanked,
  Ranking,
  type Region,
  regions,
  type ResolvedView,
  Year,
} from "@repo/domain"
import { bands } from "@repo/maps"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { RankingMap } from "./RankingMap.tsx"
import change from "./recorded/change.json"
import { decode } from "./recorded/decode.ts"
import overTime from "./recorded/map-over-time.json"
import recorded from "./recorded/map.json"
import population from "./recorded/population.json"

const meta = {
  title: "Charts/Map",
  component: RankingMap,
  args: { resolved: decode(recorded) },
} satisfies Meta<typeof RankingMap>

export default meta

type Story = StoryObj<typeof meta>

// Life expectancy in every country in 2023.
export const Default: Story = {}

// The same recording, keeping one region's countries: that region's map.
const within = (id: Region["id"]) => {
  const region = regions.find((each) => each.id === id)
  const holds = (code: string) => region?.countries.some((country) => country === code) ?? false

  return decode({
    ...recorded,
    view: { ...recorded.view, countries: recorded.view.countries.filter(holds) },
    observations: recorded.observations.filter((each) => holds(each.country)),
    missing: recorded.missing.filter(holds),
  })
}

const countryMap = (country: Country) =>
  decode({
    ...recorded,
    view: { ...recorded.view, countries: [country] },
    observations: recorded.observations.filter((each) => each.country === country),
    missing: [],
  })

export const Germany: Story = { args: { resolved: countryMap("DEU") } }

export const GermanyDark: Story = {
  args: { resolved: countryMap("DEU") },
  globals: { theme: "dark" },
}

export const UnitedStates: Story = { args: { resolved: countryMap("USA") } }

export const UnitedStatesDark: Story = {
  args: { resolved: countryMap("USA") },
  globals: { theme: "dark" },
}

export const France: Story = { args: { resolved: countryMap("FRA") } }

export const FranceDark: Story = {
  args: { resolved: countryMap("FRA") },
  globals: { theme: "dark" },
}

export const Spain: Story = { args: { resolved: countryMap("ESP") } }

export const SpainDark: Story = {
  args: { resolved: countryMap("ESP") },
  globals: { theme: "dark" },
}

export const Italy: Story = { args: { resolved: countryMap("ITA") } }

export const ItalyDark: Story = {
  args: { resolved: countryMap("ITA") },
  globals: { theme: "dark" },
}

export const Canada: Story = { args: { resolved: countryMap("CAN") } }

export const CanadaDark: Story = {
  args: { resolved: countryMap("CAN") },
  globals: { theme: "dark" },
}

export const Australia: Story = { args: { resolved: countryMap("AUS") } }

export const AustraliaDark: Story = {
  args: { resolved: countryMap("AUS") },
  globals: { theme: "dark" },
}

export const Austria: Story = { args: { resolved: countryMap("AUT") } }

export const AustriaDark: Story = {
  args: { resolved: countryMap("AUT") },
  globals: { theme: "dark" },
}

export const Switzerland: Story = { args: { resolved: countryMap("CHE") } }

export const SwitzerlandDark: Story = {
  args: { resolved: countryMap("CHE") },
  globals: { theme: "dark" },
}

export const Poland: Story = { args: { resolved: countryMap("POL") } }

export const PolandDark: Story = {
  args: { resolved: countryMap("POL") },
  globals: { theme: "dark" },
}

export const Netherlands: Story = { args: { resolved: countryMap("NLD") } }

export const NetherlandsDark: Story = {
  args: { resolved: countryMap("NLD") },
  globals: { theme: "dark" },
}

export const Japan: Story = { args: { resolved: countryMap("JPN") } }

export const JapanDark: Story = {
  args: { resolved: countryMap("JPN") },
  globals: { theme: "dark" },
}

export const Brazil: Story = { args: { resolved: countryMap("BRA") } }

export const BrazilDark: Story = {
  args: { resolved: countryMap("BRA") },
  globals: { theme: "dark" },
}

export const SouthAfrica: Story = { args: { resolved: countryMap("ZAF") } }

export const SouthAfricaDark: Story = {
  args: { resolved: countryMap("ZAF") },
  globals: { theme: "dark" },
}

export const Sweden: Story = { args: { resolved: countryMap("SWE") } }

export const SwedenDark: Story = {
  args: { resolved: countryMap("SWE") },
  globals: { theme: "dark" },
}

export const Czechia: Story = { args: { resolved: countryMap("CZE") } }

export const CzechiaDark: Story = {
  args: { resolved: countryMap("CZE") },
  globals: { theme: "dark" },
}

export const Portugal: Story = { args: { resolved: countryMap("PRT") } }

export const PortugalDark: Story = {
  args: { resolved: countryMap("PRT") },
  globals: { theme: "dark" },
}

export const Belgium: Story = { args: { resolved: countryMap("BEL") } }

export const BelgiumDark: Story = {
  args: { resolved: countryMap("BEL") },
  globals: { theme: "dark" },
}

export const UnitedKingdom: Story = { args: { resolved: countryMap("GBR") } }

export const UnitedKingdomDark: Story = {
  args: { resolved: countryMap("GBR") },
  globals: { theme: "dark" },
}

export const NewZealand: Story = { args: { resolved: countryMap("NZL") } }

export const NewZealandDark: Story = {
  args: { resolved: countryMap("NZL") },
  globals: { theme: "dark" },
}

export const Argentina: Story = { args: { resolved: countryMap("ARG") } }

export const ArgentinaDark: Story = {
  args: { resolved: countryMap("ARG") },
  globals: { theme: "dark" },
}

// Europe with the EU's outermost regions in insets.
export const Europe: Story = { args: { resolved: within("europe") } }

export const EuropeDark: Story = {
  args: { resolved: within("europe") },
  globals: { theme: "dark" },
}

// Europe with Russia, cut at the Urals.
export const ExtendedEurope: Story = { args: { resolved: within("extended-europe") } }

// North America with Hawaii in an inset.
export const NorthAmerica: Story = { args: { resolved: within("north-america") } }

export const SoutheastAsia: Story = { args: { resolved: within("southeast-asia") } }

export const Caribbean: Story = { args: { resolved: within("caribbean") } }

export const NortheastAsia: Story = { args: { resolved: within("northeast-asia") } }

// A map of one year of a change recording, keeping its values that year.
const yearOf = (recording: typeof change | typeof population, year: number): ResolvedView => {
  const resolved = decode(recording)

  return {
    ...resolved,
    view: Ranking.make({
      indicator: resolved.view.indicator,
      countries: resolved.view.countries,
      year: Year.make(year),
      as: "Map",
    }),
    observations: resolved.observations.filter((each) => each.year === year),
  }
}

// Life expectancy is better higher: the longest lives shade green.
export const HigherIsBetter: Story = { args: { resolved: within("europe") } }

export const HigherIsBetterDark: Story = {
  args: { resolved: within("europe") },
  globals: { theme: "dark" },
}

// Unemployment in the EU in 2023 is better lower: the lowest rates shade green.
export const LowerIsBetter: Story = { args: { resolved: yearOf(change, 2023) } }

export const LowerIsBetterDark: Story = {
  args: { resolved: yearOf(change, 2023) },
  globals: { theme: "dark" },
}

// Population is neither: the map keeps its blue.
export const Neutral: Story = { args: { resolved: yearOf(population, 2023) } }

export const NeutralDark: Story = {
  args: { resolved: yearOf(population, 2023) },
  globals: { theme: "dark" },
}

// Life expectancy in Africa from 1990 to 2023, shown in 2023 on value bands
// fixed across the span.
const moving = decode(overTime)

const overTimeArgs = {
  resolved: isRanked(moving) ? inYear(moving, moving.view.year) : moving,
  bands: bands(moving.observations),
}

export const OverTime: Story = { args: overTimeArgs }

export const OverTimeDark: Story = { args: overTimeArgs, globals: { theme: "dark" } }

export const Mexico: Story = { args: { resolved: countryMap("MEX") } }

export const MexicoDark: Story = {
  args: { resolved: countryMap("MEX") },
  globals: { theme: "dark" },
}

export const Romania: Story = { args: { resolved: countryMap("ROU") } }

export const RomaniaDark: Story = {
  args: { resolved: countryMap("ROU") },
  globals: { theme: "dark" },
}

export const Greece: Story = { args: { resolved: countryMap("GRC") } }

export const GreeceDark: Story = {
  args: { resolved: countryMap("GRC") },
  globals: { theme: "dark" },
}

export const Hungary: Story = { args: { resolved: countryMap("HUN") } }

export const HungaryDark: Story = {
  args: { resolved: countryMap("HUN") },
  globals: { theme: "dark" },
}

export const Chile: Story = { args: { resolved: countryMap("CHL") } }

export const ChileDark: Story = {
  args: { resolved: countryMap("CHL") },
  globals: { theme: "dark" },
}

export const Colombia: Story = { args: { resolved: countryMap("COL") } }

export const ColombiaDark: Story = {
  args: { resolved: countryMap("COL") },
  globals: { theme: "dark" },
}

export const Ireland: Story = { args: { resolved: countryMap("IRL") } }

export const IrelandDark: Story = {
  args: { resolved: countryMap("IRL") },
  globals: { theme: "dark" },
}

export const Slovakia: Story = { args: { resolved: countryMap("SVK") } }

export const SlovakiaDark: Story = {
  args: { resolved: countryMap("SVK") },
  globals: { theme: "dark" },
}

export const Bulgaria: Story = { args: { resolved: countryMap("BGR") } }

export const BulgariaDark: Story = {
  args: { resolved: countryMap("BGR") },
  globals: { theme: "dark" },
}

export const Lithuania: Story = { args: { resolved: countryMap("LTU") } }

export const LithuaniaDark: Story = {
  args: { resolved: countryMap("LTU") },
  globals: { theme: "dark" },
}

export const Turkiye: Story = { args: { resolved: countryMap("TUR") } }

export const TurkiyeDark: Story = {
  args: { resolved: countryMap("TUR") },
  globals: { theme: "dark" },
}

export const Ecuador: Story = { args: { resolved: countryMap("ECU") } }

export const EcuadorDark: Story = {
  args: { resolved: countryMap("ECU") },
  globals: { theme: "dark" },
}

export const Croatia: Story = { args: { resolved: countryMap("HRV") } }

export const CroatiaDark: Story = {
  args: { resolved: countryMap("HRV") },
  globals: { theme: "dark" },
}

export const Estonia: Story = { args: { resolved: countryMap("EST") } }

export const EstoniaDark: Story = {
  args: { resolved: countryMap("EST") },
  globals: { theme: "dark" },
}

export const Peru: Story = { args: { resolved: countryMap("PER") } }

export const PeruDark: Story = { args: { resolved: countryMap("PER") }, globals: { theme: "dark" } }

export const Bolivia: Story = { args: { resolved: countryMap("BOL") } }

export const BoliviaDark: Story = {
  args: { resolved: countryMap("BOL") },
  globals: { theme: "dark" },
}

export const Paraguay: Story = { args: { resolved: countryMap("PRY") } }

export const ParaguayDark: Story = {
  args: { resolved: countryMap("PRY") },
  globals: { theme: "dark" },
}

export const Uruguay: Story = { args: { resolved: countryMap("URY") } }

export const UruguayDark: Story = {
  args: { resolved: countryMap("URY") },
  globals: { theme: "dark" },
}

export const CostaRica: Story = { args: { resolved: countryMap("CRI") } }

export const CostaRicaDark: Story = {
  args: { resolved: countryMap("CRI") },
  globals: { theme: "dark" },
}

export const Guatemala: Story = { args: { resolved: countryMap("GTM") } }

export const GuatemalaDark: Story = {
  args: { resolved: countryMap("GTM") },
  globals: { theme: "dark" },
}

export const Honduras: Story = { args: { resolved: countryMap("HND") } }

export const HondurasDark: Story = {
  args: { resolved: countryMap("HND") },
  globals: { theme: "dark" },
}

export const ElSalvador: Story = { args: { resolved: countryMap("SLV") } }

export const ElSalvadorDark: Story = {
  args: { resolved: countryMap("SLV") },
  globals: { theme: "dark" },
}

export const Nicaragua: Story = { args: { resolved: countryMap("NIC") } }

export const NicaraguaDark: Story = {
  args: { resolved: countryMap("NIC") },
  globals: { theme: "dark" },
}

export const DominicanRepublic: Story = { args: { resolved: countryMap("DOM") } }

export const DominicanRepublicDark: Story = {
  args: { resolved: countryMap("DOM") },
  globals: { theme: "dark" },
}

export const Denmark: Story = { args: { resolved: countryMap("DNK") } }

export const DenmarkDark: Story = {
  args: { resolved: countryMap("DNK") },
  globals: { theme: "dark" },
}

export const Iceland: Story = { args: { resolved: countryMap("ISL") } }

export const IcelandDark: Story = {
  args: { resolved: countryMap("ISL") },
  globals: { theme: "dark" },
}

export const Albania: Story = { args: { resolved: countryMap("ALB") } }

export const AlbaniaDark: Story = {
  args: { resolved: countryMap("ALB") },
  globals: { theme: "dark" },
}

export const Norway: Story = { args: { resolved: countryMap("NOR") } }

export const NorwayDark: Story = {
  args: { resolved: countryMap("NOR") },
  globals: { theme: "dark" },
}

export const Finland: Story = { args: { resolved: countryMap("FIN") } }

export const FinlandDark: Story = {
  args: { resolved: countryMap("FIN") },
  globals: { theme: "dark" },
}

export const Luxembourg: Story = { args: { resolved: countryMap("LUX") } }

export const LuxembourgDark: Story = {
  args: { resolved: countryMap("LUX") },
  globals: { theme: "dark" },
}

export const Slovenia: Story = { args: { resolved: countryMap("SVN") } }

export const SloveniaDark: Story = {
  args: { resolved: countryMap("SVN") },
  globals: { theme: "dark" },
}

export const NorthMacedonia: Story = { args: { resolved: countryMap("MKD") } }

export const NorthMacedoniaDark: Story = {
  args: { resolved: countryMap("MKD") },
  globals: { theme: "dark" },
}

export const Latvia: Story = { args: { resolved: countryMap("LVA") } }

export const LatviaDark: Story = {
  args: { resolved: countryMap("LVA") },
  globals: { theme: "dark" },
}

export const Malta: Story = { args: { resolved: countryMap("MLT") } }

export const MaltaDark: Story = {
  args: { resolved: countryMap("MLT") },
  globals: { theme: "dark" },
}

export const India: Story = { args: { resolved: countryMap("IND") } }

export const IndiaDark: Story = {
  args: { resolved: countryMap("IND") },
  globals: { theme: "dark" },
}

export const Malaysia: Story = { args: { resolved: countryMap("MYS") } }

export const MalaysiaDark: Story = {
  args: { resolved: countryMap("MYS") },
  globals: { theme: "dark" },
}

export const Thailand: Story = { args: { resolved: countryMap("THA") } }

export const ThailandDark: Story = {
  args: { resolved: countryMap("THA") },
  globals: { theme: "dark" },
}

export const SriLanka: Story = { args: { resolved: countryMap("LKA") } }

export const SriLankaDark: Story = {
  args: { resolved: countryMap("LKA") },
  globals: { theme: "dark" },
}

export const Armenia: Story = { args: { resolved: countryMap("ARM") } }

export const ArmeniaDark: Story = {
  args: { resolved: countryMap("ARM") },
  globals: { theme: "dark" },
}

export const Mongolia: Story = { args: { resolved: countryMap("MNG") } }

export const MongoliaDark: Story = {
  args: { resolved: countryMap("MNG") },
  globals: { theme: "dark" },
}

export const Uzbekistan: Story = { args: { resolved: countryMap("UZB") } }

export const UzbekistanDark: Story = {
  args: { resolved: countryMap("UZB") },
  globals: { theme: "dark" },
}

export const Tajikistan: Story = { args: { resolved: countryMap("TJK") } }

export const TajikistanDark: Story = {
  args: { resolved: countryMap("TJK") },
  globals: { theme: "dark" },
}

export const SaudiArabia: Story = { args: { resolved: countryMap("SAU") } }

export const SaudiArabiaDark: Story = {
  args: { resolved: countryMap("SAU") },
  globals: { theme: "dark" },
}

export const Jordan: Story = { args: { resolved: countryMap("JOR") } }

export const JordanDark: Story = {
  args: { resolved: countryMap("JOR") },
  globals: { theme: "dark" },
}

export const Egypt: Story = { args: { resolved: countryMap("EGY") } }

export const EgyptDark: Story = {
  args: { resolved: countryMap("EGY") },
  globals: { theme: "dark" },
}

export const Nigeria: Story = { args: { resolved: countryMap("NGA") } }

export const NigeriaDark: Story = {
  args: { resolved: countryMap("NGA") },
  globals: { theme: "dark" },
}

export const Zambia: Story = { args: { resolved: countryMap("ZMB") } }

export const ZambiaDark: Story = {
  args: { resolved: countryMap("ZMB") },
  globals: { theme: "dark" },
}

export const Rwanda: Story = { args: { resolved: countryMap("RWA") } }

export const RwandaDark: Story = {
  args: { resolved: countryMap("RWA") },
  globals: { theme: "dark" },
}

export const Senegal: Story = { args: { resolved: countryMap("SEN") } }

export const SenegalDark: Story = {
  args: { resolved: countryMap("SEN") },
  globals: { theme: "dark" },
}

export const Vietnam: Story = { args: { resolved: countryMap("VNM") } }

export const VietnamDark: Story = {
  args: { resolved: countryMap("VNM") },
  globals: { theme: "dark" },
}

export const Nepal: Story = { args: { resolved: countryMap("NPL") } }

export const NepalDark: Story = {
  args: { resolved: countryMap("NPL") },
  globals: { theme: "dark" },
}

export const Kyrgyzstan: Story = { args: { resolved: countryMap("KGZ") } }

export const KyrgyzstanDark: Story = {
  args: { resolved: countryMap("KGZ") },
  globals: { theme: "dark" },
}

export const Kenya: Story = { args: { resolved: countryMap("KEN") } }

export const KenyaDark: Story = {
  args: { resolved: countryMap("KEN") },
  globals: { theme: "dark" },
}

export const Ghana: Story = { args: { resolved: countryMap("GHA") } }

export const GhanaDark: Story = {
  args: { resolved: countryMap("GHA") },
  globals: { theme: "dark" },
}

export const Namibia: Story = { args: { resolved: countryMap("NAM") } }

export const NamibiaDark: Story = {
  args: { resolved: countryMap("NAM") },
  globals: { theme: "dark" },
}

export const Tunisia: Story = { args: { resolved: countryMap("TUN") } }

export const TunisiaDark: Story = {
  args: { resolved: countryMap("TUN") },
  globals: { theme: "dark" },
}

export const Kazakhstan: Story = { args: { resolved: countryMap("KAZ") } }

export const KazakhstanDark: Story = {
  args: { resolved: countryMap("KAZ") },
  globals: { theme: "dark" },
}

export const Bangladesh: Story = { args: { resolved: countryMap("BGD") } }

export const BangladeshDark: Story = {
  args: { resolved: countryMap("BGD") },
  globals: { theme: "dark" },
}

export const UnitedArabEmirates: Story = { args: { resolved: countryMap("ARE") } }

export const UnitedArabEmiratesDark: Story = {
  args: { resolved: countryMap("ARE") },
  globals: { theme: "dark" },
}

export const Georgia: Story = { args: { resolved: countryMap("GEO") } }

export const GeorgiaDark: Story = {
  args: { resolved: countryMap("GEO") },
  globals: { theme: "dark" },
}

export const Indonesia: Story = { args: { resolved: countryMap("IDN") } }

export const IndonesiaDark: Story = {
  args: { resolved: countryMap("IDN") },
  globals: { theme: "dark" },
}

export const Algeria: Story = { args: { resolved: countryMap("DZA") } }

export const AlgeriaDark: Story = {
  args: { resolved: countryMap("DZA") },
  globals: { theme: "dark" },
}

export const Philippines: Story = { args: { resolved: countryMap("PHL") } }

export const PhilippinesDark: Story = {
  args: { resolved: countryMap("PHL") },
  globals: { theme: "dark" },
}

export const SouthKorea: Story = { args: { resolved: countryMap("KOR") } }

export const SouthKoreaDark: Story = {
  args: { resolved: countryMap("KOR") },
  globals: { theme: "dark" },
}

export const Andorra: Story = { args: { resolved: countryMap("AND") } }

export const AndorraDark: Story = {
  args: { resolved: countryMap("AND") },
  globals: { theme: "dark" },
}

export const AmericanSamoa: Story = { args: { resolved: countryMap("ASM") } }

export const AmericanSamoaDark: Story = {
  args: { resolved: countryMap("ASM") },
  globals: { theme: "dark" },
}

export const AntiguaAndBarbuda: Story = { args: { resolved: countryMap("ATG") } }

export const AntiguaAndBarbudaDark: Story = {
  args: { resolved: countryMap("ATG") },
  globals: { theme: "dark" },
}

export const Benin: Story = { args: { resolved: countryMap("BEN") } }

export const BeninDark: Story = {
  args: { resolved: countryMap("BEN") },
  globals: { theme: "dark" },
}

export const Belarus: Story = { args: { resolved: countryMap("BLR") } }

export const BelarusDark: Story = {
  args: { resolved: countryMap("BLR") },
  globals: { theme: "dark" },
}

export const Belize: Story = { args: { resolved: countryMap("BLZ") } }

export const BelizeDark: Story = {
  args: { resolved: countryMap("BLZ") },
  globals: { theme: "dark" },
}

export const Bermuda: Story = { args: { resolved: countryMap("BMU") } }

export const BermudaDark: Story = {
  args: { resolved: countryMap("BMU") },
  globals: { theme: "dark" },
}

export const Barbados: Story = { args: { resolved: countryMap("BRB") } }

export const BarbadosDark: Story = {
  args: { resolved: countryMap("BRB") },
  globals: { theme: "dark" },
}

export const Brunei: Story = { args: { resolved: countryMap("BRN") } }

export const BruneiDark: Story = {
  args: { resolved: countryMap("BRN") },
  globals: { theme: "dark" },
}

export const Bhutan: Story = { args: { resolved: countryMap("BTN") } }

export const BhutanDark: Story = {
  args: { resolved: countryMap("BTN") },
  globals: { theme: "dark" },
}

export const Cameroon: Story = { args: { resolved: countryMap("CMR") } }

export const CameroonDark: Story = {
  args: { resolved: countryMap("CMR") },
  globals: { theme: "dark" },
}

export const Comoros: Story = { args: { resolved: countryMap("COM") } }

export const ComorosDark: Story = {
  args: { resolved: countryMap("COM") },
  globals: { theme: "dark" },
}

export const CaboVerde: Story = { args: { resolved: countryMap("CPV") } }

export const CaboVerdeDark: Story = {
  args: { resolved: countryMap("CPV") },
  globals: { theme: "dark" },
}

export const Cuba: Story = { args: { resolved: countryMap("CUB") } }

export const CubaDark: Story = { args: { resolved: countryMap("CUB") }, globals: { theme: "dark" } }

export const Djibouti: Story = { args: { resolved: countryMap("DJI") } }

export const DjiboutiDark: Story = {
  args: { resolved: countryMap("DJI") },
  globals: { theme: "dark" },
}

export const Dominica: Story = { args: { resolved: countryMap("DMA") } }

export const DominicaDark: Story = {
  args: { resolved: countryMap("DMA") },
  globals: { theme: "dark" },
}

export const Eritrea: Story = { args: { resolved: countryMap("ERI") } }

export const EritreaDark: Story = {
  args: { resolved: countryMap("ERI") },
  globals: { theme: "dark" },
}

export const Fiji: Story = { args: { resolved: countryMap("FJI") } }

export const FijiDark: Story = { args: { resolved: countryMap("FJI") }, globals: { theme: "dark" } }

export const Micronesia: Story = { args: { resolved: countryMap("FSM") } }

export const MicronesiaDark: Story = {
  args: { resolved: countryMap("FSM") },
  globals: { theme: "dark" },
}

export const Gabon: Story = { args: { resolved: countryMap("GAB") } }

export const GabonDark: Story = {
  args: { resolved: countryMap("GAB") },
  globals: { theme: "dark" },
}

export const Guinea: Story = { args: { resolved: countryMap("GIN") } }

export const GuineaDark: Story = {
  args: { resolved: countryMap("GIN") },
  globals: { theme: "dark" },
}

export const GambiaThe: Story = { args: { resolved: countryMap("GMB") } }

export const GambiaTheDark: Story = {
  args: { resolved: countryMap("GMB") },
  globals: { theme: "dark" },
}

export const GuineaBissau: Story = { args: { resolved: countryMap("GNB") } }

export const GuineaBissauDark: Story = {
  args: { resolved: countryMap("GNB") },
  globals: { theme: "dark" },
}

export const Grenada: Story = { args: { resolved: countryMap("GRD") } }

export const GrenadaDark: Story = {
  args: { resolved: countryMap("GRD") },
  globals: { theme: "dark" },
}

export const Guyana: Story = { args: { resolved: countryMap("GUY") } }

export const GuyanaDark: Story = {
  args: { resolved: countryMap("GUY") },
  globals: { theme: "dark" },
}

export const HongKongSarChina: Story = { args: { resolved: countryMap("HKG") } }

export const HongKongSarChinaDark: Story = {
  args: { resolved: countryMap("HKG") },
  globals: { theme: "dark" },
}

export const Haiti: Story = { args: { resolved: countryMap("HTI") } }

export const HaitiDark: Story = {
  args: { resolved: countryMap("HTI") },
  globals: { theme: "dark" },
}

export const Iran: Story = { args: { resolved: countryMap("IRN") } }

export const IranDark: Story = { args: { resolved: countryMap("IRN") }, globals: { theme: "dark" } }

export const Jamaica: Story = { args: { resolved: countryMap("JAM") } }

export const JamaicaDark: Story = {
  args: { resolved: countryMap("JAM") },
  globals: { theme: "dark" },
}

export const SaintKittsAndNevis: Story = { args: { resolved: countryMap("KNA") } }

export const SaintKittsAndNevisDark: Story = {
  args: { resolved: countryMap("KNA") },
  globals: { theme: "dark" },
}

export const Kuwait: Story = { args: { resolved: countryMap("KWT") } }

export const KuwaitDark: Story = {
  args: { resolved: countryMap("KWT") },
  globals: { theme: "dark" },
}

export const Liberia: Story = { args: { resolved: countryMap("LBR") } }

export const LiberiaDark: Story = {
  args: { resolved: countryMap("LBR") },
  globals: { theme: "dark" },
}

export const Liechtenstein: Story = { args: { resolved: countryMap("LIE") } }

export const LiechtensteinDark: Story = {
  args: { resolved: countryMap("LIE") },
  globals: { theme: "dark" },
}

export const Lesotho: Story = { args: { resolved: countryMap("LSO") } }

export const LesothoDark: Story = {
  args: { resolved: countryMap("LSO") },
  globals: { theme: "dark" },
}

export const Mozambique: Story = { args: { resolved: countryMap("MOZ") } }

export const MozambiqueDark: Story = {
  args: { resolved: countryMap("MOZ") },
  globals: { theme: "dark" },
}

export const Malawi: Story = { args: { resolved: countryMap("MWI") } }

export const MalawiDark: Story = {
  args: { resolved: countryMap("MWI") },
  globals: { theme: "dark" },
}

export const NewCaledonia: Story = { args: { resolved: countryMap("NCL") } }

export const NewCaledoniaDark: Story = {
  args: { resolved: countryMap("NCL") },
  globals: { theme: "dark" },
}

export const Niger: Story = { args: { resolved: countryMap("NER") } }

export const NigerDark: Story = {
  args: { resolved: countryMap("NER") },
  globals: { theme: "dark" },
}

export const Naoero: Story = { args: { resolved: countryMap("NRU") } }

export const NaoeroDark: Story = {
  args: { resolved: countryMap("NRU") },
  globals: { theme: "dark" },
}

export const Oman: Story = { args: { resolved: countryMap("OMN") } }

export const OmanDark: Story = { args: { resolved: countryMap("OMN") }, globals: { theme: "dark" } }

export const Palau: Story = { args: { resolved: countryMap("PLW") } }

export const PalauDark: Story = {
  args: { resolved: countryMap("PLW") },
  globals: { theme: "dark" },
}

export const FrenchPolynesia: Story = { args: { resolved: countryMap("PYF") } }

export const FrenchPolynesiaDark: Story = {
  args: { resolved: countryMap("PYF") },
  globals: { theme: "dark" },
}

export const Singapore: Story = { args: { resolved: countryMap("SGP") } }

export const SingaporeDark: Story = {
  args: { resolved: countryMap("SGP") },
  globals: { theme: "dark" },
}

export const SolomonIslands: Story = { args: { resolved: countryMap("SLB") } }

export const SolomonIslandsDark: Story = {
  args: { resolved: countryMap("SLB") },
  globals: { theme: "dark" },
}

export const SanMarino: Story = { args: { resolved: countryMap("SMR") } }

export const SanMarinoDark: Story = {
  args: { resolved: countryMap("SMR") },
  globals: { theme: "dark" },
}

export const Serbia: Story = { args: { resolved: countryMap("SRB") } }

export const SerbiaDark: Story = {
  args: { resolved: countryMap("SRB") },
  globals: { theme: "dark" },
}

export const Suriname: Story = { args: { resolved: countryMap("SUR") } }

export const SurinameDark: Story = {
  args: { resolved: countryMap("SUR") },
  globals: { theme: "dark" },
}

export const Eswatini: Story = { args: { resolved: countryMap("SWZ") } }

export const EswatiniDark: Story = {
  args: { resolved: countryMap("SWZ") },
  globals: { theme: "dark" },
}

export const TurksAndCaicosIslands: Story = { args: { resolved: countryMap("TCA") } }

export const TurksAndCaicosIslandsDark: Story = {
  args: { resolved: countryMap("TCA") },
  globals: { theme: "dark" },
}

export const Tonga: Story = { args: { resolved: countryMap("TON") } }

export const TongaDark: Story = {
  args: { resolved: countryMap("TON") },
  globals: { theme: "dark" },
}

export const SaintVincentAndTheGrenadines: Story = { args: { resolved: countryMap("VCT") } }

export const SaintVincentAndTheGrenadinesDark: Story = {
  args: { resolved: countryMap("VCT") },
  globals: { theme: "dark" },
}

export const UsVirginIslands: Story = { args: { resolved: countryMap("VIR") } }

export const UsVirginIslandsDark: Story = {
  args: { resolved: countryMap("VIR") },
  globals: { theme: "dark" },
}

export const Vanuatu: Story = { args: { resolved: countryMap("VUT") } }

export const VanuatuDark: Story = {
  args: { resolved: countryMap("VUT") },
  globals: { theme: "dark" },
}

export const Samoa: Story = { args: { resolved: countryMap("WSM") } }

export const SamoaDark: Story = {
  args: { resolved: countryMap("WSM") },
  globals: { theme: "dark" },
}

export const Zimbabwe: Story = { args: { resolved: countryMap("ZWE") } }

export const ZimbabweDark: Story = {
  args: { resolved: countryMap("ZWE") },
  globals: { theme: "dark" },
}

export const Burundi: Story = { args: { resolved: countryMap("BDI") } }

export const BurundiDark: Story = {
  args: { resolved: countryMap("BDI") },
  globals: { theme: "dark" },
}

export const BurkinaFaso: Story = { args: { resolved: countryMap("BFA") } }

export const BurkinaFasoDark: Story = {
  args: { resolved: countryMap("BFA") },
  globals: { theme: "dark" },
}

export const CentralAfricanRepublic: Story = { args: { resolved: countryMap("CAF") } }

export const CentralAfricanRepublicDark: Story = {
  args: { resolved: countryMap("CAF") },
  globals: { theme: "dark" },
}

export const CoteDivoire: Story = { args: { resolved: countryMap("CIV") } }

export const CoteDivoireDark: Story = {
  args: { resolved: countryMap("CIV") },
  globals: { theme: "dark" },
}

export const DemocraticRepublicOfCongo: Story = { args: { resolved: countryMap("COD") } }

export const DemocraticRepublicOfCongoDark: Story = {
  args: { resolved: countryMap("COD") },
  globals: { theme: "dark" },
}

export const Ethiopia: Story = { args: { resolved: countryMap("ETH") } }

export const EthiopiaDark: Story = {
  args: { resolved: countryMap("ETH") },
  globals: { theme: "dark" },
}

export const Cambodia: Story = { args: { resolved: countryMap("KHM") } }

export const CambodiaDark: Story = {
  args: { resolved: countryMap("KHM") },
  globals: { theme: "dark" },
}

export const Laos: Story = { args: { resolved: countryMap("LAO") } }

export const LaosDark: Story = { args: { resolved: countryMap("LAO") }, globals: { theme: "dark" } }

export const Mali: Story = { args: { resolved: countryMap("MLI") } }

export const MaliDark: Story = { args: { resolved: countryMap("MLI") }, globals: { theme: "dark" } }

export const Mauritania: Story = { args: { resolved: countryMap("MRT") } }

export const MauritaniaDark: Story = {
  args: { resolved: countryMap("MRT") },
  globals: { theme: "dark" },
}

export const Myanmar: Story = { args: { resolved: countryMap("MMR") } }

export const MyanmarDark: Story = {
  args: { resolved: countryMap("MMR") },
  globals: { theme: "dark" },
}

export const PapuaNewGuinea: Story = { args: { resolved: countryMap("PNG") } }

export const PapuaNewGuineaDark: Story = {
  args: { resolved: countryMap("PNG") },
  globals: { theme: "dark" },
}

export const Qatar: Story = { args: { resolved: countryMap("QAT") } }

export const QatarDark: Story = {
  args: { resolved: countryMap("QAT") },
  globals: { theme: "dark" },
}

export const Sudan: Story = { args: { resolved: countryMap("SDN") } }

export const SudanDark: Story = {
  args: { resolved: countryMap("SDN") },
  globals: { theme: "dark" },
}

export const SierraLeone: Story = { args: { resolved: countryMap("SLE") } }

export const SierraLeoneDark: Story = {
  args: { resolved: countryMap("SLE") },
  globals: { theme: "dark" },
}

export const Chad: Story = { args: { resolved: countryMap("TCD") } }

export const ChadDark: Story = { args: { resolved: countryMap("TCD") }, globals: { theme: "dark" } }

export const Uganda: Story = { args: { resolved: countryMap("UGA") } }

export const UgandaDark: Story = {
  args: { resolved: countryMap("UGA") },
  globals: { theme: "dark" },
}

export const YemenRep: Story = { args: { resolved: countryMap("YEM") } }

export const YemenRepDark: Story = {
  args: { resolved: countryMap("YEM") },
  globals: { theme: "dark" },
}

export const Madagascar: Story = { args: { resolved: countryMap("MDG") } }

export const MadagascarDark: Story = {
  args: { resolved: countryMap("MDG") },
  globals: { theme: "dark" },
}

export const Tanzania: Story = { args: { resolved: countryMap("TZA") } }

export const TanzaniaDark: Story = {
  args: { resolved: countryMap("TZA") },
  globals: { theme: "dark" },
}

export const TimorLeste: Story = { args: { resolved: countryMap("TLS") } }

export const TimorLesteDark: Story = {
  args: { resolved: countryMap("TLS") },
  globals: { theme: "dark" },
}

export const Bahrain: Story = { args: { resolved: countryMap("BHR") } }

export const BahrainDark: Story = {
  args: { resolved: countryMap("BHR") },
  globals: { theme: "dark" },
}

export const Bahamas: Story = { args: { resolved: countryMap("BHS") } }

export const BahamasDark: Story = {
  args: { resolved: countryMap("BHS") },
  globals: { theme: "dark" },
}

export const BosniaAndHerzegovina: Story = { args: { resolved: countryMap("BIH") } }

export const BosniaAndHerzegovinaDark: Story = {
  args: { resolved: countryMap("BIH") },
  globals: { theme: "dark" },
}

export const China: Story = { args: { resolved: countryMap("CHN") } }

export const ChinaDark: Story = {
  args: { resolved: countryMap("CHN") },
  globals: { theme: "dark" },
}

export const Cyprus: Story = { args: { resolved: countryMap("CYP") } }

export const CyprusDark: Story = {
  args: { resolved: countryMap("CYP") },
  globals: { theme: "dark" },
}

export const Israel: Story = { args: { resolved: countryMap("ISR") } }

export const IsraelDark: Story = {
  args: { resolved: countryMap("ISR") },
  globals: { theme: "dark" },
}

export const Kiribati: Story = { args: { resolved: countryMap("KIR") } }

export const KiribatiDark: Story = {
  args: { resolved: countryMap("KIR") },
  globals: { theme: "dark" },
}

export const Lebanon: Story = { args: { resolved: countryMap("LBN") } }

export const LebanonDark: Story = {
  args: { resolved: countryMap("LBN") },
  globals: { theme: "dark" },
}

export const StLucia: Story = { args: { resolved: countryMap("LCA") } }

export const StLuciaDark: Story = {
  args: { resolved: countryMap("LCA") },
  globals: { theme: "dark" },
}

export const Moldova: Story = { args: { resolved: countryMap("MDA") } }

export const MoldovaDark: Story = {
  args: { resolved: countryMap("MDA") },
  globals: { theme: "dark" },
}

export const Maldives: Story = { args: { resolved: countryMap("MDV") } }

export const MaldivesDark: Story = {
  args: { resolved: countryMap("MDV") },
  globals: { theme: "dark" },
}

export const MarshallIslands: Story = { args: { resolved: countryMap("MHL") } }

export const MarshallIslandsDark: Story = {
  args: { resolved: countryMap("MHL") },
  globals: { theme: "dark" },
}

export const Mauritius: Story = { args: { resolved: countryMap("MUS") } }

export const MauritiusDark: Story = {
  args: { resolved: countryMap("MUS") },
  globals: { theme: "dark" },
}

export const Pakistan: Story = { args: { resolved: countryMap("PAK") } }

export const PakistanDark: Story = {
  args: { resolved: countryMap("PAK") },
  globals: { theme: "dark" },
}

export const WestBankAndGaza: Story = { args: { resolved: countryMap("PSE") } }

export const WestBankAndGazaDark: Story = {
  args: { resolved: countryMap("PSE") },
  globals: { theme: "dark" },
}

export const SomaliaFedRep: Story = { args: { resolved: countryMap("SOM") } }

export const SomaliaFedRepDark: Story = {
  args: { resolved: countryMap("SOM") },
  globals: { theme: "dark" },
}

export const SaoTomeAndPrincipe: Story = { args: { resolved: countryMap("STP") } }

export const SaoTomeAndPrincipeDark: Story = {
  args: { resolved: countryMap("STP") },
  globals: { theme: "dark" },
}

export const Syria: Story = { args: { resolved: countryMap("SYR") } }

export const SyriaDark: Story = {
  args: { resolved: countryMap("SYR") },
  globals: { theme: "dark" },
}

export const Greenland: Story = { args: { resolved: countryMap("GRL") } }

export const GreenlandDark: Story = {
  args: { resolved: countryMap("GRL") },
  globals: { theme: "dark" },
}

export const Afghanistan: Story = { args: { resolved: countryMap("AFG") } }

export const AfghanistanDark: Story = {
  args: { resolved: countryMap("AFG") },
  globals: { theme: "dark" },
}

export const TrinidadAndTobago: Story = { args: { resolved: countryMap("TTO") } }

export const TrinidadAndTobagoDark: Story = {
  args: { resolved: countryMap("TTO") },
  globals: { theme: "dark" },
}

export const Venezuela: Story = { args: { resolved: countryMap("VEN") } }

export const VenezuelaDark: Story = {
  args: { resolved: countryMap("VEN") },
  globals: { theme: "dark" },
}

export const Togo: Story = { args: { resolved: countryMap("TGO") } }

export const TogoDark: Story = { args: { resolved: countryMap("TGO") }, globals: { theme: "dark" } }

export const ChannelIslands: Story = { args: { resolved: countryMap("CHI") } }

export const ChannelIslandsDark: Story = {
  args: { resolved: countryMap("CHI") },
  globals: { theme: "dark" },
}

export const Azerbaijan: Story = { args: { resolved: countryMap("AZE") } }

export const AzerbaijanDark: Story = {
  args: { resolved: countryMap("AZE") },
  globals: { theme: "dark" },
}

export const CaymanIslands: Story = { args: { resolved: countryMap("CYM") } }

export const CaymanIslandsDark: Story = {
  args: { resolved: countryMap("CYM") },
  globals: { theme: "dark" },
}

export const FaroeIslands: Story = { args: { resolved: countryMap("FRO") } }

export const FaroeIslandsDark: Story = {
  args: { resolved: countryMap("FRO") },
  globals: { theme: "dark" },
}

export const EquatorialGuinea: Story = { args: { resolved: countryMap("GNQ") } }

export const EquatorialGuineaDark: Story = {
  args: { resolved: countryMap("GNQ") },
  globals: { theme: "dark" },
}

export const Guam: Story = { args: { resolved: countryMap("GUM") } }

export const GuamDark: Story = { args: { resolved: countryMap("GUM") }, globals: { theme: "dark" } }

export const IsleOfMan: Story = { args: { resolved: countryMap("IMN") } }

export const IsleOfManDark: Story = {
  args: { resolved: countryMap("IMN") },
  globals: { theme: "dark" },
}

export const Iraq: Story = { args: { resolved: countryMap("IRQ") } }

export const IraqDark: Story = { args: { resolved: countryMap("IRQ") }, globals: { theme: "dark" } }

export const Montenegro: Story = { args: { resolved: countryMap("MNE") } }

export const MontenegroDark: Story = {
  args: { resolved: countryMap("MNE") },
  globals: { theme: "dark" },
}

export const NorthernMarianaIslands: Story = { args: { resolved: countryMap("MNP") } }

export const NorthernMarianaIslandsDark: Story = {
  args: { resolved: countryMap("MNP") },
  globals: { theme: "dark" },
}

export const Panama: Story = { args: { resolved: countryMap("PAN") } }

export const PanamaDark: Story = {
  args: { resolved: countryMap("PAN") },
  globals: { theme: "dark" },
}

export const PuertoRicoUs: Story = { args: { resolved: countryMap("PRI") } }

export const PuertoRicoUsDark: Story = {
  args: { resolved: countryMap("PRI") },
  globals: { theme: "dark" },
}

export const NorthKorea: Story = { args: { resolved: countryMap("PRK") } }

export const NorthKoreaDark: Story = {
  args: { resolved: countryMap("PRK") },
  globals: { theme: "dark" },
}

export const Russia: Story = { args: { resolved: countryMap("RUS") } }

export const RussiaDark: Story = {
  args: { resolved: countryMap("RUS") },
  globals: { theme: "dark" },
}

export const Tuvalu: Story = { args: { resolved: countryMap("TUV") } }

export const TuvaluDark: Story = {
  args: { resolved: countryMap("TUV") },
  globals: { theme: "dark" },
}

export const Ukraine: Story = { args: { resolved: countryMap("UKR") } }

export const UkraineDark: Story = {
  args: { resolved: countryMap("UKR") },
  globals: { theme: "dark" },
}

export const BritishVirginIslands: Story = { args: { resolved: countryMap("VGB") } }

export const BritishVirginIslandsDark: Story = {
  args: { resolved: countryMap("VGB") },
  globals: { theme: "dark" },
}

export const Kosovo: Story = { args: { resolved: countryMap("XKX") } }

export const KosovoDark: Story = {
  args: { resolved: countryMap("XKX") },
  globals: { theme: "dark" },
}

export const Macao: Story = { args: { resolved: countryMap("MAC") } }

export const MacaoDark: Story = {
  args: { resolved: countryMap("MAC") },
  globals: { theme: "dark" },
}

export const Morocco: Story = { args: { resolved: countryMap("MAR") } }

export const MoroccoDark: Story = {
  args: { resolved: countryMap("MAR") },
  globals: { theme: "dark" },
}

export const Seychelles: Story = { args: { resolved: countryMap("SYC") } }

export const SeychellesDark: Story = {
  args: { resolved: countryMap("SYC") },
  globals: { theme: "dark" },
}

export const SouthSudan: Story = { args: { resolved: countryMap("SSD") } }

export const SouthSudanDark: Story = {
  args: { resolved: countryMap("SSD") },
  globals: { theme: "dark" },
}

export const Curacao: Story = { args: { resolved: countryMap("CUW") } }

export const CuracaoDark: Story = {
  args: { resolved: countryMap("CUW") },
  globals: { theme: "dark" },
}

export const Monaco: Story = { args: { resolved: countryMap("MCO") } }

export const MonacoDark: Story = {
  args: { resolved: countryMap("MCO") },
  globals: { theme: "dark" },
}

export const Turkmenistan: Story = { args: { resolved: countryMap("TKM") } }

export const TurkmenistanDark: Story = {
  args: { resolved: countryMap("TKM") },
  globals: { theme: "dark" },
}

export const Botswana: Story = { args: { resolved: countryMap("BWA") } }

export const BotswanaDark: Story = {
  args: { resolved: countryMap("BWA") },
  globals: { theme: "dark" },
}

export const Angola: Story = { args: { resolved: countryMap("AGO") } }

export const AngolaDark: Story = {
  args: { resolved: countryMap("AGO") },
  globals: { theme: "dark" },
}

export const SaintMartin: Story = { args: { resolved: countryMap("MAF") } }

export const SaintMartinDark: Story = {
  args: { resolved: countryMap("MAF") },
  globals: { theme: "dark" },
}

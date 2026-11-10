import { IndicatorId, Trend as TrendView, Year } from "@civicdata/domain"
import type { View } from "@civicdata/domain"
import { Array as Arr } from "effect"

import { Expected } from "./score.ts"

// Questions asked in one conversation, in order, and the answers to the last
// one that count as right. `shown` is the chart a person changes the first
// chart of the answer before the last question to.
export interface Case {
  readonly questions: Arr.NonEmptyReadonlyArray<string>
  readonly shown?: View
  readonly accepts: Arr.NonEmptyReadonlyArray<Expected>
}

const { Trend, Ranking, Map, Change, Relation, Charts, Asked, Unanswered } = Expected

// Close indicators that answer the same question equally well, by source:
// World Bank codes, and the series of Eurostat and OECD dataflows. A case
// accepts a source when it covers all the case's countries: Eurostat the EU
// and EFTA, the OECD its members.
const lifeExpectancy = {
  worldBank: ["SP.DYN.LE00.IN"],
  // At birth, in years.
  eurostat: [{ indicator: "ESTAT,TPS00205,1.0", dimensions: { sex: ["T"] } }],
} as const

const population = {
  worldBank: ["SP.POP.TOTL"],
  // On 1 January rather than at mid-year, as Counterparts.ts groups them.
  eurostat: [{ indicator: "ESTAT,TPS00001,1.0", dimensions: {} }],
  oecd: [
    {
      indicator: "OECD.ELS.SAE,DSD_POPULATION@DF_POP_HIST,1.0",
      dimensions: { MEASURE: ["POP"], UNIT_MEASURE: ["PS"], SEX: ["_T"], AGE: ["_T"] },
    },
  ],
} as const

// Unemployed persons as a share of the labour force. The World Bank counts
// ages 15 and over, Eurostat 15 to 74, the OECD either.
const unemployment = {
  worldBank: ["SL.UEM.TOTL.ZS", "SL.UEM.TOTL.NE.ZS"],
  eurostat: [
    { indicator: "ESTAT,TIPSUN20,1.0", dimensions: { age: ["Y15-74"] } },
    {
      indicator: "ESTAT,UNE_RT_A,1.0",
      dimensions: { age: ["Y15-74"], sex: ["T"], unit: ["PC_ACT"] },
    },
  ],
  oecd: [
    {
      indicator: "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
      dimensions: { SEX: ["_T"], AGE: ["Y_GE15"] },
    },
    {
      indicator: "OECD.ELS.SAE,DSD_LFS@DF_LFS_INDIC,1.1",
      dimensions: { MEASURE: ["UNE_RATE"], SEX: ["_T"], AGE: ["_T", "Y15T74"] },
    },
  ],
} as const

// The same share for ages 15 to 24.
const youthUnemployment = {
  worldBank: ["SL.UEM.1524.ZS", "SL.UEM.1524.NE.ZS"],
  eurostat: [
    { indicator: "ESTAT,TESEM140,1.0", dimensions: { sex: ["T"] } },
    { indicator: "ESTAT,TIPSUN20,1.0", dimensions: { age: ["Y15-24"] } },
    {
      indicator: "ESTAT,UNE_RT_A,1.0",
      dimensions: { age: ["Y15-24"], sex: ["T"], unit: ["PC_ACT"] },
    },
  ],
  oecd: [
    {
      indicator: "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
      dimensions: { SEX: ["_T"], AGE: ["Y15T24"] },
    },
    {
      indicator: "OECD.ELS.SAE,DSD_LFS@DF_LFS_INDIC,1.1",
      dimensions: { MEASURE: ["UNE_RATE"], SEX: ["_T"], AGE: ["Y15T24"] },
    },
  ],
} as const

const inflation = ["FP.CPI.TOTL.ZG"] as const
const infantMortality = ["SP.DYN.IMRT.IN"] as const

// In current or constant prices, at market rates or purchasing power, in a
// currency common to the countries compared.
const gdp = {
  worldBank: ["NY.GDP.MKTP.CD", "NY.GDP.MKTP.KD", "NY.GDP.MKTP.PP.CD", "NY.GDP.MKTP.PP.KD"],
  eurostat: [
    {
      indicator: "ESTAT,NAMA_10_GDP,1.0",
      dimensions: {
        na_item: ["B1GQ"],
        unit: ["CP_MEUR", "CLV10_MEUR", "CLV15_MEUR", "CLV20_MEUR", "CP_MPPS_EU27_2020"],
      },
    },
  ],
} as const

const gdpPerPerson = {
  worldBank: ["NY.GDP.PCAP.CD", "NY.GDP.PCAP.KD", "NY.GDP.PCAP.PP.CD", "NY.GDP.PCAP.PP.KD"],
  eurostat: [
    {
      indicator: "ESTAT,NAMA_10_PC,1.0",
      dimensions: {
        na_item: ["B1GQ"],
        unit: [
          "CP_EUR_HAB",
          "CLV10_EUR_HAB",
          "CLV15_EUR_HAB",
          "CLV20_EUR_HAB",
          "CP_PPS_EU27_2020_HAB",
        ],
      },
    },
  ],
  // In US dollars at current purchasing power parities.
  oecd: [
    {
      indicator: "OECD.SDD.NAD,DSD_NAMAIN10@DF_TABLE1_EXPENDITURE_HCPC,2.0",
      dimensions: { TRANSACTION: ["B1GQ_POP"] },
    },
  ],
} as const

const g7 = ["USA", "JPN", "DEU", "GBR", "FRA", "ITA", "CAN"] as const

const eu = [
  "AUT",
  "BEL",
  "BGR",
  "HRV",
  "CYP",
  "CZE",
  "DNK",
  "EST",
  "FIN",
  "FRA",
  "DEU",
  "GRC",
  "HUN",
  "IRL",
  "ITA",
  "LVA",
  "LTU",
  "LUX",
  "MLT",
  "NLD",
  "POL",
  "PRT",
  "ROU",
  "SVK",
  "SVN",
  "ESP",
  "SWE",
] as const

// Real GDP growth, the annual % change in volume.
const gdpGrowth = {
  worldBank: ["NY.GDP.MKTP.KD.ZG"],
  eurostat: [
    { indicator: "ESTAT,TEC00115,1.0", dimensions: { unit: ["CLV_PCH_PRE"] } },
    {
      indicator: "ESTAT,NAMA_10_GDP,1.0",
      dimensions: { na_item: ["B1GQ"], unit: ["CLV_PCH_PRE"] },
    },
  ],
} as const

// Current spending on health, as a share of GDP or per person.
const healthSpending = {
  worldBank: ["SH.XPD.CHEX.GD.ZS", "SH.XPD.CHEX.PC.CD", "SH.XPD.CHEX.PP.CD"],
  // Every scheme, function and provider.
  oecd: [
    {
      indicator: "OECD.ELS.HD,DSD_SHA@DF_SHA,1.1",
      dimensions: {
        UNIT_MEASURE: ["PT_B1GQ", "USD_PPP_PS"],
        FINANCING_SCHEME: ["_T"],
        FUNCTION: ["_T"],
        MODE_PROVISION: ["_T"],
        PROVIDER: ["_T"],
      },
    },
  ],
} as const

// The G7's health spending, for a ranking, a trend or a change.
const g7Health = {
  indicators: healthSpending.worldBank,
  series: healthSpending.oecd,
  countries: g7,
}

// Eurostat publishes these, with no World Bank counterpart, as a share of the
// whole population.
const povertyOrExclusion = [
  {
    indicator: "ESTAT,ILC_PEPS01N,1.0",
    dimensions: { unit: ["PC"], age: ["TOTAL"], sex: ["T"] },
  },
  { indicator: "ESTAT,ILC_PECS01,1.0", dimensions: { unit: ["PC"], age: ["TOTAL"] } },
  { indicator: "ESTAT,TIPSLC10,1.0", dimensions: { unit: ["PC"] } },
  { indicator: "ESTAT,SDG_01_10,1.0", dimensions: { unit: ["PC"], age: ["TOTAL"] } },
] as const

const housingCost = [
  { indicator: "ESTAT,TESPM140,1.0", dimensions: {} },
  {
    indicator: "ESTAT,ILC_LVHO07A,1.0",
    dimensions: { rskpovth: ["TOTAL"], age: ["TOTAL"], sex: ["T"] },
  },
  { indicator: "ESTAT,TESSI160,1.0", dimensions: { sex: ["T"] } },
  { indicator: "ESTAT,TESSI161,1.0", dimensions: { age: ["TOTAL"] } },
] as const

export const cases: ReadonlyArray<Case> = [
  // Change over time, values as published.
  {
    questions: ["How has life expectancy changed in Brazil?"],
    accepts: [Trend({ indicators: lifeExpectancy.worldBank, countries: ["BRA"] })],
  },
  {
    questions: ["Life expectancy in Japan and Nigeria since 2000"],
    accepts: [
      Trend({ indicators: lifeExpectancy.worldBank, countries: ["JPN", "NGA"], from: 2000 }),
    ],
  },
  {
    questions: ["Population of India from 1990 to 2020"],
    accepts: [
      Trend({ indicators: population.worldBank, countries: ["IND"], from: 1990, to: 2020 }),
    ],
  },
  {
    questions: ["How has unemployment evolved in Spain?"],
    accepts: [
      Trend({
        indicators: unemployment.worldBank,
        series: [...unemployment.eurostat, ...unemployment.oecd],
        countries: ["ESP"],
      }),
    ],
  },
  {
    questions: ["Youth unemployment in Italy and Greece over the last decade"],
    accepts: [
      Trend({
        indicators: youthUnemployment.worldBank,
        series: [...youthUnemployment.eurostat, ...youthUnemployment.oecd],
        countries: ["ITA", "GRC"],
      }),
    ],
  },
  {
    questions: ["How has inflation moved in Argentina and Turkey since 2015?"],
    accepts: [Trend({ indicators: inflation, countries: ["ARG", "TUR"], from: 2015 })],
  },
  {
    questions: ["Fertility rate in South Korea since 1960"],
    accepts: [Trend({ indicators: ["SP.DYN.TFRT.IN"], countries: ["KOR"], from: 1960 })],
  },
  {
    questions: ["Infant mortality in Ethiopia over time"],
    accepts: [Trend({ indicators: infantMortality, countries: ["ETH"] })],
  },
  {
    questions: ["How has access to electricity grown in Kenya and Tanzania?"],
    accepts: [Trend({ indicators: ["EG.ELC.ACCS.ZS"], countries: ["KEN", "TZA"] })],
  },
  {
    questions: ["Internet use in China, India and Indonesia since 2005"],
    accepts: [
      Trend({ indicators: ["IT.NET.USER.ZS"], countries: ["CHN", "IND", "IDN"], from: 2005 }),
    ],
  },
  {
    questions: ["How have CO2 emissions per person changed in the United States and China?"],
    accepts: [Trend({ indicators: ["EN.GHG.CO2.PC.CE.AR5"], countries: ["USA", "CHN"] })],
  },
  {
    questions: ["Military spending as a share of GDP in Russia and Ukraine since 2010"],
    accepts: [Trend({ indicators: ["MS.MIL.XPND.GD.ZS"], countries: ["RUS", "UKR"], from: 2010 })],
  },
  {
    questions: ["Central government debt in the United Kingdom over time"],
    accepts: [Trend({ indicators: ["GC.DOD.TOTL.GD.ZS"], countries: ["GBR"] })],
  },
  {
    questions: ["Forest cover in Brazil and Indonesia since 1990"],
    accepts: [
      Trend({
        indicators: ["AG.LND.FRST.ZS", "AG.LND.FRST.K2"],
        countries: ["BRA", "IDN"],
        from: 1990,
      }),
    ],
  },
  {
    questions: ["How has the share of renewable energy changed in Germany and France?"],
    accepts: [
      Trend({
        indicators: ["EG.FEC.RNEW.ZS", "EG.ELC.RNEW.ZS"],
        // In gross final energy consumption, overall or of electricity.
        series: [
          { indicator: "ESTAT,SDG_07_40,1.0", dimensions: { nrg_bal: ["REN", "REN_ELC"] } },
          { indicator: "ESTAT,NRG_IND_REN,1.0", dimensions: { nrg_bal: ["REN", "REN_ELC"] } },
        ],
        countries: ["DEU", "FRA"],
      }),
    ],
  },
  {
    questions: ["Urbanization in Nigeria over the past 30 years"],
    accepts: [Trend({ indicators: ["SP.URB.TOTL.IN.ZS"], countries: ["NGA"] })],
  },
  {
    questions: ["How has women's participation in the labor force changed in Saudi Arabia?"],
    accepts: [
      Trend({ indicators: ["SL.TLF.CACT.FE.ZS", "SL.TLF.CACT.FE.NE.ZS"], countries: ["SAU"] }),
    ],
  },
  {
    questions: ["How has the share of people aged 65 and over grown in Italy and Japan?"],
    accepts: [
      Trend({
        indicators: ["SP.POP.65UP.TO.ZS"],
        series: [
          {
            indicator: "OECD.ELS.SAE,DSD_POPULATION@DF_POP_HIST,1.0",
            dimensions: {
              MEASURE: ["POP"],
              UNIT_MEASURE: ["PT_POP"],
              SEX: ["_T"],
              AGE: ["Y_GE65"],
            },
          },
        ],
        countries: ["ITA", "JPN"],
      }),
    ],
  },
  {
    questions: ["GDP growth in China since 2000"],
    accepts: [
      Trend({ indicators: ["NY.GDP.MKTP.KD.ZG"], countries: ["CHN"], from: 2000 }),
      Trend({ indicators: gdp.worldBank, countries: ["CHN"], from: 2000, transform: "Growth" }),
    ],
  },
  {
    questions: ["How have remittances as a share of GDP changed in Nepal and Tajikistan?"],
    accepts: [Trend({ indicators: ["BX.TRF.PWKR.DT.GD.ZS"], countries: ["NPL", "TJK"] })],
  },

  // Countries compared at one point.
  {
    questions: ["Which has the highest life expectancy: France, Germany or Italy?"],
    accepts: [
      Ranking({
        indicators: lifeExpectancy.worldBank,
        series: lifeExpectancy.eurostat,
        countries: ["FRA", "DEU", "ITA"],
      }),
    ],
  },
  {
    questions: ["Compare GDP per capita of Germany, France and the United Kingdom in 2022"],
    accepts: [
      Ranking({
        indicators: gdpPerPerson.worldBank,
        series: gdpPerPerson.oecd,
        countries: ["DEU", "FRA", "GBR"],
        year: 2022,
      }),
      Ranking({
        indicators: gdp.worldBank,
        countries: ["DEU", "FRA", "GBR"],
        year: 2022,
        transform: "PerPerson",
      }),
    ],
  },
  {
    questions: ["Rank the G7 by population"],
    accepts: [
      Ranking({ indicators: population.worldBank, series: population.oecd, countries: g7 }),
    ],
  },
  {
    questions: ["Which Nordic country has the lowest unemployment?"],
    accepts: [
      Ranking({
        indicators: unemployment.worldBank,
        series: [...unemployment.eurostat, ...unemployment.oecd],
        countries: ["DNK", "FIN", "ISL", "NOR", "SWE"],
      }),
    ],
  },
  {
    questions: ["Compare inequality in Brazil, South Africa and Colombia"],
    accepts: [Ranking({ indicators: ["SI.POV.GINI"], countries: ["BRA", "ZAF", "COL"] })],
  },
  {
    questions: [
      "Health spending as a share of GDP in the United States, Canada and the United Kingdom in 2021",
    ],
    accepts: [
      Ranking({
        indicators: ["SH.XPD.CHEX.GD.ZS"],
        // Current expenditure on health, every scheme, function and provider.
        series: [
          {
            indicator: "OECD.ELS.HD,DSD_SHA@DF_SHA,1.1",
            dimensions: {
              UNIT_MEASURE: ["PT_B1GQ"],
              FINANCING_SCHEME: ["_T"],
              FUNCTION: ["_T"],
              MODE_PROVISION: ["_T"],
              PROVIDER: ["_T"],
            },
          },
        ],
        countries: ["USA", "CAN", "GBR"],
        year: 2021,
      }),
    ],
  },
  {
    questions: ["Which of Mexico, Colombia and Brazil has the highest homicide rate?"],
    accepts: [Ranking({ indicators: ["VC.IHR.PSRC.P5"], countries: ["MEX", "COL", "BRA"] })],
  },
  {
    questions: [
      "Compare the share of seats held by women in parliament in Rwanda, Sweden and Japan",
    ],
    accepts: [Ranking({ indicators: ["SG.GEN.PARL.ZS"], countries: ["RWA", "SWE", "JPN"] })],
  },
  {
    questions: ["Compare adult literacy in Mali, Niger and Chad"],
    accepts: [Ranking({ indicators: ["SE.ADT.LITR.ZS"], countries: ["MLI", "NER", "TCD"] })],
  },
  {
    questions: ["Which economy is bigger, India or the United Kingdom?"],
    accepts: [Ranking({ indicators: gdp.worldBank, countries: ["IND", "GBR"] })],
  },
  {
    questions: [
      "Compare exports as a share of GDP for Germany, China and the United States in 2019",
    ],
    accepts: [
      Ranking({ indicators: ["NE.EXP.GNFS.ZS"], countries: ["DEU", "CHN", "USA"], year: 2019 }),
    ],
  },
  {
    questions: [
      "Which spends most on education relative to its economy: Finland, Norway or Denmark?",
    ],
    accepts: [Ranking({ indicators: ["SE.XPD.TOTL.GD.ZS"], countries: ["FIN", "NOR", "DNK"] })],
  },
  {
    questions: [
      "Compare foreign direct investment inflows relative to GDP in Ireland, Singapore and Luxembourg",
    ],
    accepts: [Ranking({ indicators: ["BX.KLT.DINV.WD.GD.ZS"], countries: ["IRL", "SGP", "LUX"] })],
  },

  // Questions whose words do not name the chart type that answers them.
  {
    questions: [
      "Which grew fastest between 2000 and 2020: the population of Nigeria, Egypt or Ethiopia?",
    ],
    accepts: [
      Change({
        indicators: population.worldBank,
        countries: ["NGA", "EGY", "ETH"],
        from: 2000,
        to: 2020,
      }),
    ],
  },
  {
    questions: ["How do the 27 EU countries compare on life expectancy?"],
    accepts: [
      Ranking({
        indicators: lifeExpectancy.worldBank,
        series: lifeExpectancy.eurostat,
        countries: eu,
      }),
      Map({ indicators: lifeExpectancy.worldBank, series: lifeExpectancy.eurostat, countries: eu }),
    ],
  },
  {
    questions: ["Has India caught up with China on life expectancy?"],
    accepts: [Trend({ indicators: lifeExpectancy.worldBank, countries: ["IND", "CHN"] })],
  },
  // A trend of seven lines or the change of each answers it.
  {
    questions: ["How has life expectancy changed in the G7 since 2000?"],
    accepts: [
      Trend({ indicators: lifeExpectancy.worldBank, countries: g7, from: 2000 }),
      Change({ indicators: lifeExpectancy.worldBank, countries: g7, from: 2000 }),
    ],
  },
  {
    questions: ["Do people live longer in richer countries? Look at the G7."],
    accepts: [
      Relation({
        indicators: lifeExpectancy.worldBank,
        against: [
          ...gdpPerPerson.worldBank,
          ...gdpPerPerson.oecd.map(({ indicator }) => indicator),
        ],
        countries: g7,
      }),
      Relation({
        indicators: gdpPerPerson.worldBank,
        series: gdpPerPerson.oecd,
        against: lifeExpectancy.worldBank,
        countries: g7,
      }),
    ],
  },

  // Questions one chart cannot answer: measures with different units, and a
  // comparison at one point with a change over time. The charts may come in
  // either order when the question does not set one.
  {
    questions: ["How have GDP growth and unemployment moved in Spain since 2008?"],
    accepts: Arr.flatMap(
      [
        Trend({
          indicators: gdpGrowth.worldBank,
          series: gdpGrowth.eurostat,
          countries: ["ESP"],
          from: 2008,
        }),
        Trend({
          indicators: gdp.worldBank,
          series: gdp.eurostat,
          countries: ["ESP"],
          from: 2008,
          transform: "Growth",
        }),
      ],
      (growth) => {
        const jobless = Trend({
          indicators: unemployment.worldBank,
          series: [...unemployment.eurostat, ...unemployment.oecd],
          countries: ["ESP"],
          from: 2008,
        })

        return [Charts({ charts: [growth, jobless] }), Charts({ charts: [jobless, growth] })]
      },
    ),
  },
  // The change over time is a trend or a change.
  {
    questions: ["Which G7 country spends most on health, and how has that changed since 2000?"],
    accepts: [
      Charts({
        charts: [Ranking(g7Health), Trend({ ...g7Health, from: 2000 })],
      }),
      Charts({
        charts: [Ranking(g7Health), Change({ ...g7Health, from: 2000 })],
      }),
    ],
  },

  // Place names that are not a World Bank name, or name a group.
  {
    questions: ["Life expectancy in Ivory Coast since 1990"],
    accepts: [Trend({ indicators: lifeExpectancy.worldBank, countries: ["CIV"], from: 1990 })],
  },
  {
    questions: ["How has the population of Czechia and Slovakia changed?"],
    accepts: [
      Trend({
        indicators: population.worldBank,
        series: [...population.eurostat, ...population.oecd],
        countries: ["CZE", "SVK"],
      }),
    ],
  },
  {
    questions: ["How has the fertility rate changed in North and South Korea?"],
    accepts: [Trend({ indicators: ["SP.DYN.TFRT.IN"], countries: ["KOR", "PRK"] })],
  },
  {
    questions: ["How has unemployment changed in the Benelux countries?"],
    accepts: [
      Trend({
        indicators: unemployment.worldBank,
        series: [...unemployment.eurostat, ...unemployment.oecd],
        countries: ["BEL", "NLD", "LUX"],
      }),
    ],
  },
  {
    questions: ["GDP per capita of the Baltic states in 2020"],
    accepts: [
      Ranking({
        indicators: gdpPerPerson.worldBank,
        series: [...gdpPerPerson.eurostat, ...gdpPerPerson.oecd],
        countries: ["EST", "LVA", "LTU"],
        year: 2020,
      }),
      Ranking({
        indicators: gdp.worldBank,
        series: gdp.eurostat,
        countries: ["EST", "LVA", "LTU"],
        year: 2020,
        transform: "PerPerson",
      }),
    ],
  },
  {
    questions: ["Inflation in Russia and Iran since 2015"],
    accepts: [Trend({ indicators: inflation, countries: ["RUS", "IRN"], from: 2015 })],
  },
  {
    questions: ["How has infant mortality changed in DR Congo?"],
    accepts: [Trend({ indicators: infantMortality, countries: ["COD"] })],
  },

  // Transforms the World Bank does not publish as an indicator.
  {
    questions: ["How has net migration per person changed in Germany and Spain?"],
    accepts: [
      Trend({
        indicators: ["SM.POP.NETM"],
        series: [
          { indicator: "ESTAT,MIGR_NETMIGR,1.0", dimensions: { age: ["TOTAL"], sex: ["T"] } },
        ],
        countries: ["DEU", "ESP"],
        transform: "PerPerson",
      }),
      // Per 1,000 people already, with Eurostat's statistical adjustment.
      Trend({
        series: [{ indicator: "ESTAT,TPS00019,1.0", dimensions: { indic_de: ["CNMIGRATRT"] } }],
        countries: ["DEU", "ESP"],
      }),
    ],
  },
  {
    questions: ["Military spending per person in Israel and the United States since 2000"],
    accepts: [
      Trend({
        indicators: ["MS.MIL.XPND.CD"],
        countries: ["ISR", "USA"],
        from: 2000,
        transform: "PerPerson",
      }),
    ],
  },
  {
    questions: ["Index the population of Nigeria and Japan to 100 in 2000"],
    accepts: [
      Trend({
        indicators: population.worldBank,
        countries: ["NGA", "JPN"],
        from: 2000,
        transform: "Index",
      }),
    ],
  },
  {
    questions: [
      "Real GDP of China, India and the United States since 2000, indexed to 100 in the first year",
    ],
    accepts: [
      Trend({
        indicators: ["NY.GDP.MKTP.KD", "NY.GDP.MKTP.PP.KD"],
        countries: ["CHN", "IND", "USA"],
        from: 2000,
        transform: "Index",
      }),
    ],
  },

  // Follow-ups that change the last chart.
  {
    questions: ["Life expectancy in Brazil since 2000", "Add Mexico"],
    accepts: [
      Trend({ indicators: lifeExpectancy.worldBank, countries: ["BRA", "MEX"], from: 2000 }),
    ],
  },
  {
    questions: ["Inflation in Brazil and Argentina since 2010", "Remove Argentina"],
    accepts: [Trend({ indicators: inflation, countries: ["BRA"], from: 2010 })],
  },
  {
    questions: ["Life expectancy in Kenya since 1990", "Show infant mortality instead"],
    accepts: [Trend({ indicators: infantMortality, countries: ["KEN"], from: 1990 })],
  },
  {
    questions: ["GDP of Germany, France and Italy in 2020", "Now per person"],
    accepts: [
      Ranking({
        indicators: gdp.worldBank,
        series: gdp.eurostat,
        countries: ["DEU", "FRA", "ITA"],
        year: 2020,
        transform: "PerPerson",
      }),
      Ranking({
        indicators: gdpPerPerson.worldBank,
        series: [...gdpPerPerson.eurostat, ...gdpPerPerson.oecd],
        countries: ["DEU", "FRA", "ITA"],
        year: 2020,
      }),
    ],
  },
  {
    questions: ["Unemployment in Spain and Portugal since 2008", "Compare them in 2020 only"],
    accepts: [
      Ranking({
        indicators: unemployment.worldBank,
        series: [...unemployment.eurostat, ...unemployment.oecd],
        countries: ["ESP", "PRT"],
        year: 2020,
      }),
    ],
  },

  // A follow-up after the person changed the chart builds on their chart.
  {
    questions: ["Life expectancy in Brazil and Argentina since 2000", "Add Peru"],
    shown: TrendView.make({
      indicator: IndicatorId.make(infantMortality[0]),
      countries: ["BRA", "ARG"],
      from: Year.make(2000),
      to: Year.make(2023),
    }),
    accepts: [
      Trend({
        indicators: infantMortality,
        countries: ["BRA", "ARG", "PER"],
        from: 2000,
        to: 2023,
      }),
    ],
  },

  // Measures only Eurostat publishes.
  {
    questions: [
      "Share of people at risk of poverty or social exclusion in Spain and Italy since 2015",
    ],
    accepts: [Trend({ series: povertyOrExclusion, countries: ["ESP", "ITA"], from: 2015 })],
  },
  {
    questions: ["How has the housing cost overburden rate changed in Greece and Germany?"],
    accepts: [Trend({ series: housingCost, countries: ["GRC", "DEU"] })],
  },
  {
    questions: ["Early leavers from education and training in Spain, Italy and Romania since 2010"],
    accepts: [
      Trend({
        series: [
          { indicator: "ESTAT,EDAT_LFSE_14,1.0", dimensions: { sex: ["T"], wstatus: ["POP"] } },
          { indicator: "ESTAT,SDG_04_10,1.0", dimensions: { sex: ["T"] } },
          { indicator: "ESTAT,TESEM020,1.0", dimensions: {} },
        ],
        countries: ["ESP", "ITA", "ROU"],
        from: 2010,
      }),
    ],
  },

  // Measures only the OECD publishes.
  {
    questions: [
      "Compare average annual hours actually worked per worker in Germany, South Korea and Mexico in 2022",
    ],
    accepts: [
      Ranking({
        // Every worker, not only employees.
        series: [
          {
            indicator: "OECD.ELS.SAE,DSD_HW@DF_AVG_ANN_HRS_WKD,1.0",
            dimensions: { WORKER_STATUS: ["_T"] },
          },
        ],
        countries: ["DEU", "KOR", "MEX"],
        year: 2022,
      }),
    ],
  },
  {
    questions: ["How has trade union density changed in Sweden and the United States?"],
    accepts: [
      Trend({
        series: [{ indicator: "OECD.ELS.SAE,DSD_TUD_CBC@DF_TUD,1.0", dimensions: {} }],
        countries: ["SWE", "USA"],
      }),
    ],
  },

  // Worldwide comparisons, where the World Bank still answers.
  {
    questions: ["Compare GDP per capita of Germany, Brazil and Nigeria in 2022"],
    accepts: [
      Ranking({ indicators: gdpPerPerson.worldBank, countries: ["DEU", "BRA", "NGA"], year: 2022 }),
      Ranking({
        indicators: gdp.worldBank,
        countries: ["DEU", "BRA", "NGA"],
        year: 2022,
        transform: "PerPerson",
      }),
    ],
  },
  {
    questions: ["How has unemployment changed in France, India and South Africa since 2010?"],
    accepts: [
      Trend({ indicators: unemployment.worldBank, countries: ["FRA", "IND", "ZAF"], from: 2010 }),
    ],
  },

  // Questions that name no country, so the agent should ask which.
  {
    questions: ["Show me GDP"],
    accepts: [Asked()],
  },
  {
    questions: ["How long do people live?"],
    accepts: [Asked()],
  },

  // Questions no source answers.
  {
    questions: ["What is the meaning of life?"],
    accepts: [Unanswered()],
  },
  {
    questions: ["Who won the 2018 football World Cup?"],
    accepts: [Unanswered()],
  },
  {
    questions: ["What will the weather be in Paris tomorrow?"],
    accepts: [Unanswered()],
  },
  {
    questions: ["Apple's share price over the last five years"],
    accepts: [Unanswered()],
  },

  // The Worldwide Governance Indicators, which the World Development
  // Indicators republish: a dimension's estimate or its 0 to 100 score.
  {
    questions: ["How has control of corruption changed in Hungary since 2010?"],
    accepts: [
      Trend({ indicators: ["GOV_WGI_CC_EST", "GOV_WGI_CC_SC"], countries: ["HUN"], from: 2010 }),
    ],
  },
  {
    questions: ["Rank the EU on rule of law"],
    accepts: [
      Ranking({ indicators: ["GOV_WGI_RL_EST", "GOV_WGI_RL_SC"], countries: eu }),
      Map({ indicators: ["GOV_WGI_RL_EST", "GOV_WGI_RL_SC"], countries: eu }),
    ],
  },

  // Political context, which the agent draws only when the question asks
  // for it.
  {
    questions: ["Unemployment in France under each president"],
    accepts: [
      Trend({
        indicators: unemployment.worldBank,
        series: [...unemployment.eurostat, ...unemployment.oecd],
        countries: ["FRA"],
        overlays: ["governments"],
      }),
    ],
  },
  {
    questions: ["GDP of Japan since 2000"],
    accepts: [
      Trend({
        indicators: gdp.worldBank,
        // Japan is an OECD member outside the EU, so its national accounts
        // come from the OECD.
        series: [
          {
            indicator: "OECD.SDD.NAD,DSD_NAMAIN10@DF_TABLE1_EXPENDITURE,2.0",
            dimensions: { TRANSACTION: ["B1GQ"] },
          },
        ],
        countries: ["JPN"],
        from: 2000,
        overlays: [],
      }),
    ],
  },
  {
    questions: ["How did Greece's debt move around the 2010 bailout?"],
    accepts: [
      Trend({
        indicators: ["GC.DOD.TOTL.GD.ZS"],
        // Government debt as a share of GDP. Greece is in the EU, so Eurostat
        // answers first. Not yet scored by a run: the series were picked
        // from Eurostat's catalogue, not from an answer.
        series: [
          {
            indicator: "ESTAT,GOV_10DD_EDPT1,1.0",
            dimensions: { na_item: ["GD"], unit: ["PC_GDP"] },
          },
          { indicator: "ESTAT,SDG_17_40,1.0", dimensions: { unit: ["PC_GDP"] } },
        ],
        countries: ["GRC"],
        overlays: ["events"],
        // The answer cites the assistance programmes.
        cites: ["event:greece-assistance"],
      }),
    ],
  },

  // Why a figure moved, which the agent answers only by citing a research
  // finding from find_research, and with none states no cause.
  {
    questions: ["Why did Ireland's GDP jump in 2015?"],
    accepts: [
      Trend({
        indicators: [...gdp.worldBank, ...gdpGrowth.worldBank, ...gdpPerPerson.worldBank],
        series: [...gdp.eurostat, ...gdpGrowth.eurostat, ...gdpPerPerson.eurostat],
        countries: ["IRL"],
        // An agreed finding.
        cites: ["finding:ireland-gdp-2015"],
      }),
      Change({
        indicators: [...gdp.worldBank, ...gdpPerPerson.worldBank],
        series: [...gdp.eurostat, ...gdpPerPerson.eurostat],
        countries: ["IRL"],
        cites: ["finding:ireland-gdp-2015"],
      }),
    ],
  },
  {
    questions: ["Why did unemployment fall in Germany after 2005?"],
    accepts: [
      Trend({
        indicators: unemployment.worldBank,
        series: [...unemployment.eurostat, ...unemployment.oecd],
        countries: ["DEU"],
        // A disputed finding, which the answer gives with both sides.
        cites: ["finding:hartz-reforms"],
      }),
    ],
  },
  {
    questions: ["Why has life expectancy risen in Japan?"],
    accepts: [
      Trend({
        indicators: lifeExpectancy.worldBank,
        countries: ["JPN"],
        // No finding covers it: the answer states no cause and cites none.
        cites: [],
      }),
    ],
  },
  // Questions about how a figure is measured. The agent reads the source's
  // notes with describe_indicator and names a break in series the chart
  // crosses; the score checks the chart only, not those words.
  {
    // Eurostat flags Germany's 2020 activity rate with "b", the year Germany
    // moved its labour force survey into a new system of household surveys.
    questions: ["How has labour force participation changed in Germany since 2015?"],
    accepts: [
      Trend({
        series: [
          {
            indicator: "ESTAT,LFSI_EMP_A,1.0",
            dimensions: { indic_em: ["ACT"], sex: ["T"], age: ["Y15-64", "Y15-74"] },
          },
        ],
        countries: ["DEU"],
        from: 2015,
      }),
    ],
  },
  {
    // Eurostat and the OECD both publish France's unemployment rate; their
    // notes say how each counts it. A chart of either, or words alone, fits.
    questions: ["Why does Eurostat's unemployment rate for France differ from the OECD's?"],
    accepts: [
      Trend({
        series: [...unemployment.eurostat, ...unemployment.oecd],
        countries: ["FRA"],
      }),
      Unanswered(),
    ],
  },
]

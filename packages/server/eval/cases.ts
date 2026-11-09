import type { Array as Arr } from "effect"

import { Expected } from "./score.ts"

// Questions asked in one conversation, in order, and the answers to the last
// one that count as right.
interface Case {
  readonly questions: Arr.NonEmptyReadonlyArray<string>
  readonly accepts: Arr.NonEmptyReadonlyArray<Expected>
}

const { Trend, Ranking, Asked, Unanswered } = Expected

// Close indicators that answer the same question equally well.
const lifeExpectancy = ["SP.DYN.LE00.IN"] as const
const population = ["SP.POP.TOTL"] as const
const unemployment = ["SL.UEM.TOTL.ZS", "SL.UEM.TOTL.NE.ZS"] as const
const inflation = ["FP.CPI.TOTL.ZG"] as const
const infantMortality = ["SP.DYN.IMRT.IN"] as const

// In current or constant dollars, at market rates or PPP.
const gdp = ["NY.GDP.MKTP.CD", "NY.GDP.MKTP.KD", "NY.GDP.MKTP.PP.CD", "NY.GDP.MKTP.PP.KD"] as const

const gdpPerPerson = [
  "NY.GDP.PCAP.CD",
  "NY.GDP.PCAP.KD",
  "NY.GDP.PCAP.PP.CD",
  "NY.GDP.PCAP.PP.KD",
] as const

const g7 = ["USA", "JPN", "DEU", "GBR", "FRA", "ITA", "CAN"] as const

export const cases: ReadonlyArray<Case> = [
  // Change over time, values as published.
  {
    questions: ["How has life expectancy changed in Brazil?"],
    accepts: [Trend({ indicators: lifeExpectancy, countries: ["BRA"] })],
  },
  {
    questions: ["Life expectancy in Japan and Nigeria since 2000"],
    accepts: [Trend({ indicators: lifeExpectancy, countries: ["JPN", "NGA"], from: 2000 })],
  },
  {
    questions: ["Population of India from 1990 to 2020"],
    accepts: [Trend({ indicators: population, countries: ["IND"], from: 1990, to: 2020 })],
  },
  {
    questions: ["How has unemployment evolved in Spain?"],
    accepts: [Trend({ indicators: unemployment, countries: ["ESP"] })],
  },
  {
    questions: ["Youth unemployment in Italy and Greece over the last decade"],
    accepts: [
      Trend({ indicators: ["SL.UEM.1524.ZS", "SL.UEM.1524.NE.ZS"], countries: ["ITA", "GRC"] }),
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
      Trend({ indicators: ["EG.FEC.RNEW.ZS", "EG.ELC.RNEW.ZS"], countries: ["DEU", "FRA"] }),
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
    accepts: [Trend({ indicators: ["SP.POP.65UP.TO.ZS"], countries: ["ITA", "JPN"] })],
  },
  {
    questions: ["GDP growth in China since 2000"],
    accepts: [
      Trend({ indicators: ["NY.GDP.MKTP.KD.ZG"], countries: ["CHN"], from: 2000 }),
      Trend({ indicators: gdp, countries: ["CHN"], from: 2000, transform: "Growth" }),
    ],
  },
  {
    questions: ["How have remittances as a share of GDP changed in Nepal and Tajikistan?"],
    accepts: [Trend({ indicators: ["BX.TRF.PWKR.DT.GD.ZS"], countries: ["NPL", "TJK"] })],
  },

  // Countries compared at one point.
  {
    questions: ["Which has the highest life expectancy: France, Germany or Italy?"],
    accepts: [Ranking({ indicators: lifeExpectancy, countries: ["FRA", "DEU", "ITA"] })],
  },
  {
    questions: ["Compare GDP per capita of Germany, France and the United Kingdom in 2022"],
    accepts: [
      Ranking({ indicators: gdpPerPerson, countries: ["DEU", "FRA", "GBR"], year: 2022 }),
      Ranking({
        indicators: gdp,
        countries: ["DEU", "FRA", "GBR"],
        year: 2022,
        transform: "PerPerson",
      }),
    ],
  },
  {
    questions: ["Rank the G7 by population"],
    accepts: [Ranking({ indicators: population, countries: g7 })],
  },
  {
    questions: ["Which Nordic country has the lowest unemployment?"],
    accepts: [
      Ranking({ indicators: unemployment, countries: ["DNK", "FIN", "ISL", "NOR", "SWE"] }),
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
    accepts: [Ranking({ indicators: gdp, countries: ["IND", "GBR"] })],
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

  // Place names that are not a World Bank name, or name a group.
  {
    questions: ["Life expectancy in Ivory Coast since 1990"],
    accepts: [Trend({ indicators: lifeExpectancy, countries: ["CIV"], from: 1990 })],
  },
  {
    questions: ["How has the population of Czechia and Slovakia changed?"],
    accepts: [Trend({ indicators: population, countries: ["CZE", "SVK"] })],
  },
  {
    questions: ["How has the fertility rate changed in North and South Korea?"],
    accepts: [Trend({ indicators: ["SP.DYN.TFRT.IN"], countries: ["KOR", "PRK"] })],
  },
  {
    questions: ["How has unemployment changed in the Benelux countries?"],
    accepts: [Trend({ indicators: unemployment, countries: ["BEL", "NLD", "LUX"] })],
  },
  {
    questions: ["GDP per capita of the Baltic states in 2020"],
    accepts: [
      Ranking({ indicators: gdpPerPerson, countries: ["EST", "LVA", "LTU"], year: 2020 }),
      Ranking({
        indicators: gdp,
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
      Trend({ indicators: ["SM.POP.NETM"], countries: ["DEU", "ESP"], transform: "PerPerson" }),
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
      Trend({ indicators: population, countries: ["NGA", "JPN"], from: 2000, transform: "Index" }),
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
    accepts: [Trend({ indicators: lifeExpectancy, countries: ["BRA", "MEX"], from: 2000 })],
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
        indicators: gdp,
        countries: ["DEU", "FRA", "ITA"],
        year: 2020,
        transform: "PerPerson",
      }),
      Ranking({ indicators: gdpPerPerson, countries: ["DEU", "FRA", "ITA"], year: 2020 }),
    ],
  },
  {
    questions: ["Unemployment in Spain and Portugal since 2008", "Compare them in 2020 only"],
    accepts: [Ranking({ indicators: unemployment, countries: ["ESP", "PRT"], year: 2020 })],
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

  // Questions no World Bank indicator answers.
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
]

import { ChartIndex, Ended, Ending, TurnIndex, View, Vote } from "@repo/domain"
import { Array as Arr, Predicate, Schema } from "effect"

import { Logged } from "./candidates.ts"

// Who a set of probes is written as: someone who knows the sources, or
// someone asking about their own life, vaguely, sometimes from a wrong
// premise.
const Voice = Schema.Literals(["informed", "everyday"])

type Voice = typeof Voice.Type

// A question, or questions asked in turn in one conversation, with no
// accepted chart: a reviewer reads the answer (eval/probes.md). `note` says
// what the probe tests when the question alone does not show it.
export const Probe = Schema.Struct({
  id: Schema.String,
  voice: Voice,
  group: Schema.String,
  questions: Schema.NonEmptyArray(Schema.String),
  note: Schema.NullOr(Schema.String),
})

export interface Probe extends Schema.Schema.Type<typeof Probe> {}

// A row of the answer log with its JSON columns as plain JSON, for a
// reviewer to read and vote on. It decodes to the same row as Logged.
const Row = Schema.Struct({
  ...Logged.fields,
  questions: Schema.Array(Schema.String),
  changed: Schema.Array(Schema.Struct({ turn: TurnIndex, chart: ChartIndex, view: View })),
  ending: Ending,
  steps: Schema.Array(Ended),
  vote: Schema.NullOr(Vote),
})

// What a probe run writes for each probe: the probe, then one row per turn
// as the answer log keeps it, so triage reads it as it reads production.
// When the answer failed, `failure` says why, and there are no rows.
export const Probed = Schema.Struct({
  probe: Probe,
  rows: Schema.Array(Row),
  failure: Schema.NullOr(Schema.String),
})

export const ProbedJson = Schema.fromJsonString(Schema.toCodecJson(Probed))

export const isProbeFile = (name: string) => /^(?:informed|everyday)-\d{3}\.json$/.test(name)

type Entry = readonly [ask: string | Arr.NonEmptyReadonlyArray<string>, note?: string]

// Ids number probes in order within their voice, so adding or removing a
// probe renames those after it: compare runs by question, not by id.
const listed = (voice: Voice, groups: Readonly<Record<string, ReadonlyArray<Entry>>>) =>
  Object.entries(groups)
    .flatMap(([group, entries]) => entries.map(([ask, note]) => ({ group, ask, note })))
    .map(({ group, ask, note }, index): Probe => ({
      id: `${voice}-${String(index + 1).padStart(3, "0")}`,
      voice,
      group,
      questions: Predicate.isString(ask) ? [ask] : ask,
      note: note ?? null,
    }))

const informed = listed("informed", {
  "Single-country trends, outside the EU and G7": [
    [
      "How has the share of people living below $2.15 a day changed in Bangladesh since 1990?",
      "The World Bank moved its poverty line to $3.00 in 2025, so this checks whether it handles an outdated threshold.",
    ],
    [
      "How has Vietnam's GDP per person grown since the Doi Moi reforms?",
      "It has to work out that the reforms started in 1986.",
    ],
    ["How has maternal mortality fallen in Rwanda?"],
    ["How has child stunting changed in Guatemala?", "Survey data with few years."],
    ["How has forest cover changed in Indonesia since 1990?"],
    ["How much of Mongolia's electricity comes from coal?"],
    ["How has internet use spread in Ethiopia?"],
    ["How has military spending as a share of GDP changed in Russia and Ukraine since 2014?"],
    ["How has inflation in Lebanon moved since 2019?"],
    ["How has youth unemployment changed in Morocco and Tunisia?"],
    ["What happened to Venezuela's GDP after 2013?", "The series stops early."],
    ["How has the teenage birth rate changed in Niger?"],
    ["How has tuberculosis incidence changed in the Philippines?"],
    ["How has foreign direct investment into Kazakhstan moved?"],
    ["How dependent is Kuwait on oil rents?"],
    ["How has the Gini index moved in Brazil and South Africa?", "Few data points, with gaps."],
    ["How has the share of China's population living in cities grown?"],
    ["How has access to safe drinking water changed in Papua New Guinea?"],
    [
      "Is Egypt's economy doing better than ten years ago?",
      "Vague: the assistant has to pick an indicator itself.",
    ],
  ],
  "Rankings and maps across regions": [
    ["Which Latin American country has the highest income inequality?"],
    ["Rank Southeast Asian countries by GDP per person in 2023."],
    ["Which African country has the highest share of women in parliament?"],
    ["Where in the world is the fertility rate lowest?"],
    ["Show me a map of mobile subscriptions per 100 people across Africa."],
    ["Which Gulf state spends the most on its military relative to GDP?"],
    ["Which Central Asian country has the highest life expectancy?"],
    [
      "What are the top 10 countries by total CO2 emissions?",
      'Aggregates like "World" or "High income" can leak into the ranking.',
    ],
    ["Which Pacific island state gets the most aid per person?"],
    ["Which Balkan country has the lowest unemployment?"],
    ["Compare tax revenue as a share of GDP across South America."],
    ["Which countries host the most refugees?"],
  ],
  "Change between two years": [
    ["Which countries cut extreme poverty the most between 2000 and 2019?"],
    [
      "How much did tourism receipts fall in Thailand, the Maldives and Fiji between 2019 and 2020?",
    ],
    ["Which Eastern European countries lost the most population since 1991?"],
    [
      "How did life expectancy change in Eswatini and Lesotho between 1990 and 2022?",
      "It falls and then recovers, which a two-year comparison hides.",
    ],
  ],
  "One indicator against another": [
    ["In Africa, do countries where more girls go to school have lower fertility?"],
    ["Across Asia, how does GDP per person relate to CO2 per person?"],
    ["Do richer countries have less corruption?", "Governance score against income."],
    ["How do health spending and life expectancy relate in Latin America?"],
    [
      "Plot government debt against interest payments for emerging markets.",
      "Which countries count as emerging markets is not defined.",
    ],
  ],
  Transforms: [
    ["Show Nigeria's GDP per person instead of the total."],
    ["Index the GDP of India, Indonesia and Bangladesh to 100 in 2000."],
    ["What is the yearly growth rate of Ethiopia's population?"],
    ["Show China's exports as a ratio of its imports."],
  ],
  "Eurostat, with its dimensions": [
    ["How has youth unemployment among women in Italy changed compared with men?"],
    ["What share of people in Romania and Bulgaria are at risk of poverty or social exclusion?"],
    ["How has the rate of early school leavers changed in Malta and Spain?"],
    ["How has the gender pay gap changed in Estonia?"],
    ["How has overcrowding in homes changed in Poland?"],
    ["Which EU regions have the highest unemployment?", "Asks for regional data within countries."],
    ["How have house prices changed in the Netherlands and Portugal since 2015?"],
    ["How many asylum applications did Austria and Sweden receive each year since 2014?"],
    ["What has monthly inflation been in Croatia since it joined the euro?", "Monthly data."],
    ["How has the employment rate of people aged 55 to 64 changed in Bulgaria and Lithuania?"],
  ],
  OECD: [
    ["How do yearly hours worked compare in South Korea, Mexico and Germany?"],
    ["How has the tax wedge on labour changed in Chile and Colombia?"],
    ["How have PISA maths scores changed in Türkiye and Israel?", "Possibly not available."],
    ["How has public social spending changed in Costa Rica since it joined the OECD?"],
    ["Compare long-term interest rates in Japan, Australia and New Zealand."],
    ["How have real average wages changed in Mexico and Chile?"],
    ["How do house prices compare with incomes in Canada and New Zealand?"],
    ["How do pension replacement rates compare across OECD countries?"],
  ],
  "Governance indicators": [
    ["How has rule of law changed in Venezuela, Nicaragua and El Salvador?"],
    ["How has political stability changed in Mali and Burkina Faso since 2010?"],
    ["How does Botswana compare with its neighbours on government effectiveness?"],
    ["Which country has improved most on voice and accountability since 2000?"],
  ],
  "Elections, governments and events, inside and outside coverage": [
    ["How has unemployment in Poland moved under each government since 2005?"],
    [
      "How did Greek debt move after each election since 2009?",
      "The answer must not claim that an election caused a change.",
    ],
    ["Show Italy's public debt with its governments since 1995."],
    [
      "How did inflation in Brazil move under each president?",
      "Brazil is outside the EU and OECD records.",
    ],
    ["How has Hungary's corruption score moved under Orbán?", "Names a leader, not a government."],
    ["How has GDP growth in Chile moved around its elections?"],
    ["What pension reforms has France made, and how has employment of older workers moved?"],
    ["Did unemployment in the UK change after Brexit?", "Invites a causal claim."],
  ],
  "Causes, with and without a research finding": [
    ["Why did unemployment in Spain stay so high after 2008?", "A finding exists."],
    ["Why did unemployment in Finland jump in the early 1990s?", "A finding exists."],
    [
      "Why did inflation surge in Poland in 2022?",
      "The pandemic-inflation finding covers 11 economies; does the assistant stretch it to Poland?",
    ],
    ["Why did Sri Lanka's economy collapse in 2022?", "No finding."],
    ["Why has Bangladesh's fertility rate fallen so fast?", "No finding."],
    ["Did Germany's minimum wage cost jobs?", "A finding exists."],
    [
      "Why did inflation in Zimbabwe explode in 2008?",
      "No finding, and the data is likely missing.",
    ],
    ["Did COVID lockdowns cause Sweden's drop in GDP?", "A finding exists."],
  ],
  "Measurement, breaks and sources that disagree": [
    ["Why did India's GDP growth figures change after 2015?", "India changed its base year."],
    ["How does the World Bank measure the poverty line?"],
    ["Why do Eurostat and the World Bank give different unemployment rates for Italy?"],
    ["Why does Nigeria's GDP jump in 2013?", "Nigeria rebased its GDP."],
    ["Can Argentina's inflation figures for 2007 to 2015 be trusted?"],
  ],
  "Names, coverage limits and edge cases": [
    ["How has GDP changed in Congo?", "Two countries share the name."],
    ["How has life expectancy changed in Georgia?", "Country or US state."],
    ["Compare Taiwan and South Korea on GDP per person.", "The World Bank has no Taiwan."],
    ["How has unemployment changed in Kosovo?"],
    ["How has the population of Palestine changed?", "The World Bank calls it West Bank and Gaza."],
    ["How did the Soviet Union's economy evolve in the 1980s?", "The country no longer exists."],
    ["What is the unemployment rate in California compared with Texas?", "States, not countries."],
    [
      "How has Sub-Saharan Africa's economy grown compared with South Asia's?",
      "Regional aggregates.",
    ],
    ["¿Cómo ha cambiado la inflación en México desde 2000?", "Asked in Spanish."],
    ["whats the unemplyment in columbia", "Typos, plus Columbia for Colombia."],
    ["What will Kenya's GDP be in 2030?", "Asks for a forecast."],
    [
      "What was the inflation rate in Turkey last month?",
      "Asks for the latest data at a short frequency.",
    ],
  ],
  "A chain of follow-ups": [
    [
      [
        "How has GDP per person changed in Ghana?",
        "add Côte d'Ivoire and Senegal",
        "now as an index to 2000",
        "show this as a map of West Africa",
      ],
      "Each follow-up has to keep the earlier changes.",
    ],
  ],
})

const everyday = listed("everyday", {
  "Prices and the cost of living": [
    ["why is everything so expensive now", "No country, no indicator, a causal question."],
    ["are groceries more expensive here than in other countries", '"Here" is unknown.'],
    ["is rent going up everywhere or just where i live"],
    ["why are eggs so expensive", "One product; no source has it."],
    ["how much has the price of bread gone up since my parents were young"],
    ["is inflation over yet", "Mixes up prices falling with inflation falling."],
    ["why does gas cost more in europe than in america"],
    ["will prices ever go back down", "Asks for a forecast."],
    ["are wages keeping up with prices"],
    ["is it true a dollar today is worth like half what it was in 2000"],
  ],
  "Work and jobs": [
    ["is it harder to find a job now than 20 years ago"],
    ["is AI taking everyone's jobs", "No data on AI."],
    ["are immigrants taking jobs from people born here", "Loaded premise, and a causal claim."],
    ["do people in france really only work 35 hours"],
    ["which country has the best jobs for young people", '"Best" has no indicator.'],
    ["why do japanese people work so much", "The premise may not match the hours data."],
    [
      "is unemployment really low or are they hiding the real numbers",
      "Distrust of the source; the notes on how it is measured help.",
    ],
    ["are more people working from home now"],
    [
      "do women get paid less than men for the same job",
      'The pay gap indicator does not measure "the same job".',
    ],
    ["is the minimum wage good or bad", "A finding exists for the US and Germany only."],
  ],
  "The economy at large": [
    ["is the economy good right now"],
    ["are we in a recession", "No country; needs quarterly data."],
    ["is the US going bankrupt because of the debt"],
    ["who does america owe all that money to", "No source here holds who owns the debt."],
    ["why can't the government just print more money"],
    ["is china richer than america now", "Total GDP or per person, market rates or PPP."],
    ["is china going to take over the world economy"],
    [
      "what is the richest country in the world",
      "Total or per person; small states top the per-person ranking.",
    ],
    ["why is africa poor", "A continent treated as one country."],
    ["is the dollar about to collapse"],
    ["does bitcoin count in gdp"],
    ["what even is gdp and why should i care", "Wants an explanation, maybe no chart."],
    ["are the rich getting richer and the poor getting poorer"],
    ["which country has the most billionaires", "No source has it."],
  ],
  "Where to live": [
    ["what is the best country to live in"],
    ["where is the cheapest country to retire"],
    ["should i move to canada", "Personal advice."],
    ["is portugal still cheap"],
    ["which country has the happiest people", "No happiness data."],
    ["where in europe can i live on 2000 euros a month"],
    ["is dubai safe", "The United Arab Emirates, named by its city."],
    ["which country has the best healthcare"],
    ["is healthcare free in england", "England, not the United Kingdom."],
    ["which countries have the best schools for my kids"],
  ],
  "Health and family": [
    ["why do americans die younger than europeans"],
    ["are people getting fatter everywhere"],
    ["is covid still killing people"],
    [
      "is it true the japanese live longest because of what they eat",
      "A causal claim with no finding.",
    ],
    ["are fewer babies being born, and is that bad"],
    ["why don't young people have kids anymore"],
    ["are fewer people smoking"],
    ["do vaccines actually save children's lives", "A causal claim with no finding."],
    ["how many people die from guns in america compared to other countries"],
    ["are more people killing themselves than before"],
  ],
  "Politics and leaders": [
    [
      "did trump or biden do better for the economy",
      "Party politics; government bands exist for the US.",
    ],
    ["is macron a good president", "A judgement no chart makes."],
    ["did brexit ruin britain"],
    ["has putin made russia richer", "Russia is outside the political records."],
    [
      "which countries are dictatorships",
      "The governance indicators are perceptions, not a regime type.",
    ],
    ["are left-wing governments worse for the economy", "Invites reading party into a chart."],
    ["did taxes go up under labour", "Labour without a country."],
    ["what happened to greece, did it go bankrupt"],
    ["does voting change anything"],
    [
      "who won the last election in germany and what changed",
      "No winner may be read from the records.",
    ],
    ["is democracy dying around the world"],
    ["is milei fixing argentina", "A current leader outside the political records."],
  ],
  "War and world affairs": [
    ["how much has the war cost ukraine"],
    ["is russia's economy collapsing because of the sanctions"],
    ["how much money has the US given ukraine", "No source here holds aid by donor."],
    ["how many people became refugees because of the war in syria"],
    [
      "has gaza's economy been destroyed",
      "West Bank and Gaza are one entity in the World Bank data.",
    ],
    ["are there more wars in the world than before"],
    ["who spends the most on their army"],
    ["is there going to be a war with china", "Out of scope."],
  ],
  "Climate and energy": [
    ["is climate change real", "No temperature data; the assistant should not argue the science."],
    ["which country pollutes the most", "Total, per person or by type of pollution."],
    ["is china the worst polluter"],
    ["are electric cars actually making a difference"],
    [
      "why is my electricity bill so high",
      "No country; no household price data at the World Bank.",
    ],
    ["does nuclear power make electricity cheaper"],
    ["are we running out of oil"],
    ["was it a mistake for germany to shut its nuclear plants"],
  ],
  "Migration and population": [
    ["how many immigrants are coming to my country", '"My country" is unknown.'],
    ["is europe being overrun by migrants", "Loaded premise."],
    ["why do so many people leave africa"],
    ["is the world overpopulated"],
    ["which country has more people now, india or china"],
    ["is italy really shrinking"],
  ],
  "Housing and young people": [
    ["will i ever be able to afford a house"],
    ["why are houses so expensive in canada"],
    [
      "are young people living with their parents longer than before",
      "Eurostat has it for Europe only.",
    ],
    ["is college still worth it"],
  ],
  "Taxes and government": [
    ["which country has the lowest taxes"],
    ["where does my tax money go"],
    ["do scandinavians really pay 50% tax", "Income tax rate or tax revenue as a share of GDP."],
    ["is welfare making people lazy", "Loaded premise, and a causal claim."],
    ["why are some countries so corrupt"],
  ],
  "Loose names": [
    ["how is holland doing", 'The Netherlands, and "doing" has no indicator.'],
    [
      "how is the economy in africa",
      "A continent, which the regional aggregates only partly cover.",
    ],
    ["is the third world getting better", "An outdated grouping with no matching aggregate."],
  ],
})

export const probes: ReadonlyArray<Probe> = [...informed, ...everyday]

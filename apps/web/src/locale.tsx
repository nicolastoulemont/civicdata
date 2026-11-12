import { Locale } from "@openfacts/domain"
import { Schema } from "effect"
import { createInstance, type i18n } from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { type ReactNode, useEffect } from "react"
import { I18nextProvider } from "react-i18next"

import { backend, english } from "./messages.ts"

export const fallback: Locale = "en-US"

export const languages: Record<Locale, string> = {
  "en-US": "🇺🇸\u2002English (United States)",
  "fr-FR": "🇫🇷\u2002Français",
  "es-ES": "🇪🇸\u2002Español",
  "pt-BR": "🇧🇷\u2002Português (Brasil)",
  "pt-PT": "🇵🇹\u2002Português (Portugal)",
  "it-IT": "🇮🇹\u2002Italiano",
  "de-DE": "🇩🇪\u2002Deutsch",
  "zh-CN": "🇨🇳\u2002简体中文",
}

const isLocale = Schema.is(Locale)

// Exact supported locale first, then its language, then the next preference.
// Portuguese without a region uses pt-BR; Chinese uses Simplified Chinese.
export const matchLocale = (preferences: ReadonlyArray<string>): Locale => {
  for (const preference of preferences) {
    const exact = Locale.literals.find(
      (locale) => locale.toLowerCase() === preference.toLowerCase(),
    )

    if (exact !== undefined) return exact

    const language = preference.split("-")[0]?.toLowerCase()
    const related = Locale.literals.find((locale) => locale.split("-")[0] === language)

    if (related !== undefined) return related
  }

  return fallback
}

// No URL, cookie or HTML detection: URLs describe the chart, never its reader.
const detector = (instance: i18n) =>
  new LanguageDetector(instance.services, {
    order: ["localStorage", "navigator"],
    lookupLocalStorage: "i18nextLng",
    caches: ["localStorage"],
  })

const detectLocale = (detection: LanguageDetector) => {
  let detected: ReturnType<LanguageDetector["detect"]>

  try {
    detected = detection.detect()
  } catch {
    // Some browsers revoke storage access after the detector's availability check.
    detected = detection.detect(["navigator"])
  }

  return matchLocale(Array.isArray(detected) ? detected : detected == null ? [] : [detected])
}

// The reader's locale and the instance showing it. Only browser activation
// writes this reference. Server requests each own an instance and always
// render en-US, including during client hydration. Requests carry the
// reader's locale while its messages still load.
let active: { instance: i18n; locale: Locale } | undefined

export const requestLocale = (): Locale => {
  if (active !== undefined) return active.locale

  if (!("window" in globalThis)) return fallback

  return detectLocale(detector(createI18n()))
}

export const createI18n = () => {
  const instance = createInstance().use(backend)

  void instance.init({
    resources: { [fallback]: english },
    // English is in the page; the backend fetches the other locales.
    partialBundledLanguages: true,
    ns: Object.keys(english),
    lng: fallback,
    fallbackLng: fallback,
    supportedLngs: [...Locale.literals],
    load: "currentOnly",
    keySeparator: false,
    nsSeparator: false,
    defaultNS: "common",
    initAsync: false,
    interpolation: { escapeValue: false },
  })

  return instance
}

interface LocaleProviderProps {
  instance: i18n
  children: ReactNode
}

export const LocaleProvider = ({ instance, children }: LocaleProviderProps) => {
  useEffect(() => {
    const detection = detector(instance)

    const remember = (locale: string) => {
      if (!isLocale(locale)) return

      if (active?.instance === instance) active = { instance, locale }

      try {
        detection.cacheUserLanguage(locale)
      } catch {
        // The selected locale still works when storage is blocked.
      }
    }

    const locale = detectLocale(detection)

    active = { instance, locale }

    instance.on("languageChanged", remember)
    void instance.changeLanguage(locale)

    return () => {
      instance.off("languageChanged", remember)

      if (active?.instance === instance) active = undefined
    }
  }, [instance])

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>
}

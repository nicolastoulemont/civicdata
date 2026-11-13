import { Locale } from "@repo/domain"
import { Schema } from "effect"
import { useId } from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { fallback, languages } from "@/locale"

const isLocale = Schema.is(Locale)

export const Language = () => {
  const { t, i18n } = useTranslation("settings")
  const id = useId()
  const locale = isLocale(i18n.language) ? i18n.language : fallback

  return (
    <section>
      <Field>
        <FieldLabel htmlFor={id}>{t(($) => $.language)}</FieldLabel>
        <FieldDescription id={`${id}-description`}>
          {t(($) => $.languageDescription)}
        </FieldDescription>
        <Select
          value={locale}
          items={languages}
          onValueChange={(value) => {
            if (isLocale(value)) void i18n.changeLanguage(value)
          }}
        >
          <SelectTrigger id={id} aria-describedby={`${id}-description`} className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {Locale.literals.map((code) => (
              <SelectItem key={code} value={code}>
                <span lang={code}>{languages[code]}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </section>
  )
}

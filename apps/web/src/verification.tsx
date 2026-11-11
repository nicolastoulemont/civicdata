import { verificationAction, VerificationRequired, VerificationToken } from "@openfacts/domain"
import { Machine } from "@openfacts/machine"
import { DEFAULT_SCRIPT_ID, Turnstile } from "@marsidev/react-turnstile"
import { Data, Effect, Option, Result, Schema } from "effect"
import { createRoot } from "react-dom/client"
import { I18nextProvider, useTranslation } from "react-i18next"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createI18n, requestLocale } from "@/locale"
import { useMachine } from "@/machine"

type State = Data.TaggedEnum<{
  Checking: { readonly attempt: number }
  Failed: { readonly attempt: number }
  Done: {}
}>

const State = Data.taggedEnum<State>()

type Event = Data.TaggedEnum<{
  Pass: { readonly token: VerificationToken }
  Fail: {}
  Retry: {}
  Cancel: {}
}>

const Event = Data.taggedEnum<Event>()

type Outcome = Result.Result<VerificationToken, VerificationRequired>

const cancelled = () => Machine.emit(State.Done(), Result.fail(new VerificationRequired()))

const machine = Machine.make<State, Event, Outcome>()({
  initial: () => State.Checking({ attempt: 0 }),
  on: {
    Checking: {
      Pass: (_, { token }) => Machine.emit(State.Done(), Result.succeed(token)),
      Fail: ({ attempt }) => State.Failed({ attempt }),
      Cancel: cancelled,
      ignore: ["Retry"],
    },
    Failed: {
      Retry: ({ attempt }) => State.Checking({ attempt: attempt + 1 }),
      Cancel: cancelled,
      ignore: ["Pass", "Fail"],
    },
    Done: { ignore: ["Pass", "Fail", "Retry", "Cancel"] },
  },
})

interface ChallengeProps {
  sitekey: string
  onResult: (outcome: Outcome) => void
}

const Challenge = ({ sitekey, onResult }: ChallengeProps) => {
  const { t } = useTranslation("common")
  const [state, send] = useMachine(machine, { on: onResult })
  const fail = () => send(Event.Fail())

  return (
    <Dialog
      open={!State.$is("Done")(state)}
      onOpenChange={(open) => {
        if (!open) send(Event.Cancel())
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(($) => $.verificationTitle)}</DialogTitle>
          <DialogDescription>{t(($) => $.verificationDescription)}</DialogDescription>
        </DialogHeader>
        {State.$is("Checking")(state) ? (
          <Turnstile
            key={state.attempt}
            siteKey={sitekey}
            options={{ action: verificationAction, retry: "never", refreshExpired: "never" }}
            scriptOptions={{
              onError: () => {
                document.getElementById(DEFAULT_SCRIPT_ID)?.remove()
                fail()
              },
            }}
            onSuccess={(value) =>
              Option.match(Schema.decodeUnknownOption(VerificationToken)(value), {
                onNone: fail,
                onSome: (token) => send(Event.Pass({ token })),
              })
            }
            onError={fail}
            onExpire={fail}
            onTimeout={fail}
            onUnsupported={fail}
          />
        ) : null}
        {State.$is("Failed")(state) ? (
          <>
            <Alert variant="destructive">
              <AlertDescription>{t(($) => $.verificationFailed)}</AlertDescription>
            </Alert>
            <Button onClick={() => send(Event.Retry())}>{t(($) => $.tryAgain)}</Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// Mounted only for a paid request. Interrupting the request closes its dialog.
export const challenge = (sitekey: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const container = document.createElement("div")

      document.body.append(container)

      return { container, root: createRoot(container) }
    }),
    ({ root }) =>
      Effect.callback<VerificationToken, VerificationRequired>((resume) => {
        const instance = createI18n()

        void instance.changeLanguage(requestLocale())

        root.render(
          <I18nextProvider i18n={instance}>
            <Challenge
              sitekey={sitekey}
              onResult={(outcome) => resume(Effect.fromResult(outcome))}
            />
          </I18nextProvider>,
        )
      }),
    ({ root, container }) =>
      Effect.sync(() => {
        root.unmount()
        container.remove()
      }),
  )

import { DEFAULT_SCRIPT_ID, Turnstile } from "@marsidev/react-turnstile"
import { verificationAction, VerificationRequired, VerificationToken } from "@openfacts/domain"
import { Machine } from "@openfacts/machine"
import { Data, Effect, Option, Result, Schema } from "effect"
import type { ReactNode } from "react"
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

interface ProofProps {
  sitekey: string
  // Whether the person may be asked to interact. Without it, the widget shows
  // nothing and fails as soon as Cloudflare wants the person.
  interactive: boolean
  onPass: (token: VerificationToken) => void
  onFail: () => void
}

const Proof = ({ sitekey, interactive, onPass, onFail }: ProofProps) => (
  <Turnstile
    siteKey={sitekey}
    options={{
      action: verificationAction,
      appearance: interactive ? "always" : "interaction-only",
      retry: "never",
      refreshExpired: "never",
    }}
    scriptOptions={{
      onError: () => {
        document.getElementById(DEFAULT_SCRIPT_ID)?.remove()
        onFail()
      },
    }}
    onSuccess={(value) =>
      Option.match(Schema.decodeUnknownOption(VerificationToken)(value), {
        onNone: onFail,
        onSome: onPass,
      })
    }
    {...(interactive ? {} : { onBeforeInteractive: onFail })}
    onError={onFail}
    onExpire={onFail}
    onTimeout={onFail}
    onUnsupported={onFail}
  />
)

interface ChallengeProps {
  sitekey: string
  onResult: (outcome: Outcome) => void
}

const Challenge = ({ sitekey, onResult }: ChallengeProps) => {
  const { t } = useTranslation("common")
  const [state, send] = useMachine(machine, { on: onResult })

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
          <Proof
            key={state.attempt}
            sitekey={sitekey}
            interactive
            onPass={(token) => send(Event.Pass({ token }))}
            onFail={() => send(Event.Fail())}
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

// Renders into its own root at the end of the page until the proof settles.
// Interrupting it removes what it rendered.
const mount = (
  render: (resume: (outcome: Outcome) => void) => ReactNode,
): Effect.Effect<VerificationToken, VerificationRequired> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const container = document.createElement("div")

      document.body.append(container)

      return { container, root: createRoot(container) }
    }),
    ({ root }) =>
      Effect.callback<VerificationToken, VerificationRequired>((resume) => {
        root.render(render((outcome) => resume(Effect.fromResult(outcome))))
      }),
    ({ root, container }) =>
      Effect.sync(() => {
        root.unmount()
        container.remove()
      }),
  )

// Asks the person in a dialog, for a request that needs a proof now.
export const dialog = (sitekey: string) =>
  mount((resume) => {
    const instance = createI18n()

    void instance.changeLanguage(requestLocale())

    return (
      <I18nextProvider i18n={instance}>
        <Challenge sitekey={sitekey} onResult={resume} />
      </I18nextProvider>
    )
  })

// Gets a proof without showing anything, failing when Cloudflare wants the
// person to interact.
export const background = (sitekey: string) =>
  mount((resume) => (
    <Proof
      sitekey={sitekey}
      interactive={false}
      onPass={(token) => resume(Result.succeed(token))}
      onFail={() => resume(Result.fail(new VerificationRequired()))}
    />
  ))

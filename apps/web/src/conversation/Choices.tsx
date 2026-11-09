import { Button } from "@/components/ui/button"

// A question the agent asked back, with the choices it offered. Picking one
// sends it as the next question; the choices are disabled once answered.
export const Choices = ({
  question,
  choices,
  disabled,
  choose,
}: {
  question: string
  choices: ReadonlyArray<string>
  disabled: boolean
  choose: (choice: string) => void
}) => (
  <div className="flex flex-col gap-2">
    <p>{question}</p>
    <div className="flex flex-wrap gap-2">
      {choices.map((choice) => (
        <Button
          key={choice}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => choose(choice)}
        >
          {choice}
        </Button>
      ))}
    </div>
  </div>
)

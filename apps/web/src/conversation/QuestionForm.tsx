import { maxQuestion, Question } from "@civicdata/domain"
import { type Editor, Extension, type JSONContent } from "@tiptap/core"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"
import { UndoRedo } from "@tiptap/extensions"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import { Schema } from "effect"
import { ArrowUp, Square } from "lucide-react"
import { useState } from "react"

import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { type Draft, load, save } from "./draft.ts"

// Whether the box can send: it holds a question, it is empty, too short or too
// long, or the agent is still answering the last one.
type State = "ready" | "empty" | "short" | "long" | "answering"

// The answer in progress, which the composer can stop.
export interface Answering {
  readonly stop: () => void
  readonly stopping: boolean
}

const reasons = {
  empty: "Type a question to send",
  short: "Type a longer question to send",
  long: `Shorten the question to ${maxQuestion} characters to send`,
  answering: "Wait for the answer to send another question",
} as const

const isQuestion = Schema.is(Question)

// Whether a question, trimmed, can be sent.
const check = (question: string) =>
  question === ""
    ? "empty"
    : question.length > maxQuestion
      ? "long"
      : isQuestion(question)
        ? "ready"
        : "short"

// Each line of the question is a paragraph.
const separator = { blockSeparator: "\n" }

const lines = (text: string): JSONContent => ({
  type: "doc",
  content: text
    .split("\n")
    .map((line) =>
      line === ""
        ? { type: "paragraph" }
        : { type: "paragraph", content: [{ type: "text", text: line }] },
    ),
})

// Enter sends the question through the box's form and Shift+Enter starts a
// new line. It runs before the editor's own Enter, which would split the line.
const Keys = Extension.create({
  name: "keys",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        editor.view.dom.closest("form")?.requestSubmit()

        return true
      },
      "Shift-Enter": ({ editor }) => editor.commands.splitBlock(),
    }
  },
})

// Plain text only: a question has no formatting, so pasted formatting is dropped.
const extensions = [Document, Paragraph, Text, UndoRedo, Keys]

// The box, and its placeholder while empty. The placeholder is drawn, not
// text, so like a textarea's it is no part of the page's content.
const box =
  "max-h-52 min-h-12 overflow-y-auto px-4 pt-3 pb-2 text-base wrap-break-word whitespace-pre-wrap outline-none md:text-sm data-[empty=true]:before:pointer-events-none data-[empty=true]:before:float-left data-[empty=true]:before:h-0 data-[empty=true]:before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)]"

interface SendProps {
  state: State
}

// The round send button. While it cannot send, its name and tooltip say why,
// and it stays focusable so keyboard users can read that tooltip too.
const Send = ({ state }: SendProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <InputGroupButton
          type="submit"
          variant="default"
          size="icon-sm"
          className="rounded-full aria-disabled:bg-muted aria-disabled:text-muted-foreground"
          aria-label={state === "ready" ? "Send" : reasons[state]}
          disabled={state !== "ready"}
          focusableWhenDisabled
        />
      }
    >
      <ArrowUp aria-hidden />
    </TooltipTrigger>
    <TooltipContent>
      {state === "ready" ? (
        <>
          Send <Kbd>Enter</Kbd>
        </>
      ) : (
        reasons[state]
      )}
    </TooltipContent>
  </Tooltip>
)

interface StopProps {
  answering: Answering
  editor: Editor | null
}

// The round stop button that takes the send button's place while the agent
// answers and the box is empty. Stopping moves focus to the box, ready for the
// next question, since the button goes away once the answer stops.
const Stop = ({ answering, editor }: StopProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <InputGroupButton
          variant="destructive"
          size="icon-sm"
          className="rounded-full"
          aria-label="Stop"
          disabled={answering.stopping}
          onClick={() => {
            answering.stop()
            editor?.commands.focus()
          }}
        />
      }
    >
      <Square aria-hidden className="size-3 fill-current" />
    </TooltipTrigger>
    <TooltipContent>Stop the answer</TooltipContent>
  </Tooltip>
)

interface QuestionFormProps {
  label: string
  placeholder: string
  // Where the box keeps what is typed and not sent. The box reads it once, when
  // it mounts: key the form by it to switch drafts.
  draft: Draft
  answering?: Answering | undefined
  onAsk: (question: string) => void
}

// The composer: a card whose box grows with the question, up to 13rem, then
// scrolls. Enter sends and Shift+Enter starts a new line. `onAsk` gets the
// question and the box empties for the next one. What is typed is saved as the
// draft and comes back after a reload. While `answering`, the box takes a
// draft but cannot send it, and an empty box offers to stop the answer.
export const QuestionForm = ({
  label,
  placeholder,
  draft,
  answering,
  onAsk,
}: QuestionFormProps) => {
  // The server renders no editor, so the draft is read in the browser only.
  const [content] = useState(() => lines(load(draft)))

  const editor = useEditor({
    extensions,
    content,
    immediatelyRender: false,
    editorProps: {
      // Recomputed on every change: a box holding one empty line is empty.
      attributes: ({ doc }) => ({
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        "aria-placeholder": placeholder,
        "data-placeholder": placeholder,
        "data-slot": "input-group-control",
        "data-empty": String(doc.childCount === 1 && doc.textContent === ""),
        class: box,
      }),
    },
    onUpdate: (event) => save(draft, event.editor.getText(separator)),
  })

  // The selector reads `editor` rather than its snapshot, which stays null until
  // the first edit: a restored draft must count before it is edited.
  const text = useEditorState({ editor, selector: () => editor?.getText(separator) }) ?? ""

  const empty = text.trim() === ""
  const state: State = answering === undefined ? check(text.trim()) : "answering"

  return (
    <form
      className="[view-transition-name:composer]"
      onSubmit={(event) => {
        event.preventDefault()

        if (editor === null || answering !== undefined) return

        // Read from the editor: Enter can come before the last keystroke renders.
        const question = editor.getText(separator).trim()

        if (check(question) !== "ready") return

        onAsk(question)
        // Emptying the box also deletes the saved draft.
        editor.commands.clearContent(true)
      }}
    >
      <InputGroup className="rounded-2xl bg-card/80 shadow-sm backdrop-blur-md dark:bg-card/80 dark:shadow-none">
        <EditorContent editor={editor} className="w-full" />
        {/* Holds the box's place until the editor starts in the browser. */}
        {editor === null ? (
          <div aria-hidden className={box} data-empty="true" data-placeholder={placeholder} />
        ) : null}
        <InputGroupAddon align="block-end" className="justify-end px-3 pb-3">
          {answering !== undefined && empty ? (
            <Stop answering={answering} editor={editor} />
          ) : (
            <Send state={state} />
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

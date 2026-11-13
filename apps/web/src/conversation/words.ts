import { Asked, blocksOf, type Ending, Text } from "@repo/domain"
import { Schema } from "effect"

const isText = Schema.is(Text)

const isAsked = Schema.is(Asked)

// A cited record's link, "[Mariano Rajoy](cite:0)", which only the page can
// follow.
const cite = /\[([^\]]+)\]\(cite:\d+\)/g

// What an answer says in words, as Markdown: its text blocks in order, each
// cited record named in place of its link, then the question it asked back,
// if any. A chart has no words.
export const wordsOf = (ending: Ending) =>
  [
    ...blocksOf(ending).flatMap((block) =>
      isText(block) ? [block.text.replaceAll(cite, "$1")] : [],
    ),
    ...(isAsked(ending) ? [ending.question] : []),
  ].join("\n\n")

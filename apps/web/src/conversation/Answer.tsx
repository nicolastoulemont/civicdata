import type { Answered } from "@civicdata/domain"
import { useState } from "react"

import { Explore } from "@/explore/Explore"

interface AnswerProps {
  agent: typeof Answered.Type
}

// The chart that answered a question, in the explorer card so it can be
// changed where it is. Changes stay in the page: a reload shows the agent's
// chart again.
export const Answer = ({ agent }: AnswerProps) => {
  const [view, setView] = useState(agent.view)

  return <Explore view={view} onChange={setView} heading="h3" agent={agent} />
}

import type { Cited, Country } from "@civicdata/domain"
import { cn } from "cn"
import { Struct } from "effect"
import { type ComponentProps, createContext, use } from "react"
import Markdown, { type Components, defaultUrlTransform, type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { Mention } from "./Mention.tsx"

const none: ReadonlyArray<never> = []

// The records a text cites, by their place, and the countries of the charts
// it describes, which name who a cited event concerns.
interface Citing {
  readonly cites: ReadonlyArray<Cited>
  readonly countries: ReadonlyArray<Country>
}

const Citing = createContext<Citing>({ cites: none, countries: none })

// A link to a cited record, as the server writes it: "cite:0".
const citeLink = /^cite:(\d+)$/

type LinkProps = ComponentProps<"a"> & ExtraProps

// A link in the text: a cited record's mention, or a plain link.
const Link = ({ href = "", children, ...props }: LinkProps) => {
  const { cites, countries } = use(Citing)
  const index = citeLink.exec(href)?.[1]
  const record = index === undefined ? undefined : cites[Number(index)]

  if (record !== undefined) return <Mention record={record} countries={countries} />

  return (
    <a href={href} className="underline underline-offset-4" {...Struct.omit(props, ["node"])}>
      {children}
    </a>
  )
}

// A Markdown table as the app's table. react-markdown passes each element's
// syntax node, which the DOM does not take.
type GridProps = ComponentProps<"table"> & ExtraProps

const Grid = (props: GridProps) => <Table {...Struct.omit(props, ["node"])} />

type HeaderProps = ComponentProps<"thead"> & ExtraProps

const Header = (props: HeaderProps) => <TableHeader {...Struct.omit(props, ["node"])} />

type BodyProps = ComponentProps<"tbody"> & ExtraProps

const Body = (props: BodyProps) => <TableBody {...Struct.omit(props, ["node"])} />

type RowProps = ComponentProps<"tr"> & ExtraProps

const Row = (props: RowProps) => <TableRow {...Struct.omit(props, ["node"])} />

type HeadProps = ComponentProps<"th"> & ExtraProps

const Head = (props: HeadProps) => <TableHead {...Struct.omit(props, ["node"])} />

type CellProps = ComponentProps<"td"> & ExtraProps

const Cell = (props: CellProps) => <TableCell {...Struct.omit(props, ["node"])} />

const components: Components = {
  a: Link,
  table: Grid,
  thead: Header,
  tbody: Body,
  tr: Row,
  th: Head,
  td: Cell,
}

// Lists, quotes and code in the text. The agent writes no headings; one it
// writes anyway reads as a strong line, below the question's own heading.
const elements = cn(
  "[&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1 [&_ul]:pl-5",
  "[&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1 [&_ol]:pl-5",
  "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm",
  "[&_:is(h1,h2,h3,h4,h5,h6)]:font-medium",
)

// Links keep their safe default, and cited records keep their "cite:" link.
const urlTransform = (url: string) => (citeLink.test(url) ? url : defaultUrlTransform(url))

interface ProseProps {
  // Markdown the agent wrote.
  text: string
  // The records the text cites, by the place its "cite:" links name.
  cites?: ReadonlyArray<Cited> | undefined
  // The countries of the charts the text describes.
  countries?: ReadonlyArray<Country>
  className?: string | undefined
}

// What the agent wrote, rendered from Markdown with GitHub's tables and
// lists, each cited record a mention with its card. Raw HTML and images are
// left out.
export const Prose = ({ text, cites = none, countries = none, className }: ProseProps) => (
  <div className={cn("flex flex-col gap-3", elements, className)}>
    <Citing value={{ cites, countries }}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={urlTransform}
        disallowedElements={["img"]}
        skipHtml
      >
        {text}
      </Markdown>
    </Citing>
  </div>
)

import { Link } from "@tanstack/react-router"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Toggle } from "@/history/Toggle"

interface HeaderProps {
  title: string | undefined
}

// Names the conversation by its first question, cut to one line, under the
// site. A conversation with no question yet is just "Conversation". The
// sidebar toggle comes first while the sidebar is closed; "New conversation"
// is in the sidebar. The header keeps the toggle's height (28px plus padding)
// while the toggle is hidden, so opening the sidebar does not move the page.
export const Header = ({ title }: HeaderProps) => (
  <header className="flex min-h-13 items-center gap-2 p-3">
    <Toggle />
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to="/" />}>civicdata</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>/</BreadcrumbSeparator>
        <BreadcrumbItem className="min-w-0">
          <h1 className="min-w-0 truncate text-foreground" title={title}>
            {title ?? "Conversation"}
          </h1>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  </header>
)

import { Link } from "@tanstack/react-router"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { SidebarTrigger } from "@/components/ui/sidebar"

interface HeaderProps {
  title: string | undefined
}

// Names the conversation by its first question, cut to one line, under the
// site. A conversation with no question yet is just "Conversation". The
// sidebar toggle comes first; "New conversation" is in the sidebar.
export const Header = ({ title }: HeaderProps) => (
  <header className="flex items-center gap-2 px-3 py-3 sm:px-12">
    <SidebarTrigger />
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

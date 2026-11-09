import { Link } from "@tanstack/react-router"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { buttonVariants } from "@/components/ui/button"

// Names the conversation by its first question, cut to one line, under the
// site. A conversation with no question yet is just "Conversation".
export const Header = ({ title }: { title: string | undefined }) => (
  <header className="flex items-center justify-between gap-4 px-3 py-3 sm:px-12">
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
    <Link className={buttonVariants({ variant: "outline", size: "sm" })} to="/">
      New conversation
    </Link>
  </header>
)

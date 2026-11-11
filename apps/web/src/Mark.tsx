interface MarkProps {
  className?: string
}

// The openfacts mark: a viewfinder's corners around one dot. The corners take
// the text colour and the dot the brand colour. tools/brand/brand.mjs draws
// the same shape into the favicons and the README logo.
export const Mark = ({ className }: MarkProps) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
    <path
      d="M5 11.5V5H11.5M20.5 5H27V11.5M27 20.5V27H20.5M11.5 27H5V20.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx={16} cy={16} r={4.6} className="fill-brand" />
  </svg>
)

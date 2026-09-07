/** Compact Supabase mark — currentColor so it follows toolbar chrome. */

export function SupabaseMark({
  size = 14,
  className
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M13.32 21.55c-.52.72-1.62.37-1.63-.52l-.18-11.7h7.37c1.47 0 2.28 1.7 1.37 2.86l-6.93 9.36Z" />
      <path d="M10.68 2.45c.52-.72 1.62-.37 1.63.52l.18 11.7H5.12c-1.47 0-2.28-1.7-1.37-2.86L10.68 2.45Z" />
    </svg>
  )
}

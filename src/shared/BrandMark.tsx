interface BrandMarkProps {
  className?: string
  size?: number
  title?: string
}

/**
 * BIMPipe bullseye logo — three concentric stroked rings around a filled
 * center dot. Uses currentColor so the parent picks the brand tint
 * (typically var(--accent)).
 */
export function BrandMark({ className, size = 22, title }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="16" cy="16" r="8" stroke="currentColor" strokeWidth="1.8" opacity="0.55" />
      <circle cx="16" cy="16" r="4.5" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      <circle cx="16" cy="16" r="2.2" fill="currentColor" />
    </svg>
  )
}

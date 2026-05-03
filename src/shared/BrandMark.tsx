interface BrandMarkProps {
  className?: string
  size?: number
  title?: string
}

const NAVY = '#0c2e7a'
const SKY = '#7ec6ff'

/**
 * BIMPipe bullseye logo — concentric navy/sky bands with a center dot.
 * Colors are fixed (not currentColor) because the mark is a brand asset.
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
      <circle cx="16" cy="16" r="16" fill={NAVY} />
      <circle cx="16" cy="16" r="13" fill={SKY} />
      <circle cx="16" cy="16" r="10" fill={NAVY} />
      <circle cx="16" cy="16" r="7" fill={SKY} />
      <circle cx="16" cy="16" r="4" fill={NAVY} />
      <circle cx="16" cy="16" r="1.8" fill={SKY} />
    </svg>
  )
}

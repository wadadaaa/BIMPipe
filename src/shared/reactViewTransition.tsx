import * as React from 'react'

type CompatViewTransitionProps = React.ViewTransitionProps

let hasWarnedAboutMissingRuntime = false

function warnAboutMissingRuntime() {
  if (!import.meta.env.DEV || hasWarnedAboutMissingRuntime) return

  hasWarnedAboutMissingRuntime = true
  console.warn(
    'React.ViewTransition is unavailable at runtime. Falling back to a static render. ' +
      'If you recently upgraded React, restart the Vite dev server to refresh optimized deps.',
  )
}

export function ViewTransition({ children, ...props }: CompatViewTransitionProps) {
  const RuntimeViewTransition = (
    React as typeof React & {
      ViewTransition?: React.ComponentType<CompatViewTransitionProps>
    }
  ).ViewTransition

  if (!RuntimeViewTransition) {
    warnAboutMissingRuntime()
    return <>{children}</>
  }

  return <RuntimeViewTransition {...props}>{children}</RuntimeViewTransition>
}

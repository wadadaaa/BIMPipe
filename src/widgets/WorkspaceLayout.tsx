import type { ReactNode } from 'react'
import './WorkspaceLayout.css'

interface WorkspaceLayoutProps {
  header?: ReactNode
  leftPanel: ReactNode
  centerPanel: ReactNode
  rightPanel: ReactNode
}

export function WorkspaceLayout({ header, leftPanel, centerPanel, rightPanel }: WorkspaceLayoutProps) {
  return (
    <div className="workspace-layout">
      {header && (
        <div className="workspace-layout__topbar">{header}</div>
      )}
      <div
        className="workspace-layout__left"
        style={{ viewTransitionName: 'persistent-left-panel' }}
      >
        {leftPanel}
      </div>
      <div className="workspace-layout__center">{centerPanel}</div>
      <div
        className="workspace-layout__right"
        style={{ viewTransitionName: 'persistent-right-panel' }}
      >
        {rightPanel}
      </div>
    </div>
  )
}

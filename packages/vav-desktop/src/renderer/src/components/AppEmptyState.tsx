import type { ReactNode } from 'react'
import { EmptyState } from './ui'

export type AppEmptyKind =
  | 'workbench'
  | 'scheduled'
  | 'storage'
  | 'storage-icloud'
  | 'storage-cloud'
  | 'data'
  | 'knowledge'

export function AppEmptyState({
  kind,
  title,
  description,
  children
}: {
  kind: AppEmptyKind
  title: string
  description: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <EmptyState
      logo={<AppEmptyMark kind={kind} />}
      title={title}
      description={description}
    >
      {children ? <div className="app-empty-actions">{children}</div> : null}
    </EmptyState>
  )
}

export function AppEmptyMark({ kind }: { kind: AppEmptyKind }): React.JSX.Element {
  return (
    <svg
      className="app-empty-mark"
      viewBox="0 0 88 72"
      fill="none"
      aria-hidden
    >
      {kind === 'workbench' ? <WorkbenchScene /> : null}
      {kind === 'scheduled' ? <ScheduleScene /> : null}
      {kind === 'storage' ? <StorageScene /> : null}
      {kind === 'storage-icloud' ? <IcloudScene /> : null}
      {kind === 'storage-cloud' ? <CloudDiskScene /> : null}
      {kind === 'data' ? <AnalysisScene /> : null}
      {kind === 'knowledge' ? <NotesScene /> : null}
    </svg>
  )
}

function WorkbenchScene(): React.JSX.Element {
  return (
    <>
      <rect
        x="8"
        y="12"
        width="34"
        height="48"
        rx="8"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.28"
      />
      <path
        d="M16 24h16M16 30h12M16 36h14"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        opacity="0.18"
      />
      <rect x="16" y="48" width="18" height="4" rx="2" fill="currentColor" opacity="0.72" />
      <rect
        x="46"
        y="12"
        width="34"
        height="48"
        rx="8"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.2"
      />
      <g fill="currentColor" opacity="0.14">
        <rect x="53" y="22" width="5" height="5" rx="1.5" />
        <rect x="61" y="23.4" width="12" height="2.2" rx="1.1" />
        <rect x="53" y="32" width="5" height="5" rx="1.5" />
        <rect x="61" y="33.4" width="10" height="2.2" rx="1.1" />
        <rect x="53" y="42" width="5" height="5" rx="1.5" />
        <rect x="61" y="43.4" width="13" height="2.2" rx="1.1" />
      </g>
      <rect x="53" y="22" width="5" height="5" rx="1.5" fill="currentColor" opacity="0.7" />
    </>
  )
}

function ScheduleScene(): React.JSX.Element {
  return (
    <>
      <rect
        x="16"
        y="12"
        width="48"
        height="44"
        rx="9"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.28"
      />
      <path d="M16 22.5h48" stroke="currentColor" strokeWidth="1.5" opacity="0.16" />
      <rect x="16" y="12" width="48" height="10.5" rx="9" fill="currentColor" opacity="0.07" />
      <path
        d="M30 9.5v7M50 9.5v7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.5"
      />
      <g fill="currentColor" opacity="0.16">
        <rect x="25" y="28" width="6.5" height="6.5" rx="1.8" />
        <rect x="35.25" y="28" width="6.5" height="6.5" rx="1.8" />
        <rect x="45.5" y="28" width="6.5" height="6.5" rx="1.8" />
        <rect x="25" y="38" width="6.5" height="6.5" rx="1.8" />
        <rect x="45.5" y="38" width="6.5" height="6.5" rx="1.8" />
      </g>
      <rect x="35.25" y="38" width="6.5" height="6.5" rx="1.8" fill="currentColor" opacity="0.78" />
      <circle cx="61" cy="51" r="11" className="app-empty-mark-plate" />
      <circle cx="61" cy="51" r="10" stroke="currentColor" strokeWidth="1.45" opacity="0.55" />
      <path
        d="M61 46.2v5.2l3.4 2"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.82"
      />
    </>
  )
}

function StorageScene(): React.JSX.Element {
  return (
    <>
      <rect
        x="28"
        y="11"
        width="36"
        height="42"
        rx="7"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.16"
      />
      <rect
        x="22"
        y="17"
        width="36"
        height="42"
        rx="7"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.3"
      />
      <path
        d="M22 26.5h36"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.14"
      />
      <path
        d="M30 34.5h16M30 40.5h20M30 46.5h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.22"
      />
      <rect x="30" y="34" width="9" height="2.2" rx="1.1" fill="currentColor" opacity="0.72" />
    </>
  )
}

function IcloudScene(): React.JSX.Element {
  return (
    <>
      <path
        d="M30.5 48.5h24.2c5.4 0 9.8-4.1 9.8-9.2 0-4.8-3.8-8.8-8.6-9.2-1.4-6.4-7.2-11.1-14.1-11.1-6.2 0-11.5 3.8-13.6 9.2-5.2.6-9.2 4.9-9.2 10.1 0 5.6 4.7 10.2 10.5 10.2h1"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        opacity="0.38"
      />
    </>
  )
}

function CloudDiskScene(): React.JSX.Element {
  return (
    <>
      <rect
        x="18"
        y="24"
        width="52"
        height="28"
        rx="8"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.28"
      />
      <path d="M18 36.5h52" stroke="currentColor" strokeWidth="1.4" opacity="0.14" />
      <circle cx="30" cy="43.5" r="2.2" fill="currentColor" opacity="0.2" />
      <circle cx="38" cy="43.5" r="2.2" fill="currentColor" opacity="0.55" />
      <rect x="50" y="41.6" width="12" height="3.6" rx="1.8" fill="currentColor" opacity="0.16" />
      <path
        d="M36 22.5c0-4.6 3.8-8.4 8.4-8.4 3.6 0 6.7 2.2 8 5.4 3.6.2 6.4 3.1 6.4 6.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.22"
      />
    </>
  )
}

function AnalysisScene(): React.JSX.Element {
  return (
    <>
      <rect
        x="16"
        y="12"
        width="56"
        height="48"
        rx="9"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.26"
      />
      <path
        d="M26 44.5c5.2-1.6 8.4-11.2 13.2-11.2 4.2 0 5.6 7.4 10.2 7.4 5.4 0 8.6-14.2 13.6-16.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.78"
      />
      <path
        d="M24 48.5h40"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.14"
      />
      <g fill="currentColor" opacity="0.16">
        <rect x="26" y="50.5" width="8" height="3.2" rx="1.2" />
        <rect x="38" y="50.5" width="8" height="3.2" rx="1.2" />
        <rect x="50" y="50.5" width="8" height="3.2" rx="1.2" />
      </g>
    </>
  )
}

function NotesScene(): React.JSX.Element {
  return (
    <>
      <rect
        x="24"
        y="10"
        width="42"
        height="52"
        rx="7"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.28"
      />
      <path d="M32 10v52" stroke="currentColor" strokeWidth="1.5" opacity="0.14" />
      <g fill="currentColor" opacity="0.38">
        <circle cx="24" cy="22" r="1.6" />
        <circle cx="24" cy="36" r="1.6" />
        <circle cx="24" cy="50" r="1.6" />
      </g>
      <path
        d="M38 24h18M38 31h20M38 38h14"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        opacity="0.2"
      />
      <rect x="38" y="22.8" width="11" height="2.3" rx="1.15" fill="currentColor" opacity="0.74" />
    </>
  )
}

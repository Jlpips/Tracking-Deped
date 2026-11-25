import type { ReactNode } from 'react'

export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-xs font-bold tracking-wide text-white">
        DTS
      </div>
      <div className="leading-tight">
        <b className="block text-sm font-semibold text-white">DTS Tracker</b>
        <span className="block text-xs text-white/60">Macalelon District</span>
      </div>
    </div>
  )
}

/** Two-panel layout for the sign-in screens: navy brand panel (hidden under 900px) + form. */
export function AuthLayout({
  headline,
  blurb,
  footer,
  children,
}: {
  headline: string
  blurb: string
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid min-h-svh bg-background min-[900px]:grid-cols-2">
      <div className="hidden flex-col justify-between bg-navy p-12 text-white min-[900px]:flex">
        <LogoMark />
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight">{headline}</h2>
          <p className="mt-3 text-white/70">{blurb}</p>
        </div>
        {footer ?? <span />}
      </div>
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  )
}

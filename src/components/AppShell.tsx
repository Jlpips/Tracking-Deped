import { DatabaseBackup, FileText, LogOut, School, ScrollText, Tags, Users, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth, type AuthProfile } from '@/auth/AuthProvider'
import { LogoMark } from '@/components/AuthLayout'
import type { Role } from '@/lib/types'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

interface NavGroup {
  label?: string
  roles: Role[]
  items: NavItem[]
}

const NAV: NavGroup[] = [
  { roles: ['user', 'admin', 'superadmin'], items: [{ to: '/records', label: 'Records', icon: FileText }] },
  {
    label: 'Admin',
    roles: ['admin', 'superadmin'],
    items: [
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/admin/schools', label: 'Schools', icon: School },
      { to: '/admin/document-types', label: 'Document types', icon: Tags },
    ],
  },
  {
    label: 'System',
    roles: ['superadmin'],
    items: [
      { to: '/system/logs', label: 'Activity logs', icon: ScrollText },
      { to: '/system/backup', label: 'Backup & restore', icon: DatabaseBackup },
    ],
  },
]

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

function subtitle(profile: AuthProfile): string {
  if (profile.role === 'user') return profile.school?.name ?? 'No school assigned'
  return 'District Admin'
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors outline-none',
    'focus-visible:ring-2 focus-visible:ring-white/60',
    isActive ? 'bg-white/12 text-white' : 'text-[#cfd9e6] hover:bg-white/8 hover:text-white',
  ].join(' ')

export default function AppShell() {
  const { profile, signOut } = useAuth()
  if (!profile) return null
  const groups = NAV.filter((g) => g.roles.includes(profile.role))

  return (
    <div className="min-h-svh bg-background min-[900px]:grid min-[900px]:grid-cols-[232px_1fr]">
      <aside className="flex flex-wrap items-center gap-1 bg-navy p-2.5 text-[#cfd9e6] min-[900px]:sticky min-[900px]:top-0 min-[900px]:h-svh min-[900px]:flex-col min-[900px]:flex-nowrap min-[900px]:items-stretch min-[900px]:px-3.5 min-[900px]:py-4.5">
        <LogoMark className="mr-2 px-1 min-[900px]:mr-0 min-[900px]:mb-5" />
        <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-1 min-[900px]:flex-col min-[900px]:flex-nowrap min-[900px]:items-stretch">
          {groups.map((g) => (
            <div
              key={g.label ?? 'main'}
              role="group"
              aria-label={g.label}
              className="flex flex-wrap items-center gap-1 min-[900px]:flex-col min-[900px]:items-stretch"
            >
              {g.label && (
                <div className="hidden px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-white/45 uppercase min-[900px]:block">
                  {g.label}
                </div>
              )}
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={linkClass}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 rounded-lg px-1 min-[900px]:mt-auto min-[900px]:border-t min-[900px]:border-white/10 min-[900px]:pt-3.5">
          <div
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-xs font-semibold text-white"
          >
            {initials(profile.full_name)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <b className="block truncate text-sm font-semibold text-white">{profile.full_name}</b>
            <span className="block truncate text-xs text-white/60">{subtitle(profile)}</span>
          </div>
          <button
            type="button"
            aria-label="Log out"
            title="Log out"
            onClick={() => void signOut()}
            className="grid size-8 place-items-center rounded-md text-white/70 transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </div>
      </aside>
      <main className="min-w-0 p-4 min-[900px]:p-8">
        <Outlet />
      </main>
    </div>
  )
}

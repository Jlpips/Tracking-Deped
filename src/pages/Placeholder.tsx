/** Stand-in for pages built in later tasks (Records, Admin, System). */
export default function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">This page is coming soon.</p>
    </div>
  )
}

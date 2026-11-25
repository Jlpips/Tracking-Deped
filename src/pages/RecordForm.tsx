import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { DtsRecord } from '@/lib/types'

export interface RecordFormProps {
  open: boolean
  onOpenChange(open: boolean): void
  record?: DtsRecord
  onSaved(record: DtsRecord): void
}

/** Stub until Task 8 builds the add/edit form; keeps the RecordsPage wiring in place. */
export function RecordForm({ open, onOpenChange, record }: RecordFormProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{record ? 'Edit record' : 'Add record'}</SheetTitle>
          <SheetDescription>The record form is coming soon.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  )
}
